(function (root) {
  'use strict';
  const D = root.CommunityData;
  if (!D) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const translate = value => root.RCI18n?.t(value) ?? value;
  const postText = (post, value) => post.isExample ? esc(value) : '<span translate="no">' + esc(value) + '</span>';
  const language = () => root.RCI18n?.language || 'en';
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
    return '<details class="community-demo-note"><summary><span class="community-badge">Local demo</span><span>Posts and messages stay in this browser</span></summary><p>Use this board to try an offer or request. These sample conversations are stored on this device. To share with real members, open <a href="groups.html">Groups</a>.</p><p>Confirm permission with the owner before borrowing an item.</p></details>';
  }
  function read(container, kind) {
    if (!repo) initialize();
    active = { container, kind };
    const result = repo.read();
    if (!result.ok) {
      state = null;
      container.innerHTML = '<section class="community-page"><h1>' + (kind === 'messages' ? 'Messages' : 'Community board') + '</h1><div class="community-error" role="alert"><h2>Local board data is unavailable</h2><p>' + esc(result.error) + '</p><p>Check browser storage permissions and retry to access your saved posts and messages.</p><button type="button" class="community-button" data-community-action="retry">Retry</button></div></section>';
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
  function formatTime(at) { return new Date(at).toLocaleString(language(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); }
  function timeLabel(at) {
    return '<time datetime="' + esc(at) + '" data-community-time>' + esc(formatTime(at)) + '</time>';
  }
  root.addEventListener?.('rc-language-change', () => {
    root.document?.querySelectorAll('[data-community-time]').forEach(el => { el.textContent = formatTime(el.dateTime); });
  });
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
    return '<header class="community-page-head"><h1>Community board</h1><button class="community-button community-button-primary" type="button" data-community-action="compose"><span aria-hidden="true">+</span> New post</button></header>';
  }
  function postCard(post) {
    return '<button type="button" class="community-card" data-community-action="detail" data-post-id="' + esc(post.id) + '"><span class="community-card-top"><span class="community-badge ' + (post.type === 'request' ? 'community-badge-request' : 'community-badge-offer') + '">' + (post.type === 'offer' ? 'Offer' : 'Request') + '</span><span class="community-card-source">' + (post.isExample ? 'Example' : 'Your post') + (post.status === 'closed' ? ' · Closed' : '') + '</span></span><span class="community-card-body">' + categoryIcon(post.category) + '<span class="community-card-copy"><span class="community-card-title">' + postText(post, post.title) + '</span><span class="community-card-meta">' + postText(post, post.area) + '<span aria-hidden="true"> · </span>' + post.quantity + (post.quantity === 1 ? ' item' : ' items') + '</span><span class="community-card-description">' + postText(post, post.description) + '</span></span></span><span class="community-card-foot"><span>' + esc(post.ownerLabel) + '</span><span>' + (post.type === 'offer' ? 'View offer' : 'View request') + ' <span aria-hidden="true">↗</span></span></span></button>';
  }
  function renderCommunity(container) {
    if (!container || !read(container, 'community')) return;
    if (composing) return renderComposer(container);
    const post = state.posts.find(p => p.id === selectedPost);
    if (post) return renderDetail(container, post);
    const needle = query.trim().toLocaleLowerCase(language());
    const posts = D.listPosts(state, { type: filter }).filter(p => {
      if (area && p.area !== area) return false;
      const values = [p.title, p.description, p.area, p.conditions];
      const labels = p.isExample ? values.map(translate) : [];
      return [...values, ...labels, D.categories[p.category], translate(D.categories[p.category])]
        .some(value => value.toLocaleLowerCase(language()).includes(needle));
    });
    const areas = Array.from(new Set(state.posts.filter(p => p.status === 'open' || p.ownerId === D.SELF_ID).map(p => p.area))).sort((a, b) => translate(a).localeCompare(translate(b), language()));
    if (area && !areas.includes(area)) areas.push(area);
    container.innerHTML = '<section class="community-page">' + titleHeader() + '<div class="community-toolbar"><form class="community-search" data-community-search><label class="community-sr-only" for="community-query">Search for items, uses or locations</label><span class="community-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg></span><input id="community-query" type="search" maxlength="100" placeholder="Search for an item or request" value="' + esc(query) + '"><button type="submit" class="community-search-submit">Search</button></form><div class="community-filter-row"><div class="community-tabs" role="group" aria-label="Filter posts">' + [['all', 'All'], ['offer', 'Offers'], ['request', 'Requests'], ['mine', 'My posts']].map(([value, label]) => '<button type="button" class="community-tab' + (filter === value ? ' is-active' : '') + '" aria-pressed="' + (filter === value) + '" data-community-action="filter" data-filter="' + value + '">' + label + '</button>').join('') + '</div><label class="community-area"><span class="community-sr-only">Filter by area</span><select data-community-area aria-label="Filter by area"><option value="">All areas</option>' + areas.map(value => '<option' + (state.posts.some(p => p.isExample && p.area === value) ? '' : ' translate="no"') + ' value="' + esc(value) + '"' + (value === area ? ' selected' : '') + '>' + esc(value) + '</option>').join('') + '</select></label></div></div><div class="community-results-head"><p class="community-result-count" aria-live="polite">' + posts.length + (posts.length === 1 ? ' post' : ' posts') + (filter === 'mine' ? ' by you' : ' open') + '</p><a class="community-match-link" href="#request">Match items to a task <span aria-hidden="true">→</span></a></div><div class="community-grid">' + (posts.length ? posts.map(postCard).join('') : '<div class="community-empty"><h2>' + (filter === 'mine' ? 'No posts yet' : 'No matching posts') + '</h2><p>' + (filter === 'mine' ? 'Create an offer or request to see it here.' : 'Try another search, change the area, or post a request.') + '</p><button class="community-button community-button-primary" type="button" data-community-action="compose" data-compose-type="' + (filter === 'mine' ? 'offer' : 'request') + '">' + (filter === 'mine' ? 'Create a post' : 'Post a request') + '</button></div>') + '</div>' + banner() + '<p class="community-error" data-community-error role="alert" tabindex="-1" hidden></p></section>';
    container.querySelector('[data-community-search]').onsubmit = event => { event.preventDefault(); query = container.querySelector('#community-query').value.slice(0, 100); listScroll = 0; renderCommunity(container); container.querySelector('#community-query')?.focus(); };
    container.querySelector('[data-community-area]').onchange = event => { area = event.target.value; query = container.querySelector('#community-query').value.slice(0, 100); listScroll = 0; renderCommunity(container); container.querySelector('[data-community-area]')?.focus(); };
    bindCommunity(container);
  }
  function renderDetail(container, post) {
    const mine = post.ownerId === D.SELF_ID;
    container.innerHTML = '<section class="community-page"><button class="community-back" type="button" data-community-action="back">← Community board</button><article class="community-detail"><div class="community-card-top"><span class="community-badge ' + (post.type === 'offer' ? 'community-badge-offer' : 'community-badge-request') + '">' + (post.type === 'offer' ? 'Offer' : 'Request') + '</span><span class="community-card-source">' + (post.isExample ? 'Example post' : 'Posted on this device') + (post.status === 'closed' ? ' · Closed' : '') + '</span></div><h1 tabindex="-1">' + postText(post, post.title) + '</h1><p class="community-detail-owner">' + esc(post.ownerLabel) + '<span aria-hidden="true"> · </span>' + timeLabel(post.createdAt) + '</p>' + (post.isExample ? root.ExamplePhotos?.figure(({ 'example-tripod':'tripod', 'example-chairs':'chair', 'example-boards':'board', 'example-tools':'tools' })[post.id]) || '' : '') + '<dl class="community-facts"><div><dt>Category</dt><dd>' + esc(D.categories[post.category]) + '</dd></div><div><dt>Quantity</dt><dd>' + post.quantity + (post.quantity === 1 ? ' item' : ' items') + '</dd></div><div><dt>Area</dt><dd>' + postText(post, post.area) + '</dd></div></dl><div class="community-description"><h2>' + (post.type === 'offer' ? 'About the item' : 'What is needed') + '</h2><p>' + postText(post, post.description) + '</p><h2>Borrowing terms</h2><p>' + postText(post, post.conditions) + '</p></div><p class="community-status-note">' + (post.type === 'offer' ? 'Confirm the specifications, condition, timing and handoff with the owner before borrowing.' : 'This request is still looking for an item and the owner’s approval.') + '</p><div class="community-detail-actions">' + (mine ? post.status === 'open' ? '<button class="community-button" type="button" data-community-action="close" data-post-id="' + esc(post.id) + '">Close my post</button>' : '<span class="community-card-source">Closed and removed from the board</span>' : post.status === 'open' ? '<button class="community-button community-button-primary" type="button" data-community-action="contact" data-post-id="' + esc(post.id) + '">' + (post.type === 'offer' ? 'Contact owner' : 'Contact requester') + '</button><span class="community-card-source">Opens a demo conversation on this device</span>' : '<span class="community-card-source">Post closed</span>') + '</div><p class="community-error" data-community-error role="alert" tabindex="-1" hidden></p></article>' + banner() + '</section>';
    bindCommunity(container);
  }
  function renderComposer(container) {
    container.innerHTML = '<section class="community-page"><button class="community-back" type="button" data-community-action="cancel-compose">← Community board</button><header class="community-page-head"><div><h1>Create a post</h1></div><span class="community-badge">Local demo</span></header><form class="community-form" data-community-publish><fieldset class="community-type-picker"><legend>Post type</legend><label><input type="radio" name="type" value="offer"' + (composeType === 'offer' ? ' checked' : '') + '><span>Offer an item</span></label><label><input type="radio" name="type" value="request"' + (composeType === 'request' ? ' checked' : '') + '><span>Request an item</span></label></fieldset><label class="community-field">Title<input name="title" maxlength="60" required placeholder="Give your offer or request a short title"></label><div class="community-form-grid"><label class="community-field">Category<select name="category">' + Object.entries(D.categories).map(([id, label]) => '<option value="' + id + '">' + label + '</option>').join('') + '</select></label><label class="community-field">Quantity<input name="quantity" type="number" min="1" max="99" step="1" value="1" required></label></div><label class="community-field">Description<textarea name="description" rows="3" maxlength="600" required placeholder="Describe its use, specifications, condition or acceptable alternatives"></textarea></label><label class="community-field">Area<input name="area" maxlength="60" required placeholder="For example, school campus. Use a general area."></label><label class="community-field">Availability and terms<textarea name="conditions" rows="2" maxlength="300" required placeholder="Include dates, pickup arrangements and return details"></textarea></label><label class="community-check"><input name="rightsConfirmed" type="checkbox" required><span>I have permission to share this information and to offer any items listed.</span></label><p class="community-form-note">This demo saves posts on this device. Share with actual members in <a href="groups.html">Groups</a>.</p><p class="community-error" data-community-error role="alert" tabindex="-1" hidden></p><div class="community-form-actions"><button class="community-button" type="button" data-community-action="cancel-compose">Cancel</button><button class="community-button community-button-primary" type="submit">Post to local board</button></div></form></section>';
    container.querySelector('[data-community-publish]').onsubmit = event => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      try {
        const next = D.publishPost(state, { type: fields.get('type'), category: fields.get('category'), title: fields.get('title'), description: fields.get('description'), quantity: Number(fields.get('quantity')), area: fields.get('area'), conditions: fields.get('conditions'), rightsConfirmed: fields.has('rightsConfirmed') });
        selectedPost = next.posts[0].id; commit(next); composing = false; renderCommunity(container); container.querySelector('h1')?.focus({ preventScroll: true }); scrollPage(0); notice('Posted to the local board.');
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
          case 'close': commit(D.closePost(state, button.dataset.postId)); renderCommunity(container); notice('Post closed.'); break;
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
    return '<button class="message-thread' + (thread.id === selectedThread ? ' is-active' : '') + '" type="button" data-message-action="thread" data-thread-id="' + esc(thread.id) + '" aria-pressed="' + (thread.id === selectedThread) + '"><span class="message-thread-heading"><span class="message-thread-title">' + postText(post, post.title) + '</span><span class="message-thread-time">' + timeLabel(last?.at || thread.createdAt) + '</span></span><span class="message-thread-preview">' + (last ? (last.role === 'other' ? 'Other member (demo): ' : 'Me: ') + '<span translate="no">' + esc(last.body) + '</span>' : 'New conversation') + '</span><span class="message-thread-meta">' + esc(post.ownerLabel) + '</span></button>';
  }
  function renderMessages(container) {
    if (!container || !read(container, 'messages')) return;
    const thread = state.threads.find(t => t.id === selectedThread) || state.threads[0];
    selectedThread = thread?.id || '';
    container.innerHTML = '<section class="message-page"><header class="community-page-head"><div><h1>Messages</h1></div></header>' + banner() + (thread ? '<div class="message-layout' + (messageOpen ? ' message-is-open' : '') + '"><aside class="message-thread-list" aria-label="Local conversations">' + state.threads.map(threadList).join('') + '</aside><div class="message-conversation"><button class="message-mobile-back" type="button" data-message-action="back-to-list">← All conversations</button>' + conversation(thread) + '</div></div>' : '<div class="community-empty"><h2>No conversations yet</h2><p>Open a post on the community board to start a local conversation.</p><button class="community-button community-button-primary" type="button" data-message-action="community">Browse the board</button></div>') + '</section>';
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
    return '<button class="message-context" type="button" data-message-action="post" data-post-id="' + esc(post.id) + '"><span><strong>' + postText(post, post.title) + '</strong><small>' + post.quantity + (post.quantity === 1 ? ' item' : ' items') + '<span aria-hidden="true"> · </span>' + postText(post, post.area) + '<span aria-hidden="true"> · </span>' + (post.type === 'offer' ? 'Owner approval pending' : 'Looking for an item') + '</small></span><span>Details →</span></button><div class="message-log" role="log" aria-label="Local demo messages" aria-live="polite">' + (thread.messages.length ? thread.messages.map(m => '<div class="message-row ' + (m.role === 'me' ? 'message-row-me' : 'message-row-other') + '"><div class="message-bubble"><span class="message-sender">' + (m.role === 'me' ? 'Me' : 'Other member (demo)') + '</span><p translate="no">' + esc(m.body) + '</p>' + timeLabel(m.at) + '</div></div>').join('') : '<div class="message-empty"><p>What do you need, and when?</p><span>Switch the sender below to try both sides of the conversation.</span></div>') + '</div><form class="message-composer" data-message-compose><div class="message-compose-toolbar"><label for="message-role">Send as<select id="message-role" aria-describedby="message-local-notice"><option value="me"' + (role === 'me' ? ' selected' : '') + '>Me</option><option value="other"' + (role === 'other' ? ' selected' : '') + '>Other member (demo)</option></select></label><span id="message-local-notice" class="message-local-notice">Messages stay in this browser</span></div><label class="community-sr-only" for="message-body">' + (role === 'me' ? 'Your message' : 'Demo reply from the other member') + '</label><textarea id="message-body" rows="2" maxlength="1000" required placeholder="' + (role === 'me' ? 'Add the purpose, quantity and dates…' : 'Write a reply as the other member…') + '">' + esc(messageDrafts.get(draftKey(thread.id, role)) || '') + '</textarea><div class="message-compose-actions"><p class="community-error" data-community-error role="alert" tabindex="-1" hidden></p><button class="message-button message-button-primary" type="submit">' + (role === 'me' ? 'Send locally' : 'Save demo reply') + '</button></div></form>';
  }
  const api = Object.freeze({ init: initialize, initialize, deactivate, renderCommunity, renderMessages });
  root.CommunityUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
