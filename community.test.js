'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('./community.js');
const at = '2026-11-05T02:00:00.000Z';
const later = '2026-11-05T03:00:00.000Z';
const input = () => ({ type: 'offer', title: 'Spare folding table', description: 'Confirm dimensions and availability first.', category: 'furniture', quantity: 2, area: 'Near school', conditions: 'Saturday by arrangement. Confirm transport and return.', rightsConfirmed: true });
function memoryStorage(initial) {
  const values = new Map(Object.entries(initial || {})), writes = [];
  return { values, writes, getItem(key) { return values.has(key) ? values.get(key) : null; }, setItem(key, value) { writes.push(key); values.set(key, value); } };
}
function published() { return D.publishPost(D.seed(), input(), { id: 'my-post', at }); }
function contacted() { return D.openThread(D.seed(), 'example-tripod', { id: 'thread-1', at }); }

test('Four fictional listings are isolated from private inventory and approvals', () => {
  const state = D.seed(); assert.equal(state.posts.length, 4); assert.equal(state.threads.length, 0);
  assert.equal(state.scope, 'local-demo'); assert.ok(state.posts.every(p => p.isExample && !p.rightsConfirmed));
  assert.deepEqual(Object.keys(state).sort(), ['posts', 'revision', 'scope', 'threads', 'version']);
  assert.deepEqual(D.validateStore(JSON.parse(JSON.stringify(state))), state);
});
test('Posting needs explicit permission and a string  true  is insufficient', () => {
  for (const value of [false, null, undefined, 'true', 1]) assert.throws(() => D.publishPost(D.seed(), { ...input(), rightsConfirmed: value }, { at }));
  assert.throws(() => D.publishPost(D.seed(), { ...input(), type: 'request', rightsConfirmed: false }, { at }));
});
test('Creating a local post does not copy inventory or fabricate approval', () => {
  const state = D.seed(), copy = D.clone(state);
  const next = D.publishPost(state, { ...input(), ownerId: 'someone-else', approval: 'approved', inventory: ['private'], photo: 'secret' }, { id: 'my-post', at });
  assert.deepEqual(state, copy); assert.equal(next.posts.length, 5);
  assert.equal(next.posts[0].ownerId, D.SELF_ID); assert.equal(next.posts[0].isExample, false);
  assert.ok(!('approval' in next.posts[0])); assert.ok(!('photo' in next.posts[0]));
});
test('Invalid categories, types, quantities, and oversized fields preserve state', () => {
  const state = D.seed(), before = JSON.stringify(state);
  for (const mutate of [p => p.category = '__proto__', p => p.type = 'approved', p => p.quantity = 0, p => p.quantity = 1.5, p => p.quantity = 100, p => p.title = 'x'.repeat(61), p => p.description = ' ', p => p.area = '', p => p.conditions = 'x'.repeat(301)]) {
    const value = input(); mutate(value); assert.throws(() => D.publishPost(state, value, { at }));
  }
  assert.equal(JSON.stringify(state), before);
});
test('Contacting a post twice reuses the thread without sending an automatic reply', () => {
  const opened = contacted(), repeated = D.openThread(opened.state, 'example-tripod', { id: 'other-thread', at: later });
  assert.equal(repeated.created, false); assert.equal(repeated.threadId, 'thread-1');
  assert.equal(repeated.state.threads.length, 1); assert.deepEqual(repeated.state.threads[0].messages, []);
});
test('Authors cannot contact themselves', () => {
  assert.throws(() => D.openThread(published(), 'my-post', { at }));
  assert.throws(() => D.openThread(D.seed(), 'not-found', { at }));
});
test('Only the current author can close their local posts', () => {
  assert.throws(() => D.closePost(D.seed(), 'example-tripod', { at }));
  const state = published(), next = D.closePost(state, 'my-post', { at: later });
  assert.equal(state.posts[0].status, 'open'); assert.equal(next.posts[0].status, 'closed');
  assert.throws(() => D.closePost(next, 'my-post', { at: later }));
  assert.ok(!D.listPosts(next).some(p => p.id === 'my-post'));
  assert.equal(D.listPosts(next, { type: 'mine' })[0].status, 'closed');
});
test('Messages from both demo roles include  localDemo without approving loans or changing inventory', () => {
  const opened = contacted(), originalPosts = D.clone(opened.state.posts);
  let state = D.sendMessage(opened.state, opened.threadId, 'I need one on Saturday afternoon. Would that work?', 'me', { id: 'm1', at });
  state = D.sendMessage(state, opened.threadId, 'Approved, you can borrow it!', 'other', { id: 'm2', at: later });
  assert.deepEqual(state.posts, originalPosts);
  assert.equal(state.threads[0].messages.length, 2); assert.ok(state.threads[0].messages.every(m => m.localDemo));
  assert.equal(state.threads[0].messages[1].role, 'other'); assert.ok(!('approval' in state.threads[0]));
  assert.equal(opened.state.threads[0].messages.length, 0);
});
test('Empty and oversized messages, invalid roles, and missing threads are rejected', () => {
  const opened = contacted();
  for (const [body, role] of [[' ', 'me'], ['x'.repeat(1001), 'me'], ['hello', 'system'], ['hello', 'owner']]) assert.throws(() => D.sendMessage(opened.state, opened.threadId, body, role, { at }));
  assert.throws(() => D.sendMessage(D.seed(), 'missing', 'hello', 'me', { at }));
});
test('Duplicate  ID, orphan threads, and forged delivery or approval fields cannot be imported', () => {
  for (const mutate of [s => s.posts.push(D.clone(s.posts[0])), s => s.posts[0].approved = true, s => s.posts[0].rightsConfirmed = true, s => s.posts[0].ownerId = D.SELF_ID, s => s.posts[0].category = '__proto__', s => s.scope = 'public', s => s.inventory = []]) {
    const state = D.seed(); mutate(state); assert.throws(() => D.validateStore(state));
  }
  for (const mutate of [s => s.threads[0].postId = 'missing', s => s.threads[0].messages[0].localDemo = false, s => s.threads[0].messages[0].role = 'system', s => s.threads[0].messages.push(D.clone(s.threads[0].messages[0]))]) {
    const state = D.sendMessage(contacted().state, 'thread-1', 'hello', 'me', { id: 'm1', at }); mutate(state); assert.throws(() => D.validateStore(state));
  }
});
test('Timestamps must be valid  ISO  dates and messages cannot predate their thread', () => {
  for (const bad of ['2026-02-30T00:00:00.000Z', '2026-11-05T25:00:00.000Z', '2026-11-05', 'bad']) assert.throws(() => D.publishPost(D.seed(), input(), { at: bad }));
  assert.throws(() => D.sendMessage(contacted().state, 'thread-1', 'hi', 'me', { at: '2026-11-05T00:00:00.000Z' }));
});
test('Search filters by purpose, area, category, and offer or request', () => {
  const state = D.seed();
  assert.equal(D.listPosts(state, { query: 'filming' })[0].id, 'example-tripod');
  assert.equal(D.listPosts(state, { query: 'Furniture', type: 'offer' })[0].id, 'example-chairs');
  assert.equal(D.listPosts(state, { type: 'request' }).length, 1);
  assert.equal(D.listPosts(state, { type: 'mine' }).length, 0);
  assert.equal(D.listPosts(state, { query: 'absent item' }).length, 0);
});
test('The repository uses only its own storage  key and reads without writing or accessing private inventory', () => {
  const storage = memoryStorage({ 'resource-commons-photo-drafts-v1': 'private-photo', 'resource-commons-v1': 'private-inventory' });
  const repo = D.repository(storage), first = repo.read();
  assert.ok(first.ok && first.missing); assert.equal(storage.writes.length, 0);
  const saved = repo.commit(first.state, D.publishPost(first.state, input(), { id: 'my-post', at }));
  assert.equal(saved.revision, 1); assert.deepEqual(storage.writes, [D.STORAGE_KEY]);
  assert.equal(storage.values.get('resource-commons-photo-drafts-v1'), 'private-photo');
  assert.equal(storage.values.get('resource-commons-v1'), 'private-inventory');
  assert.deepEqual(repo.read().state, saved);
});
test('Corrupt, oversized, and unsupported data is never overwritten with samples', () => {
  for (const raw of ['{bad json', JSON.stringify({ ...D.seed(), version: 2 }), 'x'.repeat(D.MAX_BYTES + 1)]) {
    const storage = memoryStorage({ [D.STORAGE_KEY]: raw }), repo = D.repository(storage), read = repo.read();
    assert.equal(read.ok, false); assert.equal(read.state, null); assert.equal(storage.writes.length, 0);
    assert.throws(() => repo.commit(D.seed(), published())); assert.equal(storage.values.get(D.STORAGE_KEY), raw);
  }
});
test('A stale tab cannot overwrite newer board records', () => {
  const storage = memoryStorage(), repo = D.repository(storage), pageA = repo.read().state, pageB = repo.read().state;
  const latest = repo.commit(pageA, D.publishPost(pageA, input(), { id: 'a', at }));
  assert.throws(() => repo.commit(pageB, D.publishPost(pageB, input(), { id: 'b', at })), /Another tab/);
  assert.deepEqual(repo.read().state, latest);
});
test('Same-version edits trigger a conflict and preserve invalid data', () => {
  const storage = memoryStorage(), repo = D.repository(storage), original = repo.read().state;
  const changed = D.clone(original); changed.posts[0].title = 'Valid edit in another tab';
  storage.values.set(D.STORAGE_KEY, JSON.stringify(changed));
  assert.throws(() => repo.commit(original, published()), /records changed/); assert.equal(storage.writes.length, 0);
});
test('Storage errors retain existing records', () => {
  const denied = D.repository({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } });
  assert.equal(denied.read().ok, false);
  const storage = memoryStorage({ [D.STORAGE_KEY]: JSON.stringify(D.seed()) });
  storage.setItem = () => { throw new Error('quota'); };
  const repo = D.repository(storage); assert.throws(() => repo.commit(D.seed(), published()), /Save failed/);
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
test('The UI labels each sample and opens an empty conversation on contact', () => {
  const storage = memoryStorage(), routes = [], module = ui(storage, { onNavigate: route => routes.push(route) }), container = new Container();
  module.renderCommunity(container);
  assert.match(container.innerHTML, /Local demo/); assert.match(container.innerHTML, /Posts and messages stay in this browser/);
  assert.equal(container.querySelectorAll('[data-community-action="detail"]').length, 4);
  container.querySelector('[data-community-action="detail"]').onclick();
  assert.match(container.innerHTML, /Confirm permission with the owner before borrowing/);
  container.querySelector('[data-community-action="contact"]').onclick();
  assert.deepEqual(routes, ['messages']); assert.equal(D.repository(storage).read().state.threads[0].messages.length, 0);
  module.renderMessages(container); assert.match(container.innerHTML, /Switch the sender below to try both sides of the conversation/); assert.match(container.innerHTML, /Local demo messages/);
});
test('Untrusted message and post content is rendered as text', () => {
  const payload = '"><img src=x onerror="alert(1)">';
  let state = D.publishPost(D.seed(), { ...input(), title: payload, description: payload, area: payload, conditions: payload }, { id: 'xss', at });
  const opened = D.openThread(state, 'example-tripod', { id: 'thread-xss', at });
  state = D.sendMessage(opened.state, opened.threadId, payload, 'other', { id: 'message-xss', at });
  const module = ui(memoryStorage({ [D.STORAGE_KEY]: JSON.stringify(state) })), container = new Container();
  module.renderCommunity(container); assert.ok(!container.innerHTML.includes('<img')); assert.match(container.innerHTML, /&lt;img/);
  module.renderMessages(container); assert.ok(!container.innerHTML.includes('<img')); assert.match(container.innerHTML, /&lt;img/);
});
test('Corrupt records pause UI writes and enable retry', () => {
  const storage = memoryStorage({ [D.STORAGE_KEY]: 'not-json' }), module = ui(storage), container = new Container();
  module.renderCommunity(container); assert.match(container.innerHTML, /Local board data is unavailable/);
  assert.equal(container.querySelectorAll('[data-community-action="compose"]').length, 0);
  container.querySelector('[data-community-action="retry"]').onclick();
  assert.equal(storage.values.get(D.STORAGE_KEY), 'not-json'); assert.equal(storage.writes.length, 0);
});
test('Board updates in another tab never interrupt the current page', () => {
  for (const route of ['community', 'messages']) {
    const storage = memoryStorage(), events = {}, module = ui(storage, {}, events), container = new Container();
    route === 'community' ? module.renderCommunity(container) : module.renderMessages(container);
    module.deactivate();
    container.innerHTML = '<h1>Inventory</h1>';
    const repo = D.repository(storage), before = repo.read().state;
    repo.commit(before, D.publishPost(before, input(), { id: 'other-tab-post', at }));
    events.storage({ key: D.STORAGE_KEY });
    assert.equal(container.innerHTML, '<h1>Inventory</h1>');
    module.renderCommunity(container);
    assert.match(container.innerHTML, /Spare folding table/);
    const latest = repo.read().state;
    repo.commit(latest, D.closePost(latest, 'other-tab-post', { at: later }));
    events.storage({ key: D.STORAGE_KEY });
    assert.ok(!container.innerHTML.includes('Spare folding table'));
  }
});
test('Submitting without permission preserves the draft and authorized posts can be closed', () => {
  const storage = memoryStorage(), module = ui(storage), container = new Container();
  module.renderCommunity(container); container.querySelector('[data-community-action="compose"]').onclick();
  const form = container.querySelector('[data-community-publish]'); form.fields = { ...input(), quantity: '2' }; delete form.fields.rightsConfirmed;
  form.onsubmit({ preventDefault() {}, currentTarget: form });
  assert.match(container.querySelector('[data-community-error]').textContent, /Confirm you have permission/);
  assert.equal(storage.writes.length, 0); assert.equal(form.fields.title, 'Spare folding table');
  form.fields.rightsConfirmed = 'on'; form.onsubmit({ preventDefault() {}, currentTarget: form });
  assert.equal(D.repository(storage).read().state.posts.length, 5);
  assert.match(container.innerHTML, /Posted on this device/);
  container.querySelector('[data-community-action="close"]').onclick();
  assert.equal(D.repository(storage).read().state.posts[0].status, 'closed');
  assert.match(container.innerHTML, /Closed and removed from the board/);
});
test('Role switching preserves each draft and only manual sends add messages', () => {
  const original = contacted().state, storage = memoryStorage({ [D.STORAGE_KEY]: JSON.stringify(original) }), module = ui(storage), container = new Container();
  module.renderMessages(container);
  let form = container.querySelector('[data-message-compose]'), input = form.querySelector('textarea'), selector = form.querySelector('select');
  input.value = 'My unsent draft'; input.oninput(); selector.value = 'other'; selector.onchange();
  assert.equal(D.repository(storage).read().state.threads[0].messages.length, 0);
  assert.match(container.innerHTML, /Save demo reply/);
  form = container.querySelector('[data-message-compose]'); input = form.querySelector('textarea'); input.value = 'I typed this reply myself'; input.oninput();
  form.onsubmit({ preventDefault() {} });
  const saved = D.repository(storage).read().state;
  assert.equal(saved.threads[0].messages[0].role, 'other'); assert.equal(saved.threads[0].messages[0].localDemo, true);
  assert.deepEqual(saved.posts, original.posts); assert.match(container.innerHTML, /Other member \(demo\)/);
  selector = container.querySelector('select'); selector.value = 'me'; selector.onchange();
  assert.match(container.innerHTML, /My unsent draft/);
});
test('Conversation limits preserve messages without truncation', () => {
  const state = contacted().state;
  state.threads[0].messages = Array.from({ length: 200 }, (_, index) => ({ id: 'm-' + index, body: 'Saved message ' + index, role: 'me', at, localDemo: true }));
  assert.equal(D.validateStore(state).threads[0].messages.length, 200);
  assert.throws(() => D.sendMessage(state, 'thread-1', 'Message  201  posts', 'me', { id: 'm-new', at }));
  assert.equal(state.threads[0].messages.length, 200);
});
test('Total message limits apply across all conversations', () => {
  const state = D.seed();
  for (let index = 0; index < 20; index++) {
    const post = D.clone(state.posts[0]); post.id = 'capacity-post-' + index; post.ownerId = 'demo-capacity-' + index; state.posts.push(post);
    state.threads.push({ id: 'capacity-thread-' + index, postId: post.id, createdAt: at, messages: Array.from({ length: 100 }, (_, n) => ({ id: 'message-' + index + '-' + n, role: 'me', body: 'Existing local demo message', at, localDemo: true })) });
  }
  assert.equal(D.validateStore(state).threads.length, 20);
  assert.throws(() => D.sendMessage(state, 'capacity-thread-0', 'Message  2001  posts', 'me', { id: 'over-capacity', at }), /record limit/);
  assert.equal(state.threads[0].messages.length, 100);
});
