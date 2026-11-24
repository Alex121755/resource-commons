'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('./scene-drafts.js');

// Exercise the actual preset loading/save/detail flow without a model request.
// Canvas pixels and responsive layout are checked separately in the browser.
test('公开照片示例只加载本地素材，显式保存后保留示意小图与原图的区分', async () => {
  const nodes = new Map(), handlers = new Map(), created = [], requests = [], writes = [];
  function node() {
    return { innerHTML: '', listeners: {}, setAttribute() {}, addEventListener(k, v) { this.listeners[k] = v; }, showModal() { this.open = true; }, close() { this.open = false; }, focus() {}, querySelector() { return null; }, classList: { toggle() {} } };
  }
  function query(selector) { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); }
  const original = 'data:image/jpeg;base64,b3JpZ2luYWw=', illustration = 'data:image/jpeg;base64,c2NoZW1hdGlj';
  class ImageMock {
    constructor() { this.naturalWidth = 1400; this.naturalHeight = 934; }
    set src(value) { this.value = value; queueMicrotask(() => this.onload()); }
  }
  const context = {
    window: { PhotoDraftData: D },
    document: {
      activeElement: null, body: { appendChild() {} }, querySelector: query,
      addEventListener(type, handler) { handlers.set(type, handler); },
      createElement(type) {
        const n = node();
        if (type === 'canvas') {
          n.getContext = () => new Proxy({}, { get: () => () => {}, set: () => true });
          n.toDataURL = () => n.width === 360 ? illustration : original;
        }
        created.push(n); return n;
      }
    },
    localStorage: { getItem: () => '', setItem(key, text) { writes.push({ key, text }); } },
    fetch: async url => { requests.push(url); return { ok: true, blob: async () => new Blob(['photo'], { type: 'image/jpeg' }) }; },
    Image: ImageMock, URL, Blob, location: { protocol: 'http:' }, console, setTimeout, clearTimeout, queueMicrotask
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'scene-ui.js'), 'utf8'), context);
  context.window.PhotoDraftUI.initialize({});
  const click = dataset => handlers.get('click')({ target: { closest: () => ({ dataset }) } });
  click({ sceneAction: 'demo' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests, ['assets/demo/desk.jpg'], '示例不应调用模型或外部服务');
  assert.equal(writes.length, 0, '查看示例不自动保存');
  assert.match(created[0].innerHTML, /人工预置 · 未调用 AI/);
  assert.match(created[0].innerHTML, /小图为示意图/);
  assert.match(created[0].innerHTML, /Alan Quirván/);
  query('#scene-review-form').onsubmit({ preventDefault() {} });
  assert.equal(writes.length, 1);
  const saved = D.parse(writes[0].text);
  assert.equal(saved.drafts.length, 3);
  assert.equal(saved.scenes[0].source, 'public-photo-demo');
  assert.equal(saved.scenes[0].originalImage, original);
  assert.equal(saved.drafts[0].thumbnail, illustration);
  assert.equal(saved.drafts[0].approval, 'not-requested');
  assert.match(query('#photo-draft-results').innerHTML, /示意图 · 照片示例/);
  click({ sceneAction: 'inspect', draft: saved.drafts[0].id });
  assert.match(created[0].innerHTML, new RegExp(original));
  assert.doesNotMatch(created[0].innerHTML, new RegExp(illustration));
  assert.match(created[0].innerHTML, /公开照片 · 人工预置/);
  assert.match(created[0].innerHTML, /示意图，非照片裁切/);
  assert.match(created[0].innerHTML, /pexels.com\/photo/);
  assert.equal(writes.length, 1, '查看详情不改变草稿');
});
