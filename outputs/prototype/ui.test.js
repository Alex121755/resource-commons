'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('./engine.js');
const D = require('./scene-drafts.js');

// Small dependency-free DOM adapter for the actual app bootstrap. It records
// rendered input values; layout and accessibility remain browser QA concerns.
function renderRequestForm(state, photoDraftUI, options = {}) {
  const nodes = new Map();
  const documentHandlers = new Map(), writes = [];
  nodes.documentHandlers = documentHandlers; nodes.writes = writes;
  function node(selector) {
    if (!nodes.has(selector)) {
      let html = '';
      const element = {
        value: '', textContent: '', listeners: {}, classList: { add() {}, remove() {}, toggle() {} },
        addEventListener(type, callback) { this.listeners[type] = callback; }, setAttribute() {}, focus() {}, showModal() { this.open = true; }, close() { this.open = false; },
        insertAdjacentHTML(_, markup) { this.innerHTML += markup; },
        parentElement: { insertAdjacentHTML() {} },
        get innerHTML() { return html; },
        set innerHTML(value) {
          html = value;
          for (const tag of value.matchAll(/<input\b[^>]*>/g)) {
            const id = /\bid="([^"]+)"/.exec(tag[0]);
            const val = /\bvalue="([^"]*)"/.exec(tag[0]);
            if (id) node('#' + id[1]).value = val ? val[1] : '';
          }
        }
      };
      nodes.set(selector, element);
    }
    return nodes.get(selector);
  }
  const context = {
    document: { querySelector: node, querySelectorAll: () => [], addEventListener(type, callback) { documentHandlers.set(type, callback); } },
    window: { ResourceEngine: E, PhotoDraftData: D, PhotoDraftUI: photoDraftUI, addEventListener() {}, scrollTo() {} },
    location: { hash: options.hash || '#request', protocol: options.protocol || 'file:' },
    localStorage: { getItem: () => JSON.stringify(state), setItem(key, value) { writes.push({ key, value }); } },
    setTimeout, clearTimeout, console, fetch: options.fetch, AbortSignal
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8'), context, { filename: 'app.js' });
  return nodes;
}

test('混合需求顺序变化后，实际表单仍保留手机规格与各类数量', () => {
  for (const phoneFirst of [false, true]) {
    const state = E.seed();
    const phone = { id: 'phone', label: '手机支撑套装', quantity: 2, phoneWidthMm: 76.5, phoneWeightG: 280 };
    const chair = { id: 'chair', label: '座椅', quantity: 4 };
    state.request.needs = phoneFirst ? [phone, chair] : [chair, phone];
    const nodes = renderRequestForm(state);
    assert.equal(nodes.get('#phone-width').value, '76.5');
    assert.equal(nodes.get('#phone-weight').value, '280');
    const html = nodes.get('#view').innerHTML;
    assert.match(html, /name="qty-chair"[^>]*value="4"/);
    assert.match(html, /name="qty-phone"[^>]*value="2"/);
  }
});

const cloudHealth = { service: 'waicy-resource-commons', backend: 'openai', provider: 'OpenAI(云)', localOnly: false, remoteProcessing: true, modelAvailable: true, model: 'gpt-test', availabilityCheck: 'configuration-only', apiVerified: false };
test('实际页面按云 health 显示 OpenAI 费用与配置状态，不把已有 key 视为余额验证', async () => {
  let published;
  const nodes = renderRequestForm(E.seed(), { initialize() {}, updateBackendStatus(status) { published = status; } }, { protocol: 'http:', fetch: async () => ({ ok: true, json: async () => cloudHealth }) });
  await new Promise(resolve => setImmediate(resolve));
  const text = nodes.get('#model-notice').innerHTML;
  assert.match(text, /OpenAI/); assert.match(text, /API 费用/); assert.match(text, /额度与余额以实际请求为准/);
  assert.doesNotMatch(text, /仅在本机处理|无付费 API|不连接云端/);
  assert.equal(published.ready, true); assert.equal(published.remoteProcessing, true);
  assert.equal(nodes.get('#ai-request-button').disabled, false);
  assert.match(nodes.get('#ai-request-button').textContent, /OpenAI/);
});

test('health 失败或返回其他本机服务时，实际页面禁用 AI 入口且不宣称本地处理', async () => {
  for (const fetch of [async () => { throw new Error('offline'); }, async () => ({ ok: true, json: async () => ({ ...cloudHealth, service: 'unrelated-service' }) })]) {
    let published;
    const nodes = renderRequestForm(E.seed(), { initialize() {}, updateBackendStatus(status) { published = status; } }, { protocol: 'http:', fetch });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(published.known, false); assert.equal(published.ready, false);
    assert.equal(nodes.get('#ai-request-button').disabled, true);
    assert.match(nodes.get('#model-notice').innerHTML, /不会发送照片或需求文字/);
    assert.doesNotMatch(nodes.get('#model-notice').innerHTML, /仅在本机处理|本地模型已连接/);
  }
});

test('本地合约 backend=local 仍允许识别，不被云模式改动破坏', async () => {
  let published;
  const nodes = renderRequestForm(E.seed(), { initialize() {}, updateBackendStatus(status) { published = status; } }, { protocol: 'http:', fetch: async () => ({ ok: true, json: async () => ({ ...cloudHealth, backend: 'local', localOnly: true, remoteProcessing: false, model: 'qwen-local' }) }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(published.ready, true); assert.equal(published.backend, 'local');
  assert.match(nodes.get('#model-notice').innerHTML, /交给本机模型处理/);
  assert.doesNotMatch(nodes.get('#model-notice').innerHTML, /发送至 OpenAI/);
});
test('照片草稿转库存表单保留建议名称，但位置事实、负责人和共享许可必须重新填写', () => {
  let handlers;
  const nodes = renderRequestForm(E.seed(), { initialize(options) { handlers = options; }, renderSection() {} });
  handlers.promote({ name: '桌上的电脑', category: 'electronics', visibleQuantity: null, thumbnail: '', model: 'test-local', uncertainties: ['状态未知'], locationHint: '书桌', isSynthetic: null }, { originalImage: 'data:image/jpeg;base64,YWJj' }, () => {});
  assert.equal(nodes.get('#item-name').value, '桌上的电脑');
  for (const key of ['#item-owner', '#item-place', '#item-at', '#item-share', '#item-condition', '#item-position', '#item-qty']) assert.equal(nodes.get(key).value, '', key + '不得从照片默认为已确认');
  assert.match(nodes.get('#item-place').placeholder, /草稿地点提示：书桌/);
  assert.equal(nodes.get('#item-share').required, true);
});


function clickAction(nodes, dataset) {
  nodes.documentHandlers.get('click')({ target: { closest: () => ({ dataset }) } });
}

test('新版物品库只有一处主搜索，草稿与模拟库存分区切换且不改写库存数据', () => {
  const original = E.seed(), calls = [];
  const nodes = renderRequestForm(original, {
    initialize() {}, summary: () => ({ total: 8, pending: 8 }),
    renderSection(container, options) { calls.push(options); }, setQuery(query) { calls.push({ searched: query }); }
  }, { hash: '#inventory' });
  const html = nodes.get('#view').innerHTML;
  assert.match(html, /照片草稿 <span>8<\/span>/);
  assert.match(html, /模拟库存 <span>10<\/span>/);
  assert.equal((html.match(/type="search"/g) || []).length, 1);
  assert.match(html, /id="confirmed-inventory" hidden/);
  assert.doesNotMatch(html, /KNOW WHAT|summary-strip|RESOURCE COMMONS/);
  const writesBefore = nodes.writes.length;
  nodes.get('#inventory-search').listeners.input({ target: { value: '书桌' } });
  assert.equal(calls.at(-1).searched, '书桌');
  clickAction(nodes, { action: 'library-tab', tab: 'inventory' });
  assert.match(nodes.get('#view').innerHTML, /id="photo-draft-section" hidden/);
  assert.doesNotMatch(nodes.get('#view').innerHTML, /id="confirmed-inventory" hidden/);
  assert.match(nodes.get('#view').innerHTML, /允许申请 ≠ 本次已批准/);
  nodes.get('#inventory-search').listeners.input({ target: { value: '不存在的物品' } });
  assert.match(nodes.get('#inventory-grid').innerHTML, /这里还没有匹配的物品/);
  clickAction(nodes, { action: 'library-tab', tab: 'drafts' });
  assert.equal(calls.at(-1).query, '不存在的物品');
  assert.equal(nodes.writes.length, writesBefore, '浏览、搜索与切换不能写入或重置库存');
  assert.deepEqual(JSON.parse(nodes.writes[0].value), original);
});

test('新版首屏短提示保留云上传与计费，完整连接事实位于可展开说明中', async () => {
  const nodes = renderRequestForm(E.seed(), { initialize() {}, updateBackendStatus() {} }, { protocol: 'http:', fetch: async () => ({ ok: true, json: async () => cloudHealth }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(nodes.get('#service-summary').textContent, /云端识别.*上传.*计费/);
  assert.match(nodes.get('#model-notice').innerHTML, /额度与余额以实际请求为准/);
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /<details class="service-disclosure">/);
  assert.match(html, /模拟库存与审批/);
  assert.equal((html.match(/data-nav="/g) || []).length, 3);
  assert.doesNotMatch(html, /RESOURCE COMMONS|共享资源实验室/);
});

test('新版所有显式文字字号至少 14 px，移动端底栏和隐藏分区均有明确规则', () => {
  const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
  const sizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map(match => Number(match[1]));
  assert.ok(sizes.length > 30);
  assert.ok(sizes.every(size => size >= 14), '次要说明、标签与手机字也不能缩成小于 14 px');
  assert.match(css, /\[hidden\]\{display:none!important\}/);
  assert.match(css, /@media\(max-width:720px\)/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /focus-visible/);
});

test('需求页先呈现用途输入；示例与匹配说明按需展开，关键条件保留', async () => {
  const nodes = renderRequestForm(E.seed(), { initialize() {}, updateBackendStatus() {} }, { protocol: 'http:', fetch: async () => ({ ok: true, json: async () => cloudHealth }) });
  await new Promise(resolve => setImmediate(resolve));
  const html = nodes.get('#view').innerHTML;
  assert.match(html, /<details class="preset-picker"><summary>演示场景：/);
  assert.match(html, /<details class="details request-guidance">/);
  assert.doesNotMatch(html, /<aside|找到物品，<br>只是第一步/);
  assert.ok(html.indexOf('id="request-purpose"') < html.indexOf('id="request-title"'));
  for (const id of ['request-start', 'request-end', 'phone-width', 'phone-weight']) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(nodes.get('#request-ai-summary').textContent, /需求文字发送 OpenAI.*可能计费.*建议待确认/);
});

function openInventory(state = E.seed()) {
  const nodes = renderRequestForm(state, { initialize() {}, renderSection() {} }, { hash: '#inventory' });
  clickAction(nodes, { action: 'library-tab', tab: 'inventory' });
  return nodes;
}
function shownItemIds(nodes) {
  return [...nodes.get('#inventory-grid').innerHTML.matchAll(/data-action="view-item" data-id="([^"]+)"/g)].map(match => match[1]);
}
function chooseInventoryLocation(nodes, location) {
  nodes.get('#inventory-location').listeners.change({ target: { value: location } });
}
function searchInventory(nodes, value) {
  nodes.get('#inventory-search').listeners.input({ target: { value } });
}

test('按地点找物只使用最后确认位置，合并柜子子层级，不把预测地点列为事实', () => {
  const original = E.seed();
  original.items.find(i => i.id === 'c1').lastConfirmed.place = '器材柜 A ／ 配件盒';
  const moving = original.items.find(i => i.id === 's2');
  moving.history.push({ place: '排练室 / 器材车', at: '2026-11-03T17:00', kind: 'activity' });
  const nodes = openInventory(original), writesBefore = nodes.writes.length;
  const html = nodes.get('#view').innerHTML;
  assert.equal((html.match(/<option value="器材柜 A"/g) || []).length, 1, '同一柜子的不同层级合并为一个地点');
  assert.doesNotMatch(html, /<option[^>]*排练室/, '仅有活动线索的地点不能成为最后确认地点');
  chooseInventoryLocation(nodes, '器材柜 A');
  assert.deepEqual(shownItemIds(nodes), ['s1', 't1', 'c1']);
  chooseInventoryLocation(nodes, '综合活动室');
  assert.deepEqual(shownItemIds(nodes), ['s2']);
  assert.match(nodes.get('#inventory-grid').innerHTML, /最后确认地点.*综合活动室 \/ 蓝色收纳箱/);
  assert.doesNotMatch(nodes.get('#inventory-grid').innerHTML, /排练室/);
  assert.equal(nodes.writes.length, writesBefore);
  assert.deepEqual(JSON.parse(nodes.writes[0].value), E.validateState(original));
});

test('地点、关键词与共享状态同时生效，清除筛选恢复全部物品且不改库存', () => {
  const original = E.seed(), nodes = openInventory(original), writesBefore = nodes.writes.length;
  chooseInventoryLocation(nodes, '器材柜 A');
  searchInventory(nodes, '林同学');
  clickAction(nodes, { action: 'filter', filter: 'shareable' });
  assert.deepEqual(shownItemIds(nodes), ['s1', 't1', 'c1']);
  searchInventory(nodes, '手机');
  assert.deepEqual(shownItemIds(nodes), ['s1', 'c1']);
  clickAction(nodes, { action: 'filter', filter: 'private' });
  assert.deepEqual(shownItemIds(nodes), []);
  assert.match(nodes.get('#inventory-grid').innerHTML, /清除筛选/);
  assert.equal(nodes.get('#result-line').textContent, '0 条模拟记录');
  clickAction(nodes, { action: 'clear-filters' });
  assert.deepEqual(shownItemIds(nodes), original.items.map(i => i.id));
  assert.equal(nodes.get('#inventory-search').value, '');
  assert.equal(nodes.get('#result-line').textContent, '10 条模拟记录');
  assert.equal(nodes.writes.length, writesBefore);
});

test('列表和照片视图保留当前搜索筛选，查看详情和关闭不修改数据或打开编辑表单', () => {
  const nodes = openInventory(), writesBefore = nodes.writes.length;
  chooseInventoryLocation(nodes, '器材柜 A');
  searchInventory(nodes, '手机');
  clickAction(nodes, { action: 'layout', layout: 'photos' });
  assert.deepEqual(shownItemIds(nodes), ['s1', 'c1']);
  assert.equal(nodes.get('#inventory-search').value, '手机');
  assert.match(nodes.get('#view').innerHTML, /value="器材柜 A" selected/);
  assert.match(nodes.get('#inventory-grid').className, /inventory-photos/);
  clickAction(nodes, { action: 'view-item', id: 'c1' });
  const details = nodes.get('#modal-content').innerHTML;
  assert.equal(nodes.get('#modal').open, true);
  assert.match(details, /物品详情/);
  assert.match(details, /最大夹持宽度（毫米）<\/dt><dd>待核实<\/dd>/);
  assert.match(details, /data-action="edit-item"[^>]*>编辑记录/);
  assert.doesNotMatch(details, /<form|id="item-form"/);
  clickAction(nodes, { action: 'close-modal' });
  assert.equal(nodes.get('#modal').open, false);
  clickAction(nodes, { action: 'layout', layout: 'list' });
  assert.deepEqual(shownItemIds(nodes), ['s1', 'c1']);
  assert.match(nodes.get('#inventory-grid').className, /inventory-list/);
  assert.equal(nodes.writes.length, writesBefore);
});

test('物品详情明确区分预测和最后确认，私人记录与允许申请不会变成本次已批准', () => {
  const original = E.seed(), moving = original.items.find(i => i.id === 's2');
  moving.history.push({ place: '排练室 / 器材车', at: '2026-11-03T17:00', kind: 'activity' });
  const nodes = openInventory(original), writesBefore = nodes.writes.length;
  clickAction(nodes, { action: 'view-item', id: 's2' });
  let details = nodes.get('#modal-content').innerHTML;
  assert.match(details, /<dt>最后确认<\/dt><dd>综合活动室 \/ 蓝色收纳箱/);
  assert.match(details, /<strong>预测位置 · 尚未确认<\/strong>[\s\S]*<li>排练室 \/ 器材车<\/li>/);
  assert.match(details, /可能移动，待核实/);
  assert.match(details, /可申请借用/);
  assert.match(details, /允许申请 ≠ 本次已批准/);
  assert.match(details, /库存数量不代表当前可借数量/);
  assert.doesNotMatch(details, /已模拟批准/);
  clickAction(nodes, { action: 'close-modal' });
  clickAction(nodes, { action: 'view-item', id: 's3' });
  details = nodes.get('#modal-content').innerHTML;
  assert.match(details, /不可共享/);
  assert.doesNotMatch(details, /可申请借用|已模拟批准|data-action="approve"/);
  assert.equal(nodes.writes.length, writesBefore);
});

test('公开照片示例转库存时保留原图、示意小图与署名，人工确认项仍为空', () => {
  let handlers;
  const nodes = renderRequestForm(E.seed(), { initialize(options) { handlers = options; }, renderSection() {} });
  const originalImage = 'data:image/jpeg;base64,YWJj', thumbnail = 'data:image/jpeg;base64,ZGVm';
  const publicPhoto = { author: 'Alan Quirván', pageUrl: 'https://www.pexels.com/photo/laptop-notebooks-and-pens-on-white-desk-14541073/', licenseUrl: 'https://www.pexels.com/license/' };
  handlers.promote({ name:'照片中的电脑', category:'electronics', visibleQuantity:1, thumbnail, model:'人工预置候选，未调用 AI', uncertainties:[], locationHint:'', isSynthetic:true }, { source:'public-photo-demo', originalImage, publicPhoto }, () => {});
  assert.match(nodes.get('#modal-content').innerHTML, new RegExp('src="' + originalImage + '"'));
  assert.doesNotMatch(nodes.get('#modal-content').innerHTML, new RegExp('src="' + thumbnail + '"'));
  for (const key of ['#item-owner','#item-place','#item-share','#item-condition']) assert.equal(nodes.get(key).value,'');
});
