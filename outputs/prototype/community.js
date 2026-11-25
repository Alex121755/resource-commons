(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CommunityData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const STORAGE_KEY = 'resource-commons-community-v1';
  const SELF_ID = 'local-me';
  const MAX_BYTES = 1500000;
  const categories = Object.freeze({ electronics: 'Electronics', tools: 'Tools', furniture: 'Furniture', stationery: 'Stationery', event: 'Event supplies', other: 'Other items' });
  const clone = value => JSON.parse(JSON.stringify(value));
  const fail = message => { throw new Error(message); };
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function object(value, keys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail(label + ' has an invalid format.');
    if (keys.some(k => !own(value, k))) fail(label + ' is missing required fields.');
  }
  function text(value, min, max, label) {
    if (typeof value !== 'string' || value.length > max || value.trim().length < min || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) fail(label + ' must contain ' + min + ' to ' + max + ' characters.');
    return value.trim();
  }
  function identifier(value) { return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value); }
  function timestamp(value) { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value; }
  function makeId(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }
  function context(options, prefix) {
    const at = options?.at || new Date().toISOString(), id = options?.id || makeId(prefix);
    if (!timestamp(at) || !identifier(id)) fail('Invalid timestamp or ID.');
    return { at, id };
  }
  function seed() {
    const at = '2026-11-05T01:00:00.000Z';
    const example = (id, type, title, category, quantity, area, description, conditions, ownerLabel) => ({ id, type, title, category, quantity, area, description, conditions, ownerId: 'demo-' + id, ownerLabel, isExample: true, rightsConfirmed: false, status: 'open', createdAt: at, updatedAt: at });
    return { version: 1, scope: 'local-demo', revision: 0, posts: [
      example('example-tripod', 'offer', 'Spare tripod for filming', 'electronics', 1, 'Near school', 'Suitable for filming events. Check the load limit, connector, and available dates.', 'Tell us the purpose and dates so we can arrange pickup.', 'Photography club · Example'),
      example('example-chairs', 'offer', 'Six folding chairs for events', 'furniture', 6, 'Near the community center', 'Available between events. Please confirm the chairs’ condition and available dates.', 'Agree on the quantity, transport, and return time before borrowing.', 'Neighborhood group · Example'),
      example('example-boards', 'request', 'Two boards needed for a weekend exhibit', 'event', 2, 'Near school', 'For a student exhibition, approximately A1. Similar materials are welcome.', 'Discuss dates, dimensions, and return arrangements with the owner.', 'Exhibition team · Example'),
      example('example-tools', 'offer', 'Small toolbox available', 'tools', 1, 'Near the neighborhood center', 'Includes common hand tools. Ask the owner for the contents and condition.', 'Agree on the intended use and record each tool before pickup.', 'Neighbor · Example')
    ], threads: [] };
  }
  function validateStore(value) {
    object(value, ['version', 'scope', 'revision', 'posts', 'threads'], 'Community data');
    if (value.version !== 1 || value.scope !== 'local-demo' || !Number.isSafeInteger(value.revision) || value.revision < 0) fail('Unsupported board version or scope. Your records have been retained.');
    if (!Array.isArray(value.posts) || value.posts.length > 200 || !Array.isArray(value.threads) || value.threads.length > 200) fail('Local demo storage limit exceeded.');
    const postIds = new Set(), threadIds = new Set(), messageIds = new Set(), postThreads = new Set();
    for (const p of value.posts) {
      object(p, ['id', 'type', 'title', 'category', 'quantity', 'area', 'description', 'conditions', 'ownerId', 'ownerLabel', 'isExample', 'rightsConfirmed', 'status', 'createdAt', 'updatedAt'], 'Post');
      if (!identifier(p.id) || postIds.has(p.id)) fail('Invalid or duplicate post ID.');
      postIds.add(p.id);
      if (!['offer', 'request'].includes(p.type) || !own(categories, p.category) || !['open', 'closed'].includes(p.status)) fail('Invalid post type, category, or status.');
      if (!Number.isInteger(p.quantity) || p.quantity < 1 || p.quantity > 99) fail('Quantity must be a whole number from 1 to 99.');
      for (const [key, min, max, label] of [['title', 1, 60, 'Title'], ['area', 1, 60, 'Area'], ['description', 1, 600, 'Description'], ['conditions', 1, 300, 'Terms'], ['ownerLabel', 1, 60, 'Author']]) text(p[key], min, max, label);
      if (!identifier(p.ownerId) || typeof p.isExample !== 'boolean' || typeof p.rightsConfirmed !== 'boolean' || !timestamp(p.createdAt) || !timestamp(p.updatedAt) || p.updatedAt < p.createdAt) fail('Invalid post origin or date.');
      if (p.isExample ? !p.ownerId.startsWith('demo-') || p.rightsConfirmed !== false : p.ownerId !== SELF_ID || p.rightsConfirmed !== true || !['Me (this device)', '\u6211\uFF08\u672C\u673A\uFF09'].includes(p.ownerLabel)) fail('Identify each post as a sample or one you published.');
    }
    let messageCount = 0;
    for (const t of value.threads) {
      object(t, ['id', 'postId', 'createdAt', 'messages'], 'Conversation');
      const post = value.posts.find(p => p.id === t.postId);
      if (!identifier(t.id) || threadIds.has(t.id) || !post || post.ownerId === SELF_ID || postThreads.has(t.postId) || !timestamp(t.createdAt) || !Array.isArray(t.messages) || t.messages.length > 200) fail('Invalid conversation source or ID.');
      threadIds.add(t.id); postThreads.add(t.postId);
      messageCount += t.messages.length;
      for (const m of t.messages) {
        object(m, ['id', 'role', 'body', 'at', 'localDemo'], 'Messages');
        if (!identifier(m.id) || messageIds.has(m.id) || !['me', 'other'].includes(m.role) || m.localDemo !== true || !timestamp(m.at) || m.at < t.createdAt) fail('A message needs a valid ID, timestamp, and local demo marker.');
        text(m.body, 1, 1000, 'Messages'); messageIds.add(m.id);
      }
    }
    if (messageCount > 2000 || JSON.stringify(value).length > MAX_BYTES) fail('The local demo has reached its record limit.');
    const result = clone(value);
    for (const post of result.posts) {
      if (post.ownerId === SELF_ID) post.ownerLabel = 'Me (this device)';
    }
    return result;
  }
  function publishPost(value, input, options) {
    const state = validateStore(value);
    if (!input || input.rightsConfirmed !== true) fail('Confirm you have permission to publish these details and offer this item.');
    const { id, at } = context(options, 'post');
    if (state.posts.length >= 200 || state.posts.some(p => p.id === id)) fail('Post limit reached or duplicate ID.');
    if (!['offer', 'request'].includes(input.type) || !own(categories, input.category)) fail('Choose a post type and category.');
    const post = { id, type: input.type, title: text(input.title, 1, 60, 'Title'), category: input.category, quantity: input.quantity, area: text(input.area, 1, 60, 'Area'), description: text(input.description, 1, 600, 'Description'), conditions: text(input.conditions, 1, 300, 'Terms'), ownerId: SELF_ID, ownerLabel: 'Me (this device)', isExample: false, rightsConfirmed: true, status: 'open', createdAt: at, updatedAt: at };
    state.posts.unshift(post);
    return validateStore(state);
  }
  function closePost(value, postId, options) {
    const state = validateStore(value), post = state.posts.find(p => p.id === postId);
    if (!post || post.ownerId !== SELF_ID || post.isExample) fail('You can close only posts you published on this device.');
    if (post.status !== 'open') fail('This post is already closed.');
    const at = options?.at || new Date().toISOString();
    if (!timestamp(at) || at < post.createdAt) fail('Invalid closing time.');
    post.status = 'closed'; post.updatedAt = at;
    return validateStore(state);
  }
  function openThread(value, postId, options) {
    const state = validateStore(value), post = state.posts.find(p => p.id === postId);
    if (!post || post.ownerId === SELF_ID) fail('Choose another author’s post.');
    const existing = state.threads.find(t => t.postId === postId);
    if (existing) return { state, threadId: existing.id, created: false };
    if (post.status !== 'open') fail('Closed posts cannot start a conversation.');
    const { id, at } = context(options, 'thread');
    if (state.threads.length >= 200 || state.threads.some(t => t.id === id)) fail('Conversation limit reached or duplicate ID.');
    state.threads.unshift({ id, postId, createdAt: at, messages: [] });
    return { state: validateStore(state), threadId: id, created: true };
  }
  function sendMessage(value, threadId, body, role, options) {
    const state = validateStore(value), thread = state.threads.find(t => t.id === threadId);
    if (!thread || !['me', 'other'].includes(role)) fail('Choose a valid conversation and demo role.');
    const { id, at } = context(options, 'message');
    if (state.threads.some(t => t.messages.some(m => m.id === id))) fail('Duplicate message ID.');
    thread.messages.push({ id, role, body: text(body, 1, 1000, 'Messages'), at, localDemo: true });
    return validateStore(state);
  }
  function listPosts(value, options) {
    const state = validateStore(value), query = typeof options?.query === 'string' ? options.query.trim().slice(0, 100).toLocaleLowerCase() : '', type = options?.type || 'all';
    return state.posts.filter(p => (type === 'mine' || p.status === 'open') && (type === 'mine' ? p.ownerId === SELF_ID : type === 'all' || p.type === type) && (!query || [p.title, p.description, p.area, p.conditions, categories[p.category]].some(v => v.toLocaleLowerCase().includes(query))));
  }
  function repository(storage) {
    const read = () => {
      try {
        if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') fail('Browser storage is unavailable.');
        const raw = storage.getItem(STORAGE_KEY);
        if (raw === null) return { ok: true, state: seed(), missing: true };
        if (typeof raw !== 'string' || raw.length > MAX_BYTES) fail('Board records exceed the size limit or have an invalid format.');
        return { ok: true, state: validateStore(JSON.parse(raw)), missing: false };
      } catch (error) { return { ok: false, state: null, missing: false, error: 'Could not read local records. Your data was retained. ' + (error instanceof Error ? error.message : '') }; }
    };
    const commit = (previous, next) => {
      const before = validateStore(previous), after = validateStore(next), current = read();
      if (!current.ok) fail(current.error);
      if (current.state.revision !== before.revision) fail('Another tab updated the board. Refresh before continuing.');
      // Read-before-write also prevents overwriting a same-revision edit made outside this module.
      if (JSON.stringify(current.state) !== JSON.stringify(before)) fail('Board records changed. Refresh before continuing.');
      after.revision = before.revision + 1;
      const raw = JSON.stringify(validateStore(after));
      if (raw.length > MAX_BYTES) fail('Insufficient browser storage. Reduce the number of records.');
      try { storage.setItem(STORAGE_KEY, raw); } catch (_) { fail('Save failed. Check browser storage permissions and available space.'); }
      return after;
    };
    return { read, commit };
  }
  return Object.freeze({ STORAGE_KEY, SELF_ID, MAX_BYTES, categories, clone, seed, validateStore, publishPost, closePost, openThread, sendMessage, listPosts, repository });
});
