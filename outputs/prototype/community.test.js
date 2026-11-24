'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('./community.js');
const at = '2026-11-05T02:00:00.000Z';
const later = '2026-11-05T03:00:00.000Z';
const input = () => ({ type: 'offer', title: '闲置折叠桌', description: '可先协商尺寸与使用时间。', category: 'furniture', quantity: 2, area: '学校附近', conditions: '本周六协商，归还与搬运待确认。', rightsConfirmed: true });
function memoryStorage(initial) {
  const values = new Map(Object.entries(initial || {})), writes = [];
  return { values, writes, getItem(key) { return values.has(key) ? values.get(key) : null; }, setItem(key, value) { writes.push(key); values.set(key, value); } };
}
function published() { return D.publishPost(D.seed(), input(), { id: 'my-post', at }); }
function contacted() { return D.openThread(D.seed(), 'example-tripod', { id: 'thread-1', at }); }

test('四条虚构示例与私人库存隔离，没有任何批准或真实共享标志', () => {
  const state = D.seed(); assert.equal(state.posts.length, 4); assert.equal(state.threads.length, 0);
  assert.equal(state.scope, 'local-demo'); assert.ok(state.posts.every(p => p.isExample && !p.rightsConfirmed));
  assert.deepEqual(Object.keys(state).sort(), ['posts', 'revision', 'scope', 'threads', 'version']);
  assert.deepEqual(D.validateStore(JSON.parse(JSON.stringify(state))), state);
});
test('必须明确确认发布权限，存在信息或输入字符串 true 不算确认', () => {
  for (const value of [false, null, undefined, 'true', 1]) assert.throws(() => D.publishPost(D.seed(), { ...input(), rightsConfirmed: value }, { at }));
  assert.throws(() => D.publishPost(D.seed(), { ...input(), type: 'request', rightsConfirmed: false }, { at }));
});
test('主动发布仅添加本机帖子，不复制库存、图片、批准或伪造物主', () => {
  const state = D.seed(), copy = D.clone(state);
  const next = D.publishPost(state, { ...input(), ownerId: 'someone-else', approval: 'approved', inventory: ['private'], photo: 'secret' }, { id: 'my-post', at });
  assert.deepEqual(state, copy); assert.equal(next.posts.length, 5);
  assert.equal(next.posts[0].ownerId, D.SELF_ID); assert.equal(next.posts[0].isExample, false);
  assert.ok(!('approval' in next.posts[0])); assert.ok(!('photo' in next.posts[0]));
});
test('非法类别、类型、数量和过长字段被拒绝，原状态不变', () => {
  const state = D.seed(), before = JSON.stringify(state);
  for (const mutate of [p => p.category = '__proto__', p => p.type = 'approved', p => p.quantity = 0, p => p.quantity = 1.5, p => p.quantity = 100, p => p.title = 'x'.repeat(61), p => p.description = ' ', p => p.area = '', p => p.conditions = 'x'.repeat(301)]) {
    const value = input(); mutate(value); assert.throws(() => D.publishPost(state, value, { at }));
  }
  assert.equal(JSON.stringify(state), before);
});
test('同一帖子重复联系复用会话，不生成消息或对方自动回复', () => {
  const opened = contacted(), repeated = D.openThread(opened.state, 'example-tripod', { id: 'other-thread', at: later });
  assert.equal(repeated.created, false); assert.equal(repeated.threadId, 'thread-1');
  assert.equal(repeated.state.threads.length, 1); assert.deepEqual(repeated.state.threads[0].messages, []);
});
test('不能以自己联系自己的方式制造外部对话', () => {
  assert.throws(() => D.openThread(published(), 'my-post', { at }));
  assert.throws(() => D.openThread(D.seed(), 'not-found', { at }));
});
test('只能关闭自己明确发布的帖子，示例不会冒充本人共享物品', () => {
  assert.throws(() => D.closePost(D.seed(), 'example-tripod', { at }));
  const state = published(), next = D.closePost(state, 'my-post', { at: later });
  assert.equal(state.posts[0].status, 'open'); assert.equal(next.posts[0].status, 'closed');
  assert.throws(() => D.closePost(next, 'my-post', { at: later }));
  assert.ok(!D.listPosts(next).some(p => p.id === 'my-post'));
  assert.equal(D.listPosts(next, { type: 'mine' })[0].status, 'closed');
});
test('双方手动演示消息均带 localDemo，文字不会变成批准或改动物品', () => {
  const opened = contacted(), originalPosts = D.clone(opened.state.posts);
  let state = D.sendMessage(opened.state, opened.threadId, '我周六下午需要一副，是否合适？', 'me', { id: 'm1', at });
  state = D.sendMessage(state, opened.threadId, '已批准，借给你！', 'other', { id: 'm2', at: later });
  assert.deepEqual(state.posts, originalPosts);
  assert.equal(state.threads[0].messages.length, 2); assert.ok(state.threads[0].messages.every(m => m.localDemo));
  assert.equal(state.threads[0].messages[1].role, 'other'); assert.ok(!('approval' in state.threads[0]));
  assert.equal(opened.state.threads[0].messages.length, 0);
});
test('空消息、超长消息、伪造角色与无会话被拒绝', () => {
  const opened = contacted();
  for (const [body, role] of [[' ', 'me'], ['x'.repeat(1001), 'me'], ['hello', 'system'], ['hello', 'owner']]) assert.throws(() => D.sendMessage(opened.state, opened.threadId, body, role, { at }));
  assert.throws(() => D.sendMessage(D.seed(), 'missing', 'hello', 'me', { at }));
});
test('重复 ID、失联会话、伪造真实发送或批准字段不能导入', () => {
  for (const mutate of [s => s.posts.push(D.clone(s.posts[0])), s => s.posts[0].approved = true, s => s.posts[0].rightsConfirmed = true, s => s.posts[0].ownerId = D.SELF_ID, s => s.posts[0].category = '__proto__', s => s.scope = 'public', s => s.inventory = []]) {
    const state = D.seed(); mutate(state); assert.throws(() => D.validateStore(state));
  }
  for (const mutate of [s => s.threads[0].postId = 'missing', s => s.threads[0].messages[0].localDemo = false, s => s.threads[0].messages[0].role = 'system', s => s.threads[0].messages.push(D.clone(s.threads[0].messages[0]))]) {
    const state = D.sendMessage(contacted().state, 'thread-1', 'hello', 'me', { id: 'm1', at }); mutate(state); assert.throws(() => D.validateStore(state));
  }
});
test('时间必须是实际存在的 ISO 日期，消息不能早于会话', () => {
  for (const bad of ['2026-02-30T00:00:00.000Z', '2026-11-05T25:00:00.000Z', '2026-11-05', 'bad']) assert.throws(() => D.publishPost(D.seed(), input(), { at: bad }));
  assert.throws(() => D.sendMessage(contacted().state, 'thread-1', 'hi', 'me', { at: '2026-11-05T00:00:00.000Z' }));
});
test('搜索可按用途、区域与类别查找，提供和求助各自过滤', () => {
  const state = D.seed();
  assert.equal(D.listPosts(state, { query: '拍摄' })[0].id, 'example-tripod');
  assert.equal(D.listPosts(state, { query: '家具', type: 'offer' })[0].id, 'example-chairs');
  assert.equal(D.listPosts(state, { type: 'request' }).length, 1);
  assert.equal(D.listPosts(state, { type: 'mine' }).length, 0);
  assert.equal(D.listPosts(state, { query: '没有这个物品' }).length, 0);
});
test('仓库仅访问自己的存储 key，不碰私人照片或库存，初次读取不会写入', () => {
  const storage = memoryStorage({ 'resource-commons-photo-drafts-v1': 'private-photo', 'resource-commons-v1': 'private-inventory' });
  const repo = D.repository(storage), first = repo.read();
  assert.ok(first.ok && first.missing); assert.equal(storage.writes.length, 0);
  const saved = repo.commit(first.state, D.publishPost(first.state, input(), { id: 'my-post', at }));
  assert.equal(saved.revision, 1); assert.deepEqual(storage.writes, [D.STORAGE_KEY]);
  assert.equal(storage.values.get('resource-commons-photo-drafts-v1'), 'private-photo');
  assert.equal(storage.values.get('resource-commons-v1'), 'private-inventory');
  assert.deepEqual(repo.read().state, saved);
});
test('损坏、超量和未知版本存储不会静默用示例覆盖', () => {
  for (const raw of ['{bad json', JSON.stringify({ ...D.seed(), version: 2 }), 'x'.repeat(D.MAX_BYTES + 1)]) {
    const storage = memoryStorage({ [D.STORAGE_KEY]: raw }), repo = D.repository(storage), read = repo.read();
    assert.equal(read.ok, false); assert.equal(read.state, null); assert.equal(storage.writes.length, 0);
    assert.throws(() => repo.commit(D.seed(), published())); assert.equal(storage.values.get(D.STORAGE_KEY), raw);
  }
});
test('拒绝过期页面覆盖另一个页面的互助记录', () => {
  const storage = memoryStorage(), repo = D.repository(storage), pageA = repo.read().state, pageB = repo.read().state;
  const latest = repo.commit(pageA, D.publishPost(pageA, input(), { id: 'a', at }));
  assert.throws(() => repo.commit(pageB, D.publishPost(pageB, input(), { id: 'b', at })), /另一个页面/);
  assert.deepEqual(repo.read().state, latest);
});
test('同版本外部修改仍触发冲突，不能覆盖坏数据', () => {
  const storage = memoryStorage(), repo = D.repository(storage), original = repo.read().state;
  const changed = D.clone(original); changed.posts[0].title = '其他页面的有效修改';
  storage.values.set(D.STORAGE_KEY, JSON.stringify(changed));
  assert.throws(() => repo.commit(original, published()), /记录已改变/); assert.equal(storage.writes.length, 0);
});
test('存储权限与空间失败明确报错，不主动清除既有记录', () => {
  const denied = D.repository({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } });
  assert.equal(denied.read().ok, false);
  const storage = memoryStorage({ [D.STORAGE_KEY]: JSON.stringify(D.seed()) });
  storage.setItem = () => { throw new Error('quota'); };
  const repo = D.repository(storage); assert.throws(() => repo.commit(D.seed(), published()), /保存失败/);
  assert.equal(storage.values.get(D.STORAGE_KEY), JSON.stringify(D.seed()));
});

// This minimal DOM only exercises module routing, escaping and send semantics;
// layout, focus and real browser persistence are checked separately in the browser.
class Container {
  constructor() { this.nodes = []; this.isConnected = true; this.html = ''; }
  set innerHTML(html) {
    this.html = html; this.nodes = [];
    for (const match of html.matchAll(/<(button|form|textarea|input|select|p|div|h1)\b([^>]*)>/g)) {
      const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(a => [a[1], a[2] ?? '']));
      const node = { tag: match[1], attrs, dataset: {}, textContent: '', hidden: ownAttr(attrs, 'hidden'), value: attrs.value || '', focus() {}, scrollTop: 0, scrollHeight: 0 };
      for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) node.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      node.querySelector = selector => this.querySelector(selector);
      this.nodes.push(node);
    }
  }
  get innerHTML() { return this.html; }
  querySelectorAll(selector) {
    return this.nodes.filter(n => selector.startsWith('#') ? n.attrs.id === selector.slice(1) : selector.startsWith('.') ? (n.attrs.class || '').split(' ').includes(selector.slice(1)) : selector.startsWith('[') ? (() => { const m = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/); return m && ownAttr(n.attrs, m[1]) && (m[2] === undefined || n.attrs[m[1]] === m[2]); })() : n.tag === selector);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function ownAttr(o, key) { return Object.prototype.hasOwnProperty.call(o, key); }
function ui(storage, options, eventHandlers) {
  const context = { CommunityData: D, localStorage: storage, addEventListener(type, handler) { if (eventHandlers) eventHandlers[type] = handler; }, console, FormData: class { constructor(form) { this.data = form.fields; } get(name) { return this.data[name] ?? null; } has(name) { return ownAttr(this.data, name); } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'community-ui.js'), 'utf8'), context);
  context.CommunityUI.init({ storage, ...options }); return context.CommunityUI;
}
test('界面所有示例都有来源标记，联系只创建空会话并导航消息', () => {
  const storage = memoryStorage(), routes = [], module = ui(storage, { onNavigate: route => routes.push(route) }), container = new Container();
  module.renderCommunity(container);
  assert.match(container.innerHTML, /本机演示/); assert.match(container.innerHTML, /尚未连接真实用户/);
  assert.equal(container.querySelectorAll('[data-community-action="detail"]').length, 4);
  container.querySelector('[data-community-action="detail"]').onclick();
  assert.match(container.innerHTML, /开放沟通 ≠ 已批准借用/);
  container.querySelector('[data-community-action="contact"]').onclick();
  assert.deepEqual(routes, ['messages']); assert.equal(D.repository(storage).read().state.threads[0].messages.length, 0);
  module.renderMessages(container); assert.match(container.innerHTML, /没有自动回复/); assert.match(container.innerHTML, /未发给真实用户/);
});
test('恶意帖子与消息内容只渲染为文本，不插入标签或属性', () => {
  const payload = '"><img src=x onerror="alert(1)">';
  let state = D.publishPost(D.seed(), { ...input(), title: payload, description: payload, area: payload, conditions: payload }, { id: 'xss', at });
  const opened = D.openThread(state, 'example-tripod', { id: 'thread-xss', at });
  state = D.sendMessage(opened.state, opened.threadId, payload, 'other', { id: 'message-xss', at });
  const module = ui(memoryStorage({ [D.STORAGE_KEY]: JSON.stringify(state) })), container = new Container();
  module.renderCommunity(container); assert.ok(!container.innerHTML.includes('<img')); assert.match(container.innerHTML, /&lt;img/);
  module.renderMessages(container); assert.ok(!container.innerHTML.includes('<img')); assert.match(container.innerHTML, /&lt;img/);
});
test('界面读取坏数据后暂停写操作，提供重试且保留原文', () => {
  const storage = memoryStorage({ [D.STORAGE_KEY]: 'not-json' }), module = ui(storage), container = new Container();
  module.renderCommunity(container); assert.match(container.innerHTML, /已暂停发布和发送/);
  assert.equal(container.querySelectorAll('[data-community-action="compose"]').length, 0);
  container.querySelector('[data-community-action="retry"]').onclick();
  assert.equal(storage.values.get(D.STORAGE_KEY), 'not-json'); assert.equal(storage.writes.length, 0);
});
test('离开互助或消息后，其他标签页更新不会覆盖当前页面；返回后读取最新记录', () => {
  for (const route of ['community', 'messages']) {
    const storage = memoryStorage(), events = {}, module = ui(storage, {}, events), container = new Container();
    route === 'community' ? module.renderCommunity(container) : module.renderMessages(container);
    module.deactivate();
    container.innerHTML = '<h1>物品库</h1>';
    const repo = D.repository(storage), before = repo.read().state;
    repo.commit(before, D.publishPost(before, input(), { id: 'other-tab-post', at }));
    events.storage({ key: D.STORAGE_KEY });
    assert.equal(container.innerHTML, '<h1>物品库</h1>');
    module.renderCommunity(container);
    assert.match(container.innerHTML, /闲置折叠桌/);
    const latest = repo.read().state;
    repo.commit(latest, D.closePost(latest, 'other-tab-post', { at: later }));
    events.storage({ key: D.STORAGE_KEY });
    assert.ok(!container.innerHTML.includes('闲置折叠桌'));
  }
});
test('发布表单未授权保留原文，明确勾选后发布，再由本人关闭', () => {
  const storage = memoryStorage(), module = ui(storage), container = new Container();
  module.renderCommunity(container); container.querySelector('[data-community-action="compose"]').onclick();
  const form = container.querySelector('[data-community-publish]'); form.fields = { ...input(), quantity: '2' }; delete form.fields.rightsConfirmed;
  form.onsubmit({ preventDefault() {}, currentTarget: form });
  assert.match(container.querySelector('[data-community-error]').textContent, /确认你有权/);
  assert.equal(storage.writes.length, 0); assert.equal(form.fields.title, '闲置折叠桌');
  form.fields.rightsConfirmed = 'on'; form.onsubmit({ preventDefault() {}, currentTarget: form });
  assert.equal(D.repository(storage).read().state.posts.length, 5);
  assert.match(container.innerHTML, /我在本机发布/);
  container.querySelector('[data-community-action="close"]').onclick();
  assert.equal(D.repository(storage).read().state.posts[0].status, 'closed');
  assert.match(container.innerHTML, /已关闭，不再出现在广场/);
});
test('消息界面只有手动提交才产生对方消息，切换身份保留各自草稿', () => {
  const original = contacted().state, storage = memoryStorage({ [D.STORAGE_KEY]: JSON.stringify(original) }), module = ui(storage), container = new Container();
  module.renderMessages(container);
  let form = container.querySelector('[data-message-compose]'), input = form.querySelector('textarea'), selector = form.querySelector('select');
  input.value = '我的尚未发送草稿'; input.oninput(); selector.value = 'other'; selector.onchange();
  assert.equal(D.repository(storage).read().state.threads[0].messages.length, 0);
  assert.match(container.innerHTML, /保存演示回复/);
  form = container.querySelector('[data-message-compose]'); input = form.querySelector('textarea'); input.value = '这是我手动输入的回复'; input.oninput();
  form.onsubmit({ preventDefault() {} });
  const saved = D.repository(storage).read().state;
  assert.equal(saved.threads[0].messages[0].role, 'other'); assert.equal(saved.threads[0].messages[0].localDemo, true);
  assert.deepEqual(saved.posts, original.posts); assert.match(container.innerHTML, /对方（手动演示）/);
  selector = container.querySelector('select'); selector.value = 'me'; selector.onchange();
  assert.match(container.innerHTML, /我的尚未发送草稿/);
});
test('单会话有容量限制，不截断和悄悄丢弃历史消息', () => {
  const state = contacted().state;
  state.threads[0].messages = Array.from({ length: 200 }, (_, index) => ({ id: 'm-' + index, body: '已保留消息 ' + index, role: 'me', at, localDemo: true }));
  assert.equal(D.validateStore(state).threads[0].messages.length, 200);
  assert.throws(() => D.sendMessage(state, 'thread-1', '第 201 条', 'me', { id: 'm-new', at }));
  assert.equal(state.threads[0].messages.length, 200);
});
test('总消息容量独立限制，单会话未满也不会无限增长', () => {
  const state = D.seed();
  for (let index = 0; index < 20; index++) {
    const post = D.clone(state.posts[0]); post.id = 'capacity-post-' + index; post.ownerId = 'demo-capacity-' + index; state.posts.push(post);
    state.threads.push({ id: 'capacity-thread-' + index, postId: post.id, createdAt: at, messages: Array.from({ length: 100 }, (_, n) => ({ id: 'message-' + index + '-' + n, role: 'me', body: '已保留的本机演示', at, localDemo: true })) });
  }
  assert.equal(D.validateStore(state).threads.length, 20);
  assert.throws(() => D.sendMessage(state, 'capacity-thread-0', '第 2001 条', 'me', { id: 'over-capacity', at }), /容量上限/);
  assert.equal(state.threads[0].messages.length, 100);
});
