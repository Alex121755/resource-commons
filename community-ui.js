(function (root) {
  'use strict';
  const D = root.CommunityData;
  if (!D) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let repo, callbacks = {}, active, state, selectedPost = '', selectedThread = '', filter = 'all', query = '', composing = false, role = 'me', initialized = false, area = '', composeType = 'offer', listScroll = 0, listFocusId = '', messageOpen = false;
  const messageDrafts = new Map();
  function initialize(options = {}) {
    callbacks = options;
    try { repo = D.repository(options.storage || root.localStorage); } catch (_) { repo = D.repository(null); }
    if (!initialized && root.addEventListener) {
      root.addEventListener('storage', event => {
        // Keep an unfinished publishing form intact; commit detects stale state instead
        // of discarding the user's text when another tab writes.
        if (event.key === D.STORAGE_KEY && active?.container?.isConnected && !(active.kind === 'community' && composing)) renderActive();
      });
      initialized = true;
    }
    return api;
  }
  function notice(message) { if (typeof callbacks.notify === 'function') callbacks.notify(message); }
  function banner() {
    return '<details class="community-demo-note"><summary><span class="community-badge">本机演示</span><span>尚未连接真实用户</span></summary><p>帖子和消息只保存在当前浏览器。示例由项目虚构；“发布”不会公开到互联网，“发送”不会联系真实用户。账号、跨用户同步与正式借用审批尚未实现。</p><p>记录物品不等于拥有共享许可。沟通内容不会自动改动库存、共享权限或批准借用。</p></details>';
  }
  function read(container, kind) {
    if (!repo) initialize();
    active = { container, kind };
    const result = repo.read();
    if (!result.ok) {
      state = null;
      container.innerHTML = '<section class="community-page"><h1>' + (kind === 'messages' ? '消息' : '找物互助') + '</h1><div class="community-error" role="alert"><h2>暂时无法读取本机互助记录</h2><p>' + esc(result.error) + '</p><p>为保留原有内容，已暂停发布和发送。请检查浏览器存储权限后重试。</p><button type="button" class="community-button" data-community-action="retry">重新读取</button></div></section>';
      container.querySelector('[data-community-action="retry"]').onclick = renderActive;
      return false;
    }
    state = result.state;
    return true;
  }
  function commit(next) { state = repo.commit(state, next); }
  function deactivate() { active = null; }
  function renderActive() { if (active) active.kind === 'messages' ? renderMessages(active.container) : renderCommunity(active.container); }
  function showError(container, error) {
    const target = container.querySelector('[data-community-error]');
    if (target) { target.textContent = error.message || String(error); target.hidden = false; target.focus(); }
    else notice(error.message || String(error));
  }
  function formatTime(at) { return new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); }
  function categoryIcon(category) {
    const paths = {
      electronics: '<rect x="8" y="5" width="24" height="18" rx="3"/><path d="M20 23v12M12 35l8-12 8 12M14 10h12"/>',
      tools: '<rect x="5" y="14" width="30" height="20" rx="3"/><path d="M13 14V8h14v6M5 22h30M17 22v4h6v-4"/>',
      furniture: '<rect x="10" y="5" width="20" height="17" rx="3"/><path d="M10 22v7M30 22v7M7 29h26M10 29l-3 7M30 29l3 7"/>',
      stationery: '<path d="M9 6h22v29H9zM14 13h12M14 19h12M14 25h7"/>',
      event: '<path d="M7 6h26v23H7zM20 29v7M13 36h14M12 12h16M12 18h10"/>',
      other: '<path d="m5 12 15-7 15 7v20l-15 5-15-5zM5 12l15 6 15-6M20 18v19M12 9l15 6"/>'
    };
    return '<span class="community-category-art category-' + esc(category) + '" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">' + (paths[category] || paths.other) + '</svg></span>';
  }
  function rememberList() { listScroll = Number(root.scrollY) || 0; }
  function scrollPage(top) { if (typeof root.scrollTo === 'function') root.scrollTo({ top, behavior: 'instant' }); }
  function restoreList(container) {
    const restore = () => {
      const target = Array.from(container.querySelectorAll('[data-community-action="detail"]')).find(node => node.dataset.postId === listFocusId);
      target?.focus({ preventScroll: true });
      scrollPage(listScroll);
    };
    if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(restore); else restore();
  }
  function titleHeader() {
    return '<header class="community-page-head"><h1>找物互助</h1><button class="community-button community-button-primary" type="button" data-community-action="compose"><span aria-hidden="true">＋</span> 发布</button></header>';
  }
  function postCard(post) {
    return '<button type="button" class="community-card" data-community-action="detail" data-post-id="' + esc(post.id) + '"><span class="community-card-top"><span class="community-badge ' + (post.type === 'request' ? 'community-badge-request' : 'community-badge-offer') + '">' + (post.type === 'offer' ? '提供闲置' : '正在求助') + '</span><span class="community-card-source">' + (post.isExample ? '示例' : '我的发布') + (post.status === 'closed' ? ' · 已关闭' : '') + '</span></span><span class="community-card-body">' + categoryIcon(post.category) + '<span class="community-card-copy"><span class="community-card-title">' + esc(post.title) + '</span><span class="community-card-meta">' + esc(post.area) + ' · ' + post.quantity + ' 件</span><span class="community-card-description">' + esc(post.description) + '</span></span></span><span class="community-card-foot"><span>' + esc(post.ownerLabel) + '</span><span>' + (post.type === 'offer' ? '可先沟通' : '等待帮助') + ' <span aria-hidden="true">↗</span></span></span></button>';
  }
  function renderCommunity(container) {
    if (!container || !read(container, 'community')) return;
    if (composing) return renderComposer(container);
    const post = state.posts.find(p => p.id === selectedPost);
    if (post) return renderDetail(container, post);
    const posts = D.listPosts(state, { query, type: filter }).filter(p => !area || p.area === area);
    const areas = Array.from(new Set(state.posts.filter(p => p.status === 'open' || p.ownerId === D.SELF_ID).map(p => p.area))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    if (area && !areas.includes(area)) areas.push(area);
    container.innerHTML = '<section class="community-page">' + titleHeader() + '<div class="community-toolbar"><form class="community-search" data-community-search><label class="community-sr-only" for="community-query">搜索物品、用途或区域</label><span class="community-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg></span><input id="community-query" type="search" maxlength="100" placeholder="找物品，或看看谁需要帮助" value="' + esc(query) + '"><button type="submit" class="community-search-submit">搜索</button></form><div class="community-filter-row"><div class="community-tabs" role="group" aria-label="筛选帖子">' + [['all', '全部'], ['offer', '提供闲置'], ['request', '正在求助'], ['mine', '我的发布']].map(([value, label]) => '<button type="button" class="community-tab' + (filter === value ? ' is-active' : '') + '" aria-pressed="' + (filter === value) + '" data-community-action="filter" data-filter="' + value + '">' + label + '</button>').join('') + '</div><label class="community-area"><span class="community-sr-only">按大致区域筛选</span><select data-community-area aria-label="按大致区域筛选"><option value="">全部区域</option>' + areas.map(value => '<option value="' + esc(value) + '"' + (value === area ? ' selected' : '') + '>' + esc(value) + '</option>').join('') + '</select></label></div></div><div class="community-results-head"><p class="community-result-count" aria-live="polite">' + posts.length + ' 条' + (filter === 'mine' ? '我的发布' : '开放中的帖子') + '</p><a class="community-match-link" href="#request">按用途找组合 <span aria-hidden="true">→</span></a></div><div class="community-grid">' + (posts.length ? posts.map(postCard).join('') : '<div class="community-empty"><h2>' + (filter === 'mine' ? '还没有发布' : '暂时没有合适的帖子') + '</h2><p>' + (filter === 'mine' ? '主动发布的信息会出现在这里。' : '换个关键词或区域，或发布求助。') + '</p><button class="community-button community-button-primary" type="button" data-community-action="compose" data-compose-type="' + (filter === 'mine' ? 'offer' : 'request') + '">' + (filter === 'mine' ? '发布第一条' : '发布求助') + '</button></div>') + '</div>' + banner() + '<p class="community-error" data-community-error role="alert" tabindex="-1" hidden></p></section>';
    container.querySelector('[data-community-search]').onsubmit = event => { event.preventDefault(); query = container.querySelector('#community-query').value.slice(0, 100); listScroll = 0; renderCommunity(container); container.querySelector('#community-query')?.focus(); };
    container.querySelector('[data-community-area]').onchange = event => { area = event.target.value; query = container.querySelector('#community-query').value.slice(0, 100); listScroll = 0; renderCommunity(container); container.querySelector('[data-community-area]')?.focus(); };
    bindCommunity(container);
  }
  function renderDetail(container, post) {
    const mine = post.ownerId === D.SELF_ID;
    container.innerHTML = '<section class="community-page"><button class="community-back" type="button" data-community-action="back">← 找物互助</button><article class="community-detail"><div class="community-card-top"><span class="community-badge ' + (post.type === 'offer' ? 'community-badge-offer' : 'community-badge-request') + '">' + (post.type === 'offer' ? '提供闲置' : '正在求助') + '</span><span class="community-card-source">' + (post.isExample ? '虚构示例' : '我在本机发布') + (post.status === 'closed' ? ' · 已关闭' : '') + '</span></div><h1 tabindex="-1">' + esc(post.title) + '</h1><p class="community-detail-owner">' + esc(post.ownerLabel) + ' · ' + esc(formatTime(post.createdAt)) + '</p>' + (post.isExample ? root.ExamplePhotos?.figure(({ 'example-tripod':'tripod', 'example-chairs':'chair', 'example-boards':'board', 'example-tools':'tools' })[post.id]) || '' : '') + '<dl class="community-facts"><div><dt>类别</dt><dd>' + esc(D.categories[post.category]) + '</dd></div><div><dt>数量</dt><dd>' + post.quantity + ' 件</dd></div><div><dt>大致区域</dt><dd>' + esc(post.area) + '</dd></div></dl><div class="community-description"><h2>' + (post.type === 'offer' ? '物品说明' : '需要什么') + '</h2><p>' + esc(post.description) + '</p><h2>协商条件</h2><p>' + esc(post.conditions) + '</p></div><p class="community-status-note">' + (post.type === 'offer' ? '开放沟通 ≠ 已批准借用。规格、状态、时间和交接方式仍需双方核实。' : '这是需求信息，尚未获得资源或共享批准。') + '</p><div class="community-detail-actions">' + (mine ? post.status === 'open' ? '<button class="community-button" type="button" data-community-action="close" data-post-id="' + esc(post.id) + '">关闭我的帖子</button>' : '<span class="community-card-source">已关闭，不再出现在广场</span>' : post.status === 'open' ? '<button class="community-button community-button-primary" type="button" data-community-action="contact" data-post-id="' + esc(post.id) + '">' + (post.type === 'offer' ? '联系物主' : '联系求助者') + '</button><span class="community-card-source">仅创建本机演示会话</span>' : '<span class="community-card-source">帖子已关闭</span>') + '</div><p class="community-error" data-community-error role="alert" tabindex="-1" hidden></p></article>' + banner() + '</section>';
    bindCommunity(container);
  }
  function renderComposer(container) {
    container.innerHTML = '<section class="community-page"><button class="community-back" type="button" data-community-action="cancel-compose">← 找物互助</button><header class="community-page-head"><div><h1>发布互助</h1></div><span class="community-badge">本机演示</span></header><form class="community-form" data-community-publish><fieldset class="community-type-picker"><legend>发布类型</legend><label><input type="radio" name="type" value="offer"' + (composeType === 'offer' ? ' checked' : '') + '><span>提供闲置</span></label><label><input type="radio" name="type" value="request"' + (composeType === 'request' ? ' checked' : '') + '><span>发布求助</span></label></fieldset><label class="community-field">标题<input name="title" maxlength="60" required placeholder="简短说明物品或需求"></label><div class="community-form-grid"><label class="community-field">类别<select name="category">' + Object.entries(D.categories).map(([id, label]) => '<option value="' + id + '">' + label + '</option>').join('') + '</select></label><label class="community-field">数量<input name="quantity" type="number" min="1" max="99" step="1" value="1" required></label></div><label class="community-field">说明<textarea name="description" rows="3" maxlength="600" required placeholder="用途、规格、状态或可接受的替代品"></textarea></label><label class="community-field">大致区域<input name="area" maxlength="60" required placeholder="例如：学校附近，不填详细地址"></label><label class="community-field">时间与协商条件<textarea name="conditions" rows="2" maxlength="300" required placeholder="例如：周六下午使用，归还、搬运等需要协商"></textarea></label><label class="community-check"><input name="rightsConfirmed" type="checkbox" required><span>我确认有权发布这些信息；提供物品时，有权发起共享协商。</span></label><p class="community-form-note">此处只发布到本机演示广场，不会公开到互联网。私人库存不会自动公开，发布也不代表已批准借用。</p><p class="community-error" data-community-error role="alert" tabindex="-1" hidden></p><div class="community-form-actions"><button class="community-button" type="button" data-community-action="cancel-compose">取消</button><button class="community-button community-button-primary" type="submit">发布到本机广场</button></div></form></section>';
    container.querySelector('[data-community-publish]').onsubmit = event => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      try {
        const next = D.publishPost(state, { type: fields.get('type'), category: fields.get('category'), title: fields.get('title'), description: fields.get('description'), quantity: Number(fields.get('quantity')), area: fields.get('area'), conditions: fields.get('conditions'), rightsConfirmed: fields.has('rightsConfirmed') });
        selectedPost = next.posts[0].id; commit(next); composing = false; renderCommunity(container); container.querySelector('h1')?.focus({ preventScroll: true }); scrollPage(0); notice('已发布到本机演示广场。');
      } catch (error) { showError(container, error); }
    };
    bindCommunity(container); container.querySelector('[name="title"]').focus();
  }
  function bindCommunity(container) {
    container.querySelectorAll('[data-community-action]').forEach(button => { button.onclick = () => {
      try {
        switch (button.dataset.communityAction) {
          case 'compose': rememberList(); composeType = button.dataset.composeType || (filter === 'request' ? 'request' : 'offer'); composing = true; selectedPost = ''; renderCommunity(container); scrollPage(0); break;
          case 'cancel-compose': composing = false; renderCommunity(container); restoreList(container); break;
          case 'back': selectedPost = ''; renderCommunity(container); restoreList(container); break;
          case 'detail': rememberList(); selectedPost = button.dataset.postId; listFocusId = selectedPost; renderCommunity(container); container.querySelector('h1')?.focus({ preventScroll: true }); scrollPage(0); break;
          case 'filter': query = container.querySelector('#community-query')?.value.slice(0, 100) || ''; filter = button.dataset.filter; selectedPost = ''; listScroll = 0; renderCommunity(container); Array.from(container.querySelectorAll('[data-community-action="filter"]')).find(node => node.dataset.filter === filter)?.focus({ preventScroll: true }); break;
          case 'close': commit(D.closePost(state, button.dataset.postId)); renderCommunity(container); notice('帖子已关闭。'); break;
          case 'contact': {
            const opened = D.openThread(state, button.dataset.postId);
            if (opened.created) commit(opened.state);
            selectedThread = opened.threadId; role = 'me'; messageOpen = true;
            if (typeof callbacks.onNavigate === 'function') callbacks.onNavigate('messages');
            else renderMessages(container);
            break;
          }
        }
      } catch (error) { showError(container, error); }
    }; });
  }
  function draftKey(threadId, senderRole) { return threadId + ':' + senderRole; }
  function threadList(thread) {
    const post = state.posts.find(p => p.id === thread.postId), last = thread.messages[thread.messages.length - 1];
    return '<button class="message-thread' + (thread.id === selectedThread ? ' is-active' : '') + '" type="button" data-message-action="thread" data-thread-id="' + esc(thread.id) + '" aria-pressed="' + (thread.id === selectedThread) + '"><span class="message-thread-heading"><span class="message-thread-title">' + esc(post.title) + '</span><span class="message-thread-time">' + esc(formatTime(last?.at || thread.createdAt)) + '</span></span><span class="message-thread-preview">' + (last ? (last.role === 'other' ? '对方（演示）：' : '我：') + esc(last.body) : '新会话 · 还未发送消息') + '</span><span class="message-thread-meta">' + esc(post.ownerLabel) + '</span></button>';
  }
  function renderMessages(container) {
    if (!container || !read(container, 'messages')) return;
    const thread = state.threads.find(t => t.id === selectedThread) || state.threads[0];
    selectedThread = thread?.id || '';
    container.innerHTML = '<section class="message-page"><header class="community-page-head"><div><h1>消息</h1></div></header>' + banner() + (thread ? '<div class="message-layout' + (messageOpen ? ' message-is-open' : '') + '"><aside class="message-thread-list" aria-label="本机会话">' + state.threads.map(threadList).join('') + '</aside><div class="message-conversation"><button class="message-mobile-back" type="button" data-message-action="back-to-list">← 所有会话</button>' + conversation(thread) + '</div></div>' : '<div class="community-empty"><h2>还没有会话</h2><p>在找物互助中打开一条帖子，联系发布者。</p><button class="community-button community-button-primary" type="button" data-message-action="community">去找物互助</button></div>') + '</section>';
    container.querySelectorAll('[data-message-action]').forEach(button => { button.onclick = () => {
      if (button.dataset.messageAction === 'community') { selectedPost = ''; typeof callbacks.onNavigate === 'function' ? callbacks.onNavigate('community') : renderCommunity(container); }
      else if (button.dataset.messageAction === 'thread') { selectedThread = button.dataset.threadId; role = 'me'; messageOpen = true; renderMessages(container); scrollPage(0); }
      else if (button.dataset.messageAction === 'back-to-list') { messageOpen = false; renderMessages(container); }
      else if (button.dataset.messageAction === 'post') { selectedPost = button.dataset.postId; typeof callbacks.onNavigate === 'function' ? callbacks.onNavigate('community') : renderCommunity(container); }
    }; });
    const composer = container.querySelector('[data-message-compose]');
    if (!composer) return;
    const input = composer.querySelector('textarea'), selector = composer.querySelector('select');
    input.oninput = () => { messageDrafts.set(draftKey(selectedThread, role), input.value); };
    selector.onchange = () => { role = selector.value; renderMessages(container); container.querySelector('[data-message-compose] textarea')?.focus(); };
    composer.onsubmit = event => {
      event.preventDefault();
      try {
        commit(D.sendMessage(state, selectedThread, input.value, role)); messageDrafts.delete(draftKey(selectedThread, role));
        renderMessages(container); const currentInput = container.querySelector('[data-message-compose] textarea'); currentInput.focus();
        const log = container.querySelector('.message-log'); log.scrollTop = log.scrollHeight;
      } catch (error) { showError(container, error); }
    };
  }
  function conversation(thread) {
    const post = state.posts.find(p => p.id === thread.postId);
    return '<button class="message-context" type="button" data-message-action="post" data-post-id="' + esc(post.id) + '"><span><strong>' + esc(post.title) + '</strong><small>' + post.quantity + ' 件 · ' + esc(post.area) + ' · ' + (post.type === 'offer' ? '尚未批准借用' : '尚未获得资源') + '</small></span><span>详情 →</span></button><div class="message-log" role="log" aria-label="本机演示消息" aria-live="polite">' + (thread.messages.length ? thread.messages.map(m => '<div class="message-row ' + (m.role === 'me' ? 'message-row-me' : 'message-row-other') + '"><div class="message-bubble"><span class="message-sender">' + (m.role === 'me' ? '我' : '对方（手动演示）') + '</span><p>' + esc(m.body) + '</p><time datetime="' + esc(m.at) + '">' + esc(formatTime(m.at)) + '</time></div></div>').join('') : '<div class="message-empty"><p>先介绍你需要什么、什么时候使用。</p><span>没有自动回复；可切换演示身份，自己体验对方回复。</span></div>') + '</div><form class="message-composer" data-message-compose><div class="message-compose-toolbar"><label for="message-role">发送身份<select id="message-role" aria-describedby="message-local-notice"><option value="me"' + (role === 'me' ? ' selected' : '') + '>我</option><option value="other"' + (role === 'other' ? ' selected' : '') + '>对方（手动演示）</option></select></label><span id="message-local-notice" class="message-local-notice">本机演示 · 未发给真实用户</span></div><label class="community-sr-only" for="message-body">' + (role === 'me' ? '输入我的消息' : '手动输入对方演示回复') + '</label><textarea id="message-body" rows="2" maxlength="1000" required placeholder="' + (role === 'me' ? '说明用途、数量和使用时间…' : '由你手动输入对方的演示回复…') + '">' + esc(messageDrafts.get(draftKey(thread.id, role)) || '') + '</textarea><div class="message-compose-actions"><p class="community-error" data-community-error role="alert" tabindex="-1" hidden></p><button class="message-button message-button-primary" type="submit">' + (role === 'me' ? '发送（本机）' : '保存演示回复') + '</button></div></form>';
  }
  const api = Object.freeze({ init: initialize, initialize, deactivate, renderCommunity, renderMessages });
  root.CommunityUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
