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
  const categories = Object.freeze({ electronics: '电子设备', tools: '工具', furniture: '家具', stationery: '文具', event: '活动用品', other: '其他物品' });
  const clone = value => JSON.parse(JSON.stringify(value));
  const fail = message => { throw new Error(message); };
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function object(value, keys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail(label + '的数据格式不正确。');
    if (keys.some(k => !own(value, k))) fail(label + '缺少必要字段。');
  }
  function text(value, min, max, label) {
    if (typeof value !== 'string' || value.length > max || value.trim().length < min || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) fail(label + '请填写 ' + min + '—' + max + ' 个字符。');
    return value.trim();
  }
  function identifier(value) { return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value); }
  function timestamp(value) { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value; }
  function makeId(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }
  function context(options, prefix) {
    const at = options?.at || new Date().toISOString(), id = options?.id || makeId(prefix);
    if (!timestamp(at) || !identifier(id)) fail('操作时间或编号无效。');
    return { at, id };
  }
  function seed() {
    const at = '2026-11-05T01:00:00.000Z';
    const example = (id, type, title, category, quantity, area, description, conditions, ownerLabel) => ({ id, type, title, category, quantity, area, description, conditions, ownerId: 'demo-' + id, ownerLabel, isExample: true, rightsConfirmed: false, status: 'open', createdAt: at, updatedAt: at });
    return { version: 1, scope: 'local-demo', revision: 0, posts: [
      example('example-tripod', 'offer', '有一副闲置三脚架', 'electronics', 1, '学校附近', '适合活动拍摄。具体承重、接口和使用日期需要再核对。', '先说明用途和时间，确认后再安排交接。', '摄影社 · 示例'),
      example('example-chairs', 'offer', '六把折叠椅，活动时可协商', 'furniture', 6, '社区活动中心附近', '希望让闲置座椅在活动间隙得到利用。当前状态和可用时段待确认。', '协商数量、搬运和归还时间；尚未批准任何借用。', '邻里小组 · 示例'),
      example('example-boards', 'request', '周末展示想找两块展板', 'event', 2, '学校附近', '用于作品展，尺寸约 A1；合适的替代材料也可以先沟通。', '具体日期、尺寸和归还方式由双方协商。', '展览小组 · 示例'),
      example('example-tools', 'offer', '小工具箱，欢迎先问问', 'tools', 1, '社区附近', '包含常用手工具，具体清单与状态需要物主确认。', '限双方同意的用途；借出前逐件确认与登记。', '邻居 · 示例')
    ], threads: [] };
  }
  function validateStore(value) {
    object(value, ['version', 'scope', 'revision', 'posts', 'threads'], '互助记录');
    if (value.version !== 1 || value.scope !== 'local-demo' || !Number.isSafeInteger(value.revision) || value.revision < 0) fail('互助记录版本或范围不受支持，原记录已保留。');
    if (!Array.isArray(value.posts) || value.posts.length > 200 || !Array.isArray(value.threads) || value.threads.length > 200) fail('互助记录超出本机演示容量。');
    const postIds = new Set(), threadIds = new Set(), messageIds = new Set(), postThreads = new Set();
    for (const p of value.posts) {
      object(p, ['id', 'type', 'title', 'category', 'quantity', 'area', 'description', 'conditions', 'ownerId', 'ownerLabel', 'isExample', 'rightsConfirmed', 'status', 'createdAt', 'updatedAt'], '帖子');
      if (!identifier(p.id) || postIds.has(p.id)) fail('帖子编号无效或重复。');
      postIds.add(p.id);
      if (!['offer', 'request'].includes(p.type) || !own(categories, p.category) || !['open', 'closed'].includes(p.status)) fail('帖子类型、类别或状态无效。');
      if (!Number.isInteger(p.quantity) || p.quantity < 1 || p.quantity > 99) fail('数量应为 1—99 的整数。');
      for (const [key, min, max, label] of [['title', 1, 60, '标题'], ['area', 1, 60, '大致区域'], ['description', 1, 600, '说明'], ['conditions', 1, 300, '协商条件'], ['ownerLabel', 1, 60, '发布者']]) text(p[key], min, max, label);
      if (!identifier(p.ownerId) || typeof p.isExample !== 'boolean' || typeof p.rightsConfirmed !== 'boolean' || !timestamp(p.createdAt) || !timestamp(p.updatedAt) || p.updatedAt < p.createdAt) fail('帖子来源或时间无效。');
      if (p.isExample ? !p.ownerId.startsWith('demo-') || p.rightsConfirmed !== false : p.ownerId !== SELF_ID || p.rightsConfirmed !== true || p.ownerLabel !== '我（本机）') fail('帖子必须明确区分虚构示例与本人确认发布。');
    }
    let messageCount = 0;
    for (const t of value.threads) {
      object(t, ['id', 'postId', 'createdAt', 'messages'], '会话');
      const post = value.posts.find(p => p.id === t.postId);
      if (!identifier(t.id) || threadIds.has(t.id) || !post || post.ownerId === SELF_ID || postThreads.has(t.postId) || !timestamp(t.createdAt) || !Array.isArray(t.messages) || t.messages.length > 200) fail('会话来源或编号无效。');
      threadIds.add(t.id); postThreads.add(t.postId);
      messageCount += t.messages.length;
      for (const m of t.messages) {
        object(m, ['id', 'role', 'body', 'at', 'localDemo'], '消息');
        if (!identifier(m.id) || messageIds.has(m.id) || !['me', 'other'].includes(m.role) || m.localDemo !== true || !timestamp(m.at) || m.at < t.createdAt) fail('消息必须是明确标记的本机演示，且编号与时间有效。');
        text(m.body, 1, 1000, '消息'); messageIds.add(m.id);
      }
    }
    if (messageCount > 2000 || JSON.stringify(value).length > MAX_BYTES) fail('本机演示记录已接近容量上限。');
    return clone(value);
  }
  function publishPost(value, input, options) {
    const state = validateStore(value);
    if (!input || input.rightsConfirmed !== true) fail('请先确认你有权发布这些信息，提供物品时有权发起共享协商。');
    const { id, at } = context(options, 'post');
    if (state.posts.length >= 200 || state.posts.some(p => p.id === id)) fail('帖子容量已满或编号重复。');
    if (!['offer', 'request'].includes(input.type) || !own(categories, input.category)) fail('请选择发布类型与类别。');
    const post = { id, type: input.type, title: text(input.title, 1, 60, '标题'), category: input.category, quantity: input.quantity, area: text(input.area, 1, 60, '大致区域'), description: text(input.description, 1, 600, '说明'), conditions: text(input.conditions, 1, 300, '协商条件'), ownerId: SELF_ID, ownerLabel: '我（本机）', isExample: false, rightsConfirmed: true, status: 'open', createdAt: at, updatedAt: at };
    state.posts.unshift(post);
    return validateStore(state);
  }
  function closePost(value, postId, options) {
    const state = validateStore(value), post = state.posts.find(p => p.id === postId);
    if (!post || post.ownerId !== SELF_ID || post.isExample) fail('只能关闭自己在本机明确发布的帖子。');
    if (post.status !== 'open') fail('这条帖子已经关闭。');
    const at = options?.at || new Date().toISOString();
    if (!timestamp(at) || at < post.createdAt) fail('关闭时间无效。');
    post.status = 'closed'; post.updatedAt = at;
    return validateStore(state);
  }
  function openThread(value, postId, options) {
    const state = validateStore(value), post = state.posts.find(p => p.id === postId);
    if (!post || post.ownerId === SELF_ID) fail('请选择其他发布者的帖子。');
    const existing = state.threads.find(t => t.postId === postId);
    if (existing) return { state, threadId: existing.id, created: false };
    if (post.status !== 'open') fail('帖子已关闭，无法开始新会话。');
    const { id, at } = context(options, 'thread');
    if (state.threads.length >= 200 || state.threads.some(t => t.id === id)) fail('会话容量已满或编号重复。');
    state.threads.unshift({ id, postId, createdAt: at, messages: [] });
    return { state: validateStore(state), threadId: id, created: true };
  }
  function sendMessage(value, threadId, body, role, options) {
    const state = validateStore(value), thread = state.threads.find(t => t.id === threadId);
    if (!thread || !['me', 'other'].includes(role)) fail('请选择有效会话与演示身份。');
    const { id, at } = context(options, 'message');
    if (state.threads.some(t => t.messages.some(m => m.id === id))) fail('消息编号重复。');
    thread.messages.push({ id, role, body: text(body, 1, 1000, '消息'), at, localDemo: true });
    return validateStore(state);
  }
  function listPosts(value, options) {
    const state = validateStore(value), query = typeof options?.query === 'string' ? options.query.trim().slice(0, 100).toLocaleLowerCase() : '', type = options?.type || 'all';
    return state.posts.filter(p => (type === 'mine' || p.status === 'open') && (type === 'mine' ? p.ownerId === SELF_ID : type === 'all' || p.type === type) && (!query || [p.title, p.description, p.area, p.conditions, categories[p.category]].some(v => v.toLocaleLowerCase().includes(query))));
  }
  function repository(storage) {
    const read = () => {
      try {
        if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') fail('浏览器未允许本机存储。');
        const raw = storage.getItem(STORAGE_KEY);
        if (raw === null) return { ok: true, state: seed(), missing: true };
        if (typeof raw !== 'string' || raw.length > MAX_BYTES) fail('互助记录过大或格式无效。');
        return { ok: true, state: validateStore(JSON.parse(raw)), missing: false };
      } catch (error) { return { ok: false, state: null, missing: false, error: '互助记录暂时无法读取，原记录未改动。' + (error instanceof Error ? error.message : '') }; }
    };
    const commit = (previous, next) => {
      const before = validateStore(previous), after = validateStore(next), current = read();
      if (!current.ok) fail(current.error);
      if (current.state.revision !== before.revision) fail('另一个页面已更新互助记录，请刷新后再试。');
      // Read-before-write also prevents overwriting a same-revision edit made outside this module.
      if (JSON.stringify(current.state) !== JSON.stringify(before)) fail('互助记录已改变，请刷新后再试。');
      after.revision = before.revision + 1;
      const raw = JSON.stringify(validateStore(after));
      if (raw.length > MAX_BYTES) fail('本机存储空间不足，请减少记录。');
      try { storage.setItem(STORAGE_KEY, raw); } catch (_) { fail('保存失败：浏览器存储空间不足或未允许存储。原记录未被主动清除。'); }
      return after;
    };
    return { read, commit };
  }
  return Object.freeze({ STORAGE_KEY, SELF_ID, MAX_BYTES, categories, clone, seed, validateStore, publishPost, closePost, openThread, sendMessage, listPosts, repository });
});
