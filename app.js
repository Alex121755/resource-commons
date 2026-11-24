(() => {
  'use strict';
  const E = window.ResourceEngine, D = window.PhotoDraftData, STORAGE_KEY = 'resource-commons-demo-v1';
  const $ = s => document.querySelector(s);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const formatDate = s => s ? s.slice(5, 16).replace('T', ' ') : '未记录';
  const photoSpecLabels = { maxWidthMm: '最大夹持宽度（毫米）', maxWeightG: '最大承重（克）', widthMm: '宽度（毫米）', heightMm: '高度（毫米）', maxBoardWidthMm: '可支持展示板最大宽度（毫米）', maxBoardHeightMm: '可支持展示板最大高度（毫米）', connector: '连接接口' };
  let state, storageAvailable = true, page = 'inventory', query = '', filter = 'all', libraryTab = 'drafts', inventoryLayout = 'list', locationFilter = '', strategy = 'task', showAllActions = false, toastTimer;
  let modelAvailable = false, modelName = '', modelBusy = false, service = D.normalizeServiceHealth(null), healthRequest = null;
  try { const saved = localStorage.getItem(STORAGE_KEY); state = saved ? E.validateState(JSON.parse(saved)) : E.seed(); } catch (error) { state = E.seed(); storageAvailable = false; }
  function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4300); }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); storageAvailable = true; } catch (error) { storageAvailable = false; toast('浏览器存储不可用或已满，请导出 JSON 保存当前进度。'); }
    $('#save-status').textContent = storageAvailable ? '已保存在此浏览器' : '仅当前页面 · 请导出保存';
  }
  function badge(text, color = '') { return `<span class="status-pill ${color}">${esc(text)}</span>`; }
  function icon(category) {
    const shapes = {
      support: '<path d="M33 75h51M58 73V50M43 50h31"/><rect x="39" y="10" width="39" height="48" rx="5" fill="currentColor" fill-opacity=".12"/><path d="M46 18h25M46 43h25"/><circle cx="58.5" cy="51" r="1" fill="currentColor"/><path d="m42 74-9 7h51l-9-7" fill="currentColor" fill-opacity=".1"/>',
      tripod: '<path d="M59 31v23M45 31h29M41 79l18-25 19 25M59 54v29"/><rect x="42" y="16" width="33" height="15" rx="3" fill="currentColor" fill-opacity=".13"/><path d="M59 16v-5M77 24l15-7"/><circle cx="59" cy="54" r="4" fill="currentColor" fill-opacity=".15"/>',
      clamp: '<path d="M38 21v47h42V21M38 30h42M38 61h42M59 68v11M49 79h20"/><path d="M29 24h15v14H29zM74 24h15v14H74z" fill="currentColor" fill-opacity=".15"/><path d="M49 46h20M53 52h12"/>',
      board: '<rect x="22" y="13" width="75" height="60" rx="3" fill="currentColor" fill-opacity=".1"/><rect x="29" y="20" width="61" height="46" rx="1"/><path d="M38 35h40M38 43h31M38 51h34M34 78h52"/>',
      easel: '<path d="m35 83 24-74 25 74M58 24h3M29 58h61M40 34h38"/><path d="M39 30h40v24H39z" fill="currentColor" fill-opacity=".08"/><path d="m59 58 2 25"/>',
      chair: '<rect x="37" y="13" width="45" height="33" rx="6" fill="currentColor" fill-opacity=".13"/><path d="M39 45v17M80 45v17M33 62h53M41 62l-5 22M79 62l6 22M44 21h31M44 29h31"/><path d="M33 55h53v8H33z" fill="currentColor" fill-opacity=".12"/>',
      cable: '<rect x="27" y="45" width="62" height="24" rx="7" fill="currentColor" fill-opacity=".1"/><path d="M39 52v7M45 52v7M59 52v7M65 52v7M77 52v7M83 52v7M27 57C3 57 14 23 39 26c22 3 50-19 59-3 9 15-24 20-29 9"/><path d="m65 31 4-5 6 4-4 6z"/>'
    };
    return `<svg viewBox="0 0 120 96" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[category] || shapes.support}</svg>`;
  }
  function tone(category) { return ['tripod', 'clamp'].includes(category) ? 'tone-blue' : ['board', 'easel'].includes(category) ? 'tone-sand' : category === 'chair' ? 'tone-pink' : ''; }
  function navigate(target) { location.hash = target; if (page === target) render(); }
  function render() {
    page = ['inventory', 'community', 'messages', 'request', 'plan'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'inventory';
    if (!['community', 'messages'].includes(page)) window.CommunityUI?.deactivate();
    const navigationPage = ['request', 'plan'].includes(page) ? 'community' : page;
    document.querySelectorAll('[data-nav]').forEach(a => { a.classList.toggle('active', a.dataset.nav === navigationPage); a.setAttribute('aria-current', a.dataset.nav === navigationPage ? 'page' : 'false'); });
    $('#breadcrumb').textContent = ({ inventory: '我的物品', community: '找物互助', messages: '消息', request: '按用途匹配', plan: '资源方案' }[page]);
    $('.persistent-notice').hidden = ['community', 'messages'].includes(page);
    $('#inventory-count').textContent = state.items.length;
    const plan = E.buildPlan(state, strategy);
    $('#plan-count').textContent = plan.unsecured || '✓';
    if (page === 'inventory') renderInventory();
    else if (page === 'community') window.CommunityUI.renderCommunity($('#view'));
    else if (page === 'messages') window.CommunityUI.renderMessages($('#view'));
    else if (page === 'request') renderRequest();
    else renderPlan(plan);
  }
  function renderInventory() {
    const drafts = window.PhotoDraftUI?.summary?.() || { total: 0, pending: 0 };
    $('#view').innerHTML = `<section class="page-head"><div><h1>我的物品</h1></div><button class="button primary" data-scene-action="capture"><svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h4l2-3h4l2 3h4v15H4z"/><circle cx="12" cy="13" r="4"/></svg>拍照添加</button></section>
      <div class="library-controls"><div class="search-wrap"><svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input id="inventory-search" type="search" value="${esc(query)}" placeholder="${libraryTab === 'drafts' ? '搜索物品、地点或照片文字' : '搜索物品、负责人或确认地点'}" aria-label="${libraryTab === 'drafts' ? '搜索照片草稿' : '搜索模拟库存'}"></div><div class="library-tabs" role="group" aria-label="切换记录类型"><button data-action="library-tab" data-tab="drafts" class="${libraryTab === 'drafts' ? 'active' : ''}" aria-pressed="${libraryTab === 'drafts'}">照片草稿 <span>${drafts.total}</span></button><button data-action="library-tab" data-tab="inventory" class="${libraryTab === 'inventory' ? 'active' : ''}" aria-pressed="${libraryTab === 'inventory'}">模拟库存 <span>${state.items.length}</span></button></div></div>
      <section id="photo-draft-section" ${libraryTab === 'drafts' ? '' : 'hidden'} aria-label="照片草稿"></section>
      <section id="confirmed-inventory" ${libraryTab === 'inventory' ? '' : 'hidden'} aria-label="已补全的模拟库存"><div class="inventory-browse-tools"><div class="inventory-section-tools"><label class="location-filter"><span>最后确认地点</span><select id="inventory-location"><option value="">全部地点</option>${[...new Set(state.items.map(i => i.lastConfirmed.place.split(/\s*[／/]\s*/)[0]))].sort().map(place => `<option value="${esc(place)}" ${locationFilter === place ? 'selected' : ''}>${esc(place)}</option>`).join('')}</select></label><button class="text-button" data-action="add-item">＋ 手动记录</button></div><div class="filter-buttons" role="group" aria-label="筛选库存">${[['all', '全部'], ['shareable', '可申请借用'], ['uncertain', '位置待确认'], ['private', '不可共享']].map(([key, label]) => `<button data-action="filter" data-filter="${key}" class="${filter === key ? 'active' : ''}" aria-pressed="${filter === key}">${label}</button>`).join('')}</div></div><div class="inventory-results-bar"><p id="result-line" class="result-line" aria-live="polite"></p><div class="view-toggle" role="group" aria-label="物品显示方式"><button data-action="layout" data-layout="list" aria-pressed="${inventoryLayout === 'list'}">列表</button><button data-action="layout" data-layout="photos" aria-pressed="${inventoryLayout === 'photos'}">照片</button></div></div><div id="inventory-grid" class="inventory-grid inventory-${inventoryLayout}"></div><p class="claim-note">允许申请 ≠ 本次已批准。最后确认位置 ≠ 当前位置。</p></section>`;
    $('#inventory-search').addEventListener('input', e => { query = e.target.value; if (libraryTab === 'drafts') window.PhotoDraftUI?.setQuery?.(query); else renderItems(); });
    $('#inventory-location').addEventListener('change', e => { locationFilter = e.target.value; renderItems(); });
    renderItems();
    window.PhotoDraftUI?.renderSection($('#photo-draft-section'), { query });
  }
  function renderItems() {
    const q = query.trim().toLowerCase();
    const items = state.items.filter(i => (!q || `${i.name} ${i.owner} ${i.lastConfirmed.place}`.toLowerCase().includes(q)) && (!locationFilter || i.lastConfirmed.place.split(/\s*[／/]\s*/)[0] === locationFilter) && (filter === 'all' || filter === 'shareable' && i.share === 'request' || filter === 'uncertain' && i.positionStatus !== 'confirmed' || filter === 'private' && i.share === 'private'));
    $('#result-line').textContent = `${items.length} 条模拟记录`;
    $('#inventory-grid').className = `inventory-grid inventory-${inventoryLayout}`;
    $('#inventory-grid').innerHTML = items.length ? items.map(i => `<article class="item-card inventory-entry"><div class="item-visual ${tone(i.category)}">${(i.thumbnail || i.photo) ? `<img src="${esc(i.thumbnail || i.photo)}" alt="${esc(i.name)}的记录照片">` : icon(i.category)}</div><div class="item-content"><div class="item-title"><h3><button class="item-open" data-action="view-item" data-id="${esc(i.id)}">${esc(i.name)}</button></h3><span class="item-stock">${i.quantity} 件</span></div><div class="location-row"><span>最后确认地点</span>${esc(i.lastConfirmed.place)}</div><div class="item-summary-bottom"><span class="item-owner">${esc(i.owner)}</span><div class="badge-row">${badge(i.share === 'private' ? '不可共享' : '可申请借用', i.share === 'private' ? 'gray' : '')}${i.positionStatus !== 'confirmed' ? badge('位置待确认', 'amber') : ''}${i.condition !== 'good' ? badge('待维修', 'red') : ''}</div></div></div></article>`).join('') : '<div class="empty-state"><h3>这里还没有匹配的物品</h3><p>可更换关键词或地点，也可以清除筛选。</p><button class="button" data-action="clear-filters">清除筛选</button></div>';
  }
  function viewItem(id) {
    const item = state.items.find(i => i.id === id); if (!item) return;
    const predictions = item.positionStatus !== 'confirmed' ? E.predictions(item) : [];
    const seedCategories = {s1:'support',t1:'tripod',c1:'clamp',s2:'support',s3:'support',s4:'support',b1:'board',e1:'easel',h1:'chair',p1:'cable'};
    const examplePhoto = !item.photo && seedCategories[item.id] === item.category ? window.ExamplePhotos?.figure(item.category) || '' : '';
    const originalPhoto = item.photo ? `<figure class="example-photo"><a href="${esc(item.photo)}" target="_blank" rel="noopener" aria-label="查看完整照片"><img src="${esc(item.photo)}" alt="${esc(item.name)}的记录照片"></a>${item.publicPhoto ? `<figcaption class="photo-credit">公开照片 · 人工预置<br>${esc(item.publicPhoto.author)} / Pexels · <a href="${esc(item.publicPhoto.pageUrl)}" target="_blank" rel="noopener noreferrer">照片来源</a> · <a href="${esc(item.publicPhoto.licenseUrl)}" target="_blank" rel="noopener noreferrer">使用许可</a></figcaption>` : ''}</figure>` : '';
    openModal('物品详情', `${originalPhoto || examplePhoto}<div class="item-detail-top"><div class="item-detail-photo ${tone(item.category)}">${item.photo ? `<img src="${esc(item.photo)}" alt="${esc(item.name)}的记录照片">` : icon(item.category)}</div><div><span class="small-label">模拟库存 · ${esc(E.categories[item.category])}</span><h3>${esc(item.name)}</h3><p>记录数量 ${item.quantity} 件 · ${esc(item.owner)}</p><div class="badge-row">${badge(item.share === 'private' ? '不可共享' : '可申请借用', item.share === 'private' ? 'gray' : '')}${badge(item.condition === 'good' ? '可正常使用' : '待维修', item.condition === 'good' ? 'gray' : 'red')}</div></div></div>
      <section class="item-detail-section"><h3>位置</h3><dl class="detail-facts"><div><dt>最后确认</dt><dd>${esc(item.lastConfirmed.place)}<small>${esc(formatDate(item.lastConfirmed.at))} · ${esc(item.lastConfirmed.by || item.owner)}</small></dd></div><div><dt>当前状态</dt><dd>${item.positionStatus === 'confirmed' ? '已核实可找到（模拟）' : '可能移动，待核实'}</dd></div></dl>${predictions.length ? `<div class="detail-prediction"><strong>预测位置 · 尚未确认</strong><ol>${predictions.map(p => `<li>${esc(p.place)}</li>`).join('')}</ol></div>` : ''}</section>
      <section class="item-detail-section"><h3>规格与备注</h3><dl class="detail-facts">${Object.entries(item.specs).map(([key, value]) => `<div><dt>${esc(photoSpecLabels[key] || key)}</dt><dd>${value === null || value === '' ? '待核实' : esc(value)}</dd></div>`).join('') || '<div><dt>规格</dt><dd>尚未记录</dd></div>'}</dl>${item.note ? `<p class="inline-note">${esc(item.note)}</p>` : ''}</section>
      <details class="details"><summary>位置历史与预约（${item.history.length + item.reservations.length}）</summary><div class="details-body">${item.history.map(h => `<p>${esc(formatDate(h.at))} · ${esc(h.place)}<br>${esc(({ confirmed: '确认记录', activity: '活动线索', returned: '归还线索' })[h.kind] || '历史线索')}</p>`).join('')}${item.reservations.map(r => `<p>${esc(r.purpose || r.requestId)} · ${r.quantity} 件<br>${esc(r.start.replace('T', ' '))} — ${esc(r.end.replace('T', ' '))}<br>${r.approved ? '已模拟批准' : '未批准'}</p>`).join('')}</div></details>
      <p class="inline-note">允许申请 ≠ 本次已批准。库存数量不代表当前可借数量。</p><div class="modal-footer"><button class="button" data-action="close-modal">关闭</button><button class="button primary" data-action="edit-item" data-id="${esc(item.id)}">编辑记录</button></div>`);
  }
  function renderRequest(r = state.request) {
    const phoneNeed = r.needs.find(n => n.id === 'phone');
    $('#view').innerHTML = `<section class="page-head"><div><h1>找资源</h1></div></section>
      <details class="preset-picker"><summary>演示场景：${esc(E.presets.find(p => p.id === r.id)?.title || '自定义需求')}</summary><div class="preset-tabs" role="group" aria-label="切换模拟需求">${E.presets.map((p, i) => `<button data-action="preset" data-id="${p.id}" class="preset-tab ${r.id === p.id ? 'active' : ''}" aria-pressed="${r.id === p.id}">${esc(p.title)}</button>`).join('')}</div></details>
      <div class="request-layout"><form id="request-form" class="panel"><div class="section-title"><span class="step-circle">1</span><h2>描述这次任务</h2></div><div class="field request-purpose-field"><label for="request-purpose">用途与所需物品</label><textarea id="request-purpose" name="purpose" maxlength="1000" placeholder="例如：社团展示需要三组手机支架，周五下午使用。">${esc(r.purpose)}</textarea></div><div class="field"><label for="request-title">需求名称</label><input id="request-title" name="title" required maxlength="100" value="${esc(r.title)}"></div><div class="form-grid"><div class="field"><label for="request-start">开始使用</label><input id="request-start" name="start" type="datetime-local" required value="${esc(r.start)}"></div><div class="field"><label for="request-end">结束使用 / 归还</label><input id="request-end" name="end" type="datetime-local" required value="${esc(r.end)}"></div></div><div class="form-divider"></div><div class="section-title"><span class="step-circle">2</span><h2>必须满足的条件</h2></div>${r.needs.map(n => `<div class="need-input-row"><div><h3>${esc(n.label)}</h3><p>${n.id === 'phone' ? '一套为一组提供手机支撑' : n.id === 'display' ? '一块展示板与一副尺寸匹配的画架' : '可正常使用的座椅'}</p></div><input aria-label="${esc(n.label)}所需数量" name="qty-${n.id}" type="number" min="1" max="12" step="1" required value="${n.quantity}"></div>`).join('')}${r.needs.some(n => n.id === 'phone') ? `<div class="form-grid bottom-space"><div class="field"><label for="phone-width">手机宽度（毫米）</label><input id="phone-width" name="phoneWidth" type="number" min="1" max="300" step="0.1" value="${phoneNeed?.phoneWidthMm ?? ''}" required></div><div class="field"><label for="phone-weight">手机及配件重量（克）</label><input id="phone-weight" name="phoneWeight" type="number" min="1" max="2000" step="1" value="${phoneNeed?.phoneWeightG ?? ''}" required></div></div><label class="checkbox-row"><input name="alternatives" type="checkbox" ${r.allowAlternatives ? 'checked' : ''}><span>允许合用的组合替代<br><small class="muted">例如：接口与承重匹配的“三脚架＋手机夹”。</small></span></label>` : '<p class="inline-note">展示板须与尺寸匹配的画架组合；这属于本场景的基本要求。</p>'}<div id="request-error" class="error" role="alert"></div><div class="form-actions"><span class="muted">仅演示此处列出的三类需求与规则</span><button class="button primary" type="submit">查看资源方案 <span aria-hidden="true">→</span></button></div></form>
      <details class="details request-guidance"><summary>匹配说明</summary><div class="details-body"><p>仅演示手机支撑、展示套装与座椅三类需求。匹配使用你核对后的用途、数量、规格与时间；未知条件留待补充。</p><p>找到候选后，还需核实位置、状态和本次共享批准，才计入“已保障”。库存与审批均为模拟，不会发出真实申请。</p></div></details></div>`;
    $('#request-purpose').parentElement.insertAdjacentHTML('beforeend', '<div class="request-ai-tools"><div class="request-ai-row"><button class="button small" type="button" id="ai-request-button">用 AI 整理文字</button><p id="request-ai-summary" class="inline-note"></p></div><details class="request-ai-details"><summary>AI 处理详情</summary><p data-ai-notice="request">' + esc(D.processingNotice(service, 'request')) + '</p></details></div>');
    $('#ai-request-button').onclick = () => organizeRequest(r);
    updateAINotices();
    $('#request-form').addEventListener('submit', e => {
      e.preventDefault();
      const f = new FormData(e.target), next = E.clone(state); next.request = E.clone(r);
      next.request.title = String(f.get('title')).trim(); next.request.purpose = String(f.get('purpose')).trim(); next.request.start = String(f.get('start')); next.request.end = String(f.get('end')); next.request.allowAlternatives = next.request.needs.some(n => n.id === 'phone') ? f.has('alternatives') : true;
      for (const n of next.request.needs) { n.quantity = Number(f.get('qty-' + n.id)); if (n.id === 'phone') { n.phoneWidthMm = Number(f.get('phoneWidth')); n.phoneWeightG = Number(f.get('phoneWeight')); } }
      try { state = E.validateState(next); save(); showAllActions = false; navigate('plan'); } catch (error) { $('#request-error').textContent = error.message; }
    });
  }
  function renderPlan(plan) {
    const r = state.request, pending = plan.needs.reduce((n, p) => n + p.pending, 0);
    $('#view').innerHTML = `<section class="page-head plan-head"><div><h1>${esc(r.title)}</h1><p>${esc(r.purpose)}</p><div class="request-period"><span aria-hidden="true">◷</span>${esc(r.start.replace('T', ' '))} — ${esc(r.end.replace('T', ' '))}<a class="text-button" href="#request">修改条件</a></div></div><div><details class="strategy-options"><summary>核实顺序</summary><div class="strategy-switch" role="group" aria-label="核实策略"><button data-action="strategy" data-strategy="task" class="${strategy === 'task' ? 'active' : ''}" aria-pressed="${strategy === 'task'}">任务优先</button><button data-action="strategy" data-strategy="inventory" class="${strategy === 'inventory' ? 'active' : ''}" aria-pressed="${strategy === 'inventory'}">按名称排序</button></div></details></div></section>
      <div class="summary-strip plan-summary"><div class="summary-cell"><div><div class="summary-label">本次需要</div><div class="summary-number">${plan.total}<small>个需求单位</small></div></div><span class="summary-symbol" aria-hidden="true">◫</span></div><div class="summary-cell secured"><div><div class="summary-label">已保障 · 模拟批准且预留</div><div class="summary-number">${plan.secured}<small>个</small></div></div><span class="summary-symbol" aria-hidden="true">✓</span></div><div class="summary-cell unsecured"><div><div class="summary-label">仍未保障 · 含待核实候选</div><div class="summary-number">${plan.unsecured}<small>个</small></div></div><span class="summary-symbol" aria-hidden="true">…</span></div></div>
      <div class="progress-track" aria-label="已保障${plan.secured}，候选待核实${pending}，总需求${plan.total}"><div class="progress-done" style="width:${plan.secured / plan.total * 100}%"></div><div class="progress-pending" style="width:${pending / plan.total * 100}%"></div></div><div class="legend"><span><i></i>已保障 ${plan.secured}</span><span><i class="pending"></i>待核实候选覆盖 ${pending}（包含在未保障中）</span><span>这是需求单位，不是参与组合的物理件数。</span></div>
      <details class="strategy-note"><summary>当前排序：${strategy === 'task' ? '任务优先' : '按名称排序'} · 规则演示</summary><p class="strategy-explanation">${strategy === 'task' ? '优先处理当前方案中的关键缺项，再按假定操作成本排序；这是待验证的启发式规则，尚无省时效果证据。' : '按物品名称排列可执行动作，保持相同候选方案、规格和权限检查。此切换只演示排序差异，正式实验需随机分配任务。'}</p></details>
      <div class="plan-layout"><section><div class="section-line"><h2>${plan.unsecured ? '下一步，先确认这些' : '这次需求已有完整方案'}</h2><span>${plan.actions.length} 个可执行模拟动作</span></div>${plan.unsecured ? `<div class="action-progress">一次补全一条证据，方案会立即重算。${strategy === 'task' ? '<span class="progress-index">当前方案优先</span>' : ''}</div>${plan.actions.length ? (showAllActions ? plan.actions : plan.actions.slice(0, 3)).map((a, index) => renderAction(a, index)).join('') : '<div class="empty-state"><h3>现有库存还无法覆盖剩余需求</h3><p>检查下方排除原因，或补充新的物品记录。</p><a class="button" href="#inventory">返回物品库</a></div>'}${plan.actions.length > 3 ? `<button class="button ghost more-actions" data-action="more-actions">${showAllActions ? '收起其余动作' : `查看另外 ${plan.actions.length - 3} 个候选动作`}</button>` : ''}` : '<div class="success-panel"><div class="success-mark" aria-hidden="true">✓</div><h2>已有资源可以满足这次需求</h2><p>此处是模拟审批结果；真实试点仍需完成领取、使用和归还记录。</p></div>'}
      <details class="details"><summary>为什么有些物品没有进入方案？</summary><div class="details-body">${plan.blocked.length ? `<ul class="block-list">${plan.blocked.map(b => `<li><strong>${esc(b.name)}</strong>：${esc(b.reason)}</li>`).join('')}</ul>` : '<p>当前没有因共享权限、状态或时段被完全排除的物品。</p>'}<p>此外，类别不匹配、已知规格不合格、接口不兼容的组合不会进入候选。尚未提供支持的类别不会被自动当作替代品。</p></div></details>
      <details class="details"><summary>查看核实记录与规则说明（${state.events.length} 条模拟记录）</summary><div class="details-body"><p>排序分数＝当前方案权重（10，否则 1）× 待核实覆盖数量 ÷ 假定执行分钟。规格 2 分钟、检查地点 5 分钟、询问新位置 8 分钟、批准 4 分钟。它们不是实测时间，也不是概率。组合使用宽度为 96 的有界搜索，不能保证全局最优。</p><p>位置线索按事件类型、相对最新已记录事件的时间加权；不会随当前日历日期自动衰减。已检查未找到的地点会移出当前搜索轮次，在新增位置确认事件后恢复。组合与核实排序本身使用规则；AI 模型仅辅助整理需求和识别照片，建议需人确认。</p>${state.events.length ? state.events.slice(0, 12).map(e => `<div class="audit-row">${esc(e.action)} · ${esc(outcomeLabel(e.outcome))}${e.value ? ' · ' + esc(e.value) : ''}<small>${esc(formatDate(e.at))} · ${esc(e.requestId)} · 模拟数据</small></div>`).join('') : '<p>还没有执行核实动作。</p>'}</div></details></section>
      <aside class="plan-aside"><section class="plan-card"><h2>当前组合方案</h2>${plan.needs.map(n => `<div class="need-heading"><span>${esc(n.label)}</span><span>${n.secured}/${n.quantity} 已保障</span></div>${n.allocations.map(a => `<div class="allocation"><div class="allocation-title"><span>${esc(a.candidate.label)} × ${a.quantity}</span>${badge(a.pending ? '待核实' : '已保障', a.pending ? 'amber' : '')}</div><div class="allocation-parts">${a.candidate.parts.map(i => `<span>${esc(i.name)} × ${a.quantity}</span>`).join('')}</div><div class="allocation-meta">${a.pending ? `${a.secured ? a.secured + ' 个已保障；' : ''}${a.pending} 个仍有未确认条件` : '位置与规格已记录，本次已模拟批准并预留'}</div></div>`).join('')}${n.noCandidate ? `<div class="allocation-parts">另有 ${n.noCandidate} 个暂无合适候选。</div>` : ''}`).join('')}</section><section class="gap-box"><h3>剩余募集清单</h3>${plan.needs.filter(n => n.unsecured).map(n => `<div class="gap-row"><span>${esc(n.label)}</span><strong>${n.unsecured} 个未保障</strong></div>`).join('') || '<div class="gap-row"><span>当前无需募集更多物品</span><strong>0</strong></div>'}<p>${pending ? `其中 ${pending} 个有待核实候选，核实通过后清单会缩减。` : ''} 未保障不等于必须购买；可继续借用、调整用途或募集。</p><button class="button small" data-action="export-gap">导出当前清单 .txt</button></section></aside></div>`;
  }
  function renderAction(a, index) {
    return `<article class="action-card ${index === 0 && strategy === 'task' ? 'recommended' : ''}"><div class="action-top"><div class="rank">${String(index + 1).padStart(2, '0')}</div><div><h3>${esc(a.title)}</h3><p>${esc(a.detail)}</p></div></div><div class="action-badges">${badge(a.selected ? '当前方案需要' : '备选路径', a.selected ? '' : 'gray')}${badge(`假定成本 ${a.cost} 分钟`, 'gray')}${a.type === 'spec' ? badge('缺少规格证据', 'amber') : a.type === 'locate' ? badge('预测不是事实', 'amber') : badge('需负责人授权', 'amber')}</div><div class="action-foot"><span>${a.selected ? '补全后重新检查整套方案' : '主方案无法完成时可继续尝试'}</span><div class="action-buttons">${a.type === 'locate' && a.place ? `<button class="button small ghost" data-action="not-found" data-key="${esc(a.key)}">这里没找到</button>` : ''}${a.type === 'approve' ? `<button class="button small ghost" data-action="deny" data-key="${esc(a.key)}">模拟拒借</button>` : ''}<button class="button small ${index === 0 ? 'primary' : ''}" data-action="perform" data-key="${esc(a.key)}">${a.type === 'spec' ? '录入核实结果' : a.type === 'locate' ? '确认找到位置' : '模拟批准与预留'} <span aria-hidden="true">→</span></button></div></div></article>`;
  }
  function outcomeLabel(outcome) { return ({ verified: '已补充规格', found: '已确认找到', 'not-found': '该地点未找到', approved: '已模拟批准并预留', denied: '已模拟拒借' })[outcome] || outcome; }
  function updateAINotices() {
    if ($('#request-ai-summary')) $('#request-ai-summary').textContent = service.remoteProcessing ? '需求文字发送 OpenAI，可能计费；建议待确认。' : service.known ? '文字交给本机模型整理，建议待确认。' : 'AI 未连接，需求文字不会发送。';
    $('#service-summary').textContent = service.remoteProcessing ? '云端识别 · 点击后上传，可能计费' : service.known ? '本地识别 · ' + (service.ready ? '仅在本机处理' : '服务未就绪') : 'AI 未连接，暂不上传';
    $('#model-notice').innerHTML = '<strong>库存与审批为模拟。</strong> 新照片草稿待核实。' + esc(D.processingNotice(service));
    for (const element of document.querySelectorAll('[data-ai-notice]')) element.textContent = D.processingNotice(service, element.dataset.aiNotice);
    for (const [id, label] of [['#ai-request-button', '整理文字'], ['#ai-photo-button', '识别照片']]) {
      const button = $(id); if (button) { button.disabled = !service.ready || modelBusy; if (!modelBusy) button.textContent = '✧ ' + (service.remoteProcessing ? '用 OpenAI ' : service.known ? '用本地 AI ' : '用 AI ') + label; }
    }
    window.PhotoDraftUI?.updateBackendStatus?.(service);
  }
  function refreshService() {
    if (healthRequest) return healthRequest;
    if (!['http:', 'https:'].includes(location.protocol)) { service = D.normalizeServiceHealth(null); updateAINotices(); return Promise.resolve(service); }
    service = D.normalizeServiceHealth(null); modelAvailable = false; updateAINotices();
    healthRequest = (async () => {
      try {
        const response = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error('AI 服务未连接。');
        service = D.normalizeServiceHealth(await response.json());
      } catch (error) { service = D.normalizeServiceHealth(null); }
      modelAvailable = service.ready; modelName = service.model; updateAINotices(); return service;
    })().finally(() => { healthRequest = null; });
    return healthRequest;
  }
  async function callModel(endpoint, payload, button) {
    if (!modelAvailable || location.protocol === 'file:') {
      toast('AI 服务尚未就绪，未发送照片或文字。请启动服务，并在照片整理页重新检查状态。');
      return null;
    }
    if (modelBusy) { toast('AI 服务正在处理上一条请求，请稍候。'); return null; }
    const oldText = button.textContent, controller = new AbortController(), timer = setTimeout(() => controller.abort(), 180000);
    modelBusy = true; button.disabled = true; button.textContent = service.remoteProcessing ? 'OpenAI 处理中…' : '本机模型处理中…';
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'AI 服务处理失败，请稍后重试。');
      return result;
    } catch (error) { throw new Error(error.name === 'AbortError' ? 'AI 服务响应超过三分钟，当前表单未修改；云端请求可能已产生费用，重试会发起新请求。' : error.message); }
    finally { clearTimeout(timer); modelBusy = false; button.disabled = !service.ready; button.textContent = oldText; updateAINotices(); }
  }
  async function organizeRequest(current) {
    const form = $('#request-form'), text = $('#request-purpose').value.trim();
    if (!text) { $('#request-error').textContent = '先写下用途、数量、规格或时间，再让模型整理。'; return; }
    const f = new FormData(form), draft = E.clone(current);
    draft.title = String(f.get('title')); draft.purpose = text; draft.start = String(f.get('start')); draft.end = String(f.get('end'));
    for (const n of draft.needs) { n.quantity = Number(f.get('qty-' + n.id)); if (n.id === 'phone') { n.phoneWidthMm = Number(f.get('phoneWidth')); n.phoneWeightG = Number(f.get('phoneWeight')); } }
    draft.allowAlternatives = draft.needs.some(n => n.id === 'phone') ? f.has('alternatives') : true;
    try {
      const result = await callModel('/api/extract-request', { text }, $('#ai-request-button'));
      if (!result || $('#request-form') !== form) return;
      const d = result.data || {}, supported = [], seen = new Set();
      const unsupported = (Array.isArray(d.needs) ? d.needs : []).filter(n => !['phone', 'display', 'chair'].includes(n.id));
      for (const n of Array.isArray(d.needs) ? d.needs : []) if (['phone', 'display', 'chair'].includes(n.id) && !seen.has(n.id)) {
        seen.add(n.id); supported.push({ id: n.id, label: ({ phone: '手机支撑套装', display: '展示套装', chair: '座椅' })[n.id], quantity: Number.isInteger(n.quantity) && n.quantity > 0 && n.quantity <= 12 ? n.quantity : null, ...(n.id === 'phone' ? { phoneWidthMm: Number.isFinite(n.phoneWidthMm) && n.phoneWidthMm > 0 && n.phoneWidthMm <= 300 ? n.phoneWidthMm : null, phoneWeightG: Number.isFinite(n.phoneWeightG) && n.phoneWeightG > 0 && n.phoneWeightG <= 2000 ? n.phoneWeightG : null } : {}) });
      }
      openModal('核对 AI 整理结果', `<div class="info-panel">模型：${esc(result.model || modelName)} · ${Number.isFinite(result.elapsedSeconds) ? esc(result.elapsedSeconds.toFixed(1)) + ' 秒' : 'AI 推理'}<br>以下是模型建议，不是已核实事实。采用后仍需核对必填规格、数量与时段。</div><h3>识别到的需求</h3>${unsupported.length ? `<div class="error"><strong>本版尚不能处理以下需求：</strong><br>${unsupported.map(n => esc(n.label || n.sourceText || '未识别需求')).join('<br>')}<br>这些需求不能被丢弃或视为已满足。本次结果暂不能直接采用。</div>` : ''}${supported.length ? `<ul>${supported.map(n => `<li>${esc(n.label)}：${n.quantity ?? '数量未知'}${n.id === 'phone' ? `；手机宽度 ${n.phoneWidthMm ?? '未知'} 毫米，重量 ${n.phoneWeightG ?? '未知'} 克` : ''}</li>`).join('')}</ul>` : '<p>没有识别到本版支持的需求类型，请继续使用结构化表单。</p>'}<p>开始：${esc(d.startLocal || '未知，采用后留空待填写')}<br>结束：${esc(d.endLocal || '未知，采用后留空待填写')}<br>组合替代：${typeof d.allowAlternatives === 'boolean' ? d.allowAlternatives ? '允许' : '不允许' : '未知，需重新确认'}</p>${Array.isArray(d.missingQuestions) && d.missingQuestions.length ? `<h3>需要你补充</h3><ul>${d.missingQuestions.map(q => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}${Array.isArray(d.evidence) && d.evidence.length ? `<details class="details"><summary>查看模型引用的原文线索</summary><div class="details-body">${d.evidence.map(e => `<p>${esc(e.field)}：${esc(e.quote)}</p>`).join('')}</div></details>` : ''}<p>未知数量、规格和日期会留空，必须在表单中补全；出现不支持的需求时阻止采用，以免错误宣称完成整项任务。</p><div class="modal-footer"><button class="button" data-action="close-modal">返回，不采用</button><button id="adopt-request" class="button primary" ${supported.length && !unsupported.length ? '' : 'disabled'}>采用为表单草稿</button></div>`);
      $('#adopt-request').onclick = () => {
        draft.needs = supported;
        if (typeof d.purpose === 'string' && d.purpose.length <= 1000) draft.purpose = d.purpose;
        draft.start = typeof d.startLocal === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.startLocal) ? d.startLocal : '';
        draft.end = typeof d.endLocal === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.endLocal) ? d.endLocal : '';
        draft.allowAlternatives = d.allowAlternatives === true;
        closeModal(); renderRequest(draft); toast('已采用为草稿；未知字段请补全，提交前再次核对。');
      };
    } catch (error) { if ($('#request-error')) $('#request-error').textContent = error.message; }
  }
  let lastModalFocus;
  function openModal(title, html) {
    if (!$('#modal').open) lastModalFocus = document.activeElement;
    $('#modal-content').innerHTML = `<div class="modal-header"><h2 id="modal-title">${esc(title)}</h2><button class="close-modal" aria-label="关闭弹窗" data-action="close-modal">×</button></div><div class="modal-body">${html}</div>`;
    if (!$('#modal').open) $('#modal').showModal();
  }
  function closeModal() { $('#modal').close(); lastModalFocus?.focus(); }
  function runAction(action, outcome, value) {
    try { state = E.applyAction(state, action, outcome, value, now()); save(); closeModal(); render(); toast(outcomeLabel(outcome) + '；方案已重新计算。'); } catch (error) { if ($('#action-error')) $('#action-error').textContent = error.message; else toast(error.message); }
  }
  function actionDialog(action, mode) {
    const item = state.items.find(i => i.id === action.itemId);
    if (mode === 'not-found') { runAction(action, 'not-found'); return; }
    if (mode === 'deny') { openModal('模拟本次借用被拒绝', `<p><strong>${esc(item.name)}</strong>将退出这次需求的候选，系统会重新寻找组合。</p><div class="info-panel">这是演示操作，不会向负责人发送消息，也不会产生真实拒借记录。</div><div class="modal-footer"><button class="button" data-action="close-modal">取消</button><button id="confirm-deny" class="button danger">确认模拟拒借</button></div>`); $('#confirm-deny').onclick = () => runAction(action, 'denied'); return; }
    if (action.type === 'spec') {
      openModal('补全一条规格证据', `<p>${esc(item.name)} · ${esc(action.fieldLabel)}</p><div class="info-panel">${action.field === 'connector' ? '核对接口标识，不能只凭外观判断能够连接。' : `本次需求的参考阈值为 ${esc(action.min)}。请填写核实所得数值；低于要求也应如实记录。`}<br>本版仅演示结构化录入，不会自动读取照片或验证测量真实性。</div><form id="action-form"><div class="field"><label for="action-value">${esc(action.fieldLabel)}</label>${action.field === 'connector' ? '<select id="action-value" required><option value="quarter-inch">1/4 英寸接口</option><option value="other">其他接口</option></select>' : '<input id="action-value" type="number" min="0.01" max="100000" step="any" required placeholder="请输入本次核实的数值">'}</div><div id="action-error" class="error" role="alert"></div><div class="modal-footer"><button type="button" class="button" data-action="close-modal">取消</button><button class="button primary" type="submit">保存模拟核实结果</button></div></form>`);
      $('#action-form').onsubmit = e => { e.preventDefault(); runAction(action, 'verified', $('#action-value').value); };
    } else if (action.type === 'locate') {
      openModal('确认找到物品', `<p>为 <strong>${esc(item.name)}</strong> 保存一条新的位置事实。</p><div class="info-panel">当前最后确认位置：${esc(item.lastConfirmed.place)}<br>本次输入会另存为带时间戳的确认事件。只有实际找到才应确认；此处仍是模拟。</div><form id="action-form"><div class="field"><label for="action-value">本次确认地点</label><input id="action-value" required maxlength="120" value="${esc(action.place)}" placeholder="请填写实际找到的地点"></div><div id="action-error" class="error" role="alert"></div><div class="modal-footer"><button type="button" class="button" data-action="close-modal">取消</button><button class="button primary" type="submit">保存模拟位置确认</button></div></form>`);
      $('#action-form').onsubmit = e => { e.preventDefault(); runAction(action, 'found', $('#action-value').value); };
    } else {
      openModal('模拟负责人批准并预留', `<p><strong>${esc(item.owner)}</strong> · ${esc(item.name)} × ${action.quantity}</p><div class="info-panel">${esc(state.request.start.replace('T', ' '))} 至 ${esc(state.request.end.replace('T', ' '))}<br>确认本次用途、数量和时间后，才记录为本次已批准的预约。</div><p>单机原型没有身份验证，无法代表真实负责人。本按钮仅改变演示数据；不会发送借用请求，也不能代替真实授权。</p><div id="action-error" class="error" role="alert"></div><div class="modal-footer"><button class="button" data-action="close-modal">取消</button><button id="confirm-approve" class="button primary">确认模拟批准与预留</button></div>`);
      $('#confirm-approve').onclick = () => runAction(action, 'approved');
    }
  }
  function specFields(category, specs) {
    const defs = { support: [['maxWidthMm', '最大支持手机宽度（毫米）'], ['maxWeightG', '最大承重（克）']], tripod: [['maxWeightG', '最大承重（克）'], ['connector', '连接接口']], clamp: [['maxWidthMm', '最大夹持宽度（毫米）'], ['maxWeightG', '最大承重（克）'], ['connector', '连接接口']], board: [['widthMm', '展示板宽（毫米）'], ['heightMm', '展示板高（毫米）']], easel: [['maxBoardWidthMm', '支持最大板宽（毫米）'], ['maxBoardHeightMm', '支持最大板高（毫米）']] };
    return (defs[category] || []).map(([key, label]) => `<div class="field"><label for="spec-${key}">${label}</label>${key === 'connector' ? `<select name="spec-${key}" id="spec-${key}"><option value="">未知</option><option value="quarter-inch" ${specs[key] === 'quarter-inch' ? 'selected' : ''}>1/4 英寸接口</option><option value="other" ${specs[key] === 'other' ? 'selected' : ''}>其他接口</option></select>` : `<input name="spec-${key}" id="spec-${key}" type="number" min="0.01" max="100000" step="any" placeholder="未知可留空" value="${esc(specs[key] ?? '')}">`}</div>`).join('');
  }
  function editItem(id, fromDraft = null, draftScene = null, onSaved = null) {
    const existing = state.items.find(i => i.id === id);
    const item = existing ? E.clone(existing) : { id: 'local-' + Date.now().toString(36), isSynthetic: true, name: '', category: 'support', quantity: 1, owner: '', share: 'request', condition: 'good', specs: {}, lastConfirmed: { place: '', at: now(), by: '演示记录者' }, positionStatus: 'confirmed', history: [], checkedPlaces: [], reservations: [], deniedFor: [], photo: '', note: '' };
    if (fromDraft) {
      item.name = fromDraft.name; item.category = fromDraft.category; item.quantity = fromDraft.visibleQuantity;
      item.photo = (draftScene?.source === 'public-photo-demo' ? draftScene.originalImage : fromDraft.thumbnail || draftScene?.originalImage) || ''; item.owner = ''; item.share = ''; item.condition = ''; item.positionStatus = 'uncertain';
      if (draftScene?.source === 'public-photo-demo') { item.thumbnail = fromDraft.thumbnail; item.publicPhoto = draftScene.publicPhoto; }
      item.lastConfirmed = { place: '', at: '', by: '' }; item.note = '来自照片草稿；仅作模拟库存。模型：' + fromDraft.model + '。尚需人工核实。' + (fromDraft.uncertainties.length ? '\n待核实：' + fromDraft.uncertainties.join('；') : '');
    }
    let photo = item.photo;
    openModal(fromDraft ? '补全为模拟库存' : existing ? '物品记录' : '记录一件物品', `<div class="info-panel">本版库存与审批为单机模拟。图片和记录保存在当前浏览器；点击 AI 识别时，按下方当前服务提示处理。模型建议须由你核对后采用。照片不能证明所有权、共享权限或当前可用数量。</div><form id="item-form"><div class="photo-upload"><img id="photo-preview" ${photo ? `src="${esc(photo)}"` : 'hidden'} alt="本地照片预览"><p>添加照片，让记录更容易辨认</p><input id="photo-input" type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择本地照片"><p>PNG / JPEG / WebP，最多 1 MB；保存在当前浏览器。</p></div><div class="form-grid"><div class="field"><label for="item-name">物品名称</label><input id="item-name" name="name" required maxlength="100" value="${esc(item.name)}"></div><div class="field"><label for="item-category">类别</label><select name="category" id="item-category">${Object.entries(E.categories).map(([k, v]) => `<option value="${k}" ${k === item.category ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="field"><label for="item-qty">数量</label><input id="item-qty" name="quantity" type="number" min="1" max="30" step="1" required value="${item.quantity}"></div><div class="field"><label for="item-owner">负责人 / 所有者</label><input id="item-owner" name="owner" required maxlength="100" value="${esc(item.owner)}"></div><div class="field"><label for="item-share">共享条件</label><select id="item-share" name="share"><option value="request" ${item.share === 'request' ? 'selected' : ''}>允许申请，需本次批准</option><option value="private" ${item.share === 'private' ? 'selected' : ''}>不允许共享</option></select></div><div class="field"><label for="item-condition">物品状态</label><select id="item-condition" name="condition"><option value="good" ${item.condition === 'good' ? 'selected' : ''}>可正常使用</option><option value="repair" ${item.condition === 'repair' ? 'selected' : ''}>待维修 / 不适合使用</option></select></div></div><div class="form-divider"></div><h3>位置记录</h3><div class="field"><label for="item-place">最后确认的位置</label><input id="item-place" name="place" required maxlength="120" value="${esc(item.lastConfirmed.place)}"></div><div class="form-grid"><div class="field"><label for="item-at">最后确认时间</label><input id="item-at" name="at" type="datetime-local" required value="${esc(item.lastConfirmed.at)}"></div><div class="field"><label for="item-position">目前位置是否可靠</label><select id="item-position" name="positionStatus"><option value="confirmed" ${item.positionStatus === 'confirmed' ? 'selected' : ''}>已核实可找到</option><option value="uncertain" ${item.positionStatus === 'uncertain' ? 'selected' : ''}>可能移动，待核实</option></select></div></div>${existing && item.positionStatus !== 'confirmed' ? `<p class="inline-note">预测线索：${E.predictions(item).map(p => esc(p.place)).join(' → ') || '需要补充新线索'}。预测不会写入确认位置。</p>` : ''}<div class="form-divider"></div><h3>关键规格</h3><div id="spec-fields" class="form-grid">${specFields(item.category, item.specs)}</div><p class="inline-note">未知规格留空。已知不满足条件会被排除；未知只作为待核实候选。</p><div class="field"><label for="item-note">备注</label><textarea id="item-note" name="note" maxlength="1000">${esc(item.note)}</textarea></div>${existing && item.reservations.length ? `<details class="details"><summary>模拟预约记录（${item.reservations.length}）</summary><div class="details-body">${item.reservations.map(r => `<p>${esc(r.requestId)} · ${r.quantity} 件<br>${esc(r.start.replace('T', ' '))} — ${esc(r.end.replace('T', ' '))}<br>${r.approved ? '已模拟批准' : '未批准'}</p>`).join('')}</div></details>` : ''}<div id="item-error" class="error" role="alert"></div><div class="modal-footer"><button type="button" class="button" data-action="close-modal">取消</button><button class="button primary" type="submit">保存模拟记录</button></div></form>`);
    $('.photo-upload').insertAdjacentHTML('beforeend', '<button type="button" class="button small" id="ai-photo-button" style="margin-top:12px">✧ 用 AI 识别照片</button><p class="inline-note" data-ai-notice="item">' + esc(D.processingNotice(service, 'item')) + '</p><div id="ai-photo-result"></div>');
    updateAINotices();
    $('#ai-photo-button').onclick = async () => {
      if (!photo) { $('#item-error').textContent = '请先选择一张本地照片。'; return; }
      const button = $('#ai-photo-button'), requestedPhoto = photo;
      try {
        const response = await callModel('/api/extract-item', { image: photo, text: $('#item-note').value || $('#item-name').value }, button);
        if (!response || !$('#ai-photo-result') || photo !== requestedPhoto) return;
        const d = response.data || {};
        $('#ai-photo-result').innerHTML = `<div class="info-panel" style="text-align:left;margin:15px 0 0"><strong>模型建议 · ${esc(response.model || modelName)}</strong><p>名称：${esc(d.name || '无法确定')}<br>类别：${esc(E.categories[d.category] || '无法确定')}<br>画面可见数量：${esc(d.visibleQuantity ?? '无法确定')}</p>${d.visibleText ? `<p>可见文字：${esc(d.visibleText)}</p>` : ''}${Array.isArray(d.specSuggestions) && d.specSuggestions.length ? `<p>规格线索（请手动核对录入）：<br>${d.specSuggestions.map(s => esc(photoSpecLabels[s.field] || '其他规格') + '：' + esc(s.value)).join('<br>')}</p>` : ''}${Array.isArray(d.uncertainties) ? `<p>${d.uncertainties.map(esc).join('<br>')}</p>` : ''}<p>采用会填入名称、类别和可见数量；其他证据、权限与预约保持不变。可见数量不等于已核实库存。</p><button id="adopt-photo" type="button" class="button small">采用可识别字段，再人工核对</button></div>`;
        $('#adopt-photo').onclick = () => {
          if (typeof d.name === 'string' && d.name.length <= 100) $('#item-name').value = d.name;
          if (Object.hasOwn(E.categories, d.category)) { $('#item-category').value = d.category; $('#spec-fields').innerHTML = specFields(d.category, {}); }
          if (Number.isInteger(d.visibleQuantity) && d.visibleQuantity > 0 && d.visibleQuantity <= 30) $('#item-qty').value = d.visibleQuantity;
          $('#adopt-photo').disabled = true; $('#adopt-photo').textContent = '已填入，保存前请核对';
        };
      } catch (error) { if ($('#item-error')) $('#item-error').textContent = error.message; }
    };
    if (fromDraft) {
      $('#item-form').insertAdjacentHTML('afterbegin', '<div class="info-panel">照片草稿尚未核实。补充负责人、状态和共享条件后，才保存到下方模拟库存；仍不会产生真实批准或借用。位置与确认时间须由你重新填写。</div>');
      for (const [selector, label] of [['#item-share', '请确认共享条件'], ['#item-condition', '请确认物品状态'], ['#item-position', '请确认位置可靠性']]) {
        const select = $(selector); select.insertAdjacentHTML('afterbegin', '<option value="" selected>' + label + '</option>'); select.value = ''; select.required = true;
      }
      $('#item-qty').value = fromDraft.visibleQuantity ?? '';
      $('#item-place').placeholder = fromDraft.locationHint ? '草稿地点提示：' + fromDraft.locationHint + '（请核实后填写）' : '请输入最后实际确认的地点';
    }
    $('#item-category').onchange = e => { $('#spec-fields').innerHTML = specFields(e.target.value, {}); };
    $('#photo-input').onchange = e => {
      const file = e.target.files[0]; if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1000000) { $('#item-error').textContent = '请选择不超过 1 MB 的 PNG、JPEG 或 WebP 图片。'; e.target.value = ''; return; }
      const reader = new FileReader(); reader.onload = () => { photo = String(reader.result); delete item.thumbnail; delete item.publicPhoto; $('#photo-preview').src = photo; $('#photo-preview').hidden = false; $('#item-error').textContent = ''; }; reader.onerror = () => { $('#item-error').textContent = '无法读取这张照片。'; }; reader.readAsDataURL(file);
    };
    $('#item-form').onsubmit = e => {
      e.preventDefault(); const f = new FormData(e.target), next = E.clone(state), updated = { ...item };
      updated.name = String(f.get('name')).trim(); updated.category = String(f.get('category')); updated.quantity = Number(f.get('quantity')); updated.owner = String(f.get('owner')).trim(); updated.share = String(f.get('share')); updated.condition = String(f.get('condition')); updated.positionStatus = String(f.get('positionStatus')); updated.note = String(f.get('note')).trim(); updated.photo = photo; updated.specs = {};
      for (const [key, value] of f.entries()) if (key.startsWith('spec-') && value !== '') updated.specs[key.slice(5)] = key === 'spec-connector' ? String(value) : Number(value);
      const place = String(f.get('place')).trim(), at = String(f.get('at'));
      updated.lastConfirmed = { place, at, by: updated.owner };
      if (!existing || place !== item.lastConfirmed.place || at !== item.lastConfirmed.at) { updated.history.push({ place, at, kind: 'confirmed' }); updated.checkedPlaces = []; }
      if (existing) next.items[next.items.findIndex(i => i.id === item.id)] = updated; else next.items.push(updated);
      try { state = E.validateState(next); save(); closeModal(); render(); if (onSaved) onSaved(updated.id); toast('模拟记录已保存。'); } catch (error) { $('#item-error').textContent = error.message; }
    };
  }
  function download(name, text, type) { const blob = new Blob([text], { type }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function exportGap() {
    const plan = E.buildPlan(state, strategy), r = state.request;
    const lines = ['物尽其用 · 剩余募集清单', '【模拟数据，不是实际采购建议】', '', `任务：${r.title}`, `用途：${r.purpose}`, `时段：${r.start} 至 ${r.end}`, '', ...plan.needs.map(n => `${n.label}：需要 ${n.quantity}，已保障 ${n.secured}，仍未保障 ${n.unsecured}（其中 ${n.pending} 有待核实候选）${n.id === 'phone' ? `；手机宽 ${n.phoneWidthMm} 毫米、重量 ${n.phoneWeightG} 克` : ''}`), '', '未保障包含尚未核实或尚未获准的候选，不等于必须购买。', '已保障只表示本地模拟的规格、位置和批准条件满足；本原型无法代替真实审批、领取或现场核实。'];
    download('物尽其用-模拟募集清单.txt', lines.join('\n'), 'text/plain;charset=utf-8'); toast('已导出当前模拟募集清单。');
  }
  function dataDialog() {
    openModal('数据与设置', `<div class="info-panel"><strong>库存与审批是模拟记录；新照片草稿来自用户上传图片，图像来源性质与物品信息仍待核实。尚无实际省时或采购效果。</strong><br>${esc(D.processingNotice(service))}<br>没有多用户云库存、真实身份或权限控制，不能用于正式借用授权；不会发送外部通知或向真实用户发送消息。</div><h3>当前能做什么</h3><p>一张照片批量生成物品草稿、框选裁切与人工纠错、手工记录、AI 需求整理、结构化需求、规则匹配、接口与数量约束、预约冲突检查、历史位置线索、模拟核实与方案重算。</p><h3>尚未接入什么</h3><p>真实用户认证、负责人审批、通知、物流与领取归还尚未接入。语音与视频处理也未实现。AI 功能需要通过启动脚本运行后端服务，云模式另需后端配置密钥；直接打开 HTML 时仍可使用完整规则演示。</p><h3>保存与迁移</h3><p>数据保存在此浏览器的 localStorage；更换浏览器、清除网站数据或使用无痕模式可能丢失。照片保存在浏览器中；云模式推理另会发送 OpenAI，不等于已把库存同步至云端。此处导出只备份模拟库存与需求，最多 30 条物品，不允许超量预约。照片草稿独立保存，请使用库存页“照片草稿”区域的导出/导入，避免漏备份。</p><div class="data-actions"><button class="button primary" data-action="export-data">导出 JSON 备份</button><button class="button" data-action="import-data">导入 JSON</button></div><h3>重新开始</h3><p>恢复示例或清空物品库仅替换模拟库存，照片草稿不受影响。需要保留时请先分别导出。</p><div class="data-actions"><button class="button" data-action="restore">恢复初始示例</button><button class="button danger" data-action="clear">清空物品与核实记录</button></div><p class="footnote">版本 1.3 · 照片草稿与模拟库存独立保存。<br>若浏览器禁止 file:// 存储，请使用启动脚本或 README 的静态服务方式。</p>`);
  }
  function confirmReset(clear) {
    openModal(clear ? '清空当前演示记录？' : '恢复初始示例？', `<p>${clear ? '所有物品与核实事件将被清空，当前需求会保留。' : '当前物品、需求和核实事件将被初始模拟示例替换。'}此操作无法在页面内撤销。</p><div class="modal-footer"><button class="button" data-action="close-modal">取消</button><button id="confirm-reset" class="button danger">确认${clear ? '清空' : '恢复'}</button></div>`);
    $('#confirm-reset').onclick = () => { const request = state.request; state = E.seed(); if (clear) { state.items = []; state.events = []; state.request = request; } query = ''; filter = 'all'; save(); closeModal(); render(); toast(clear ? '模拟物品库已清空。' : '初始模拟示例已恢复。'); };
  }
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action]'); if (!target) return;
    const action = target.dataset.action;
    if (action === 'close-modal') closeModal();
    else if (action === 'add-item') editItem();
    else if (action === 'view-item') viewItem(target.dataset.id);
    else if (action === 'layout') { inventoryLayout = target.dataset.layout === 'photos' ? 'photos' : 'list'; renderInventory(); $('[data-action="layout"][data-layout="' + inventoryLayout + '"]')?.focus(); }
    else if (action === 'clear-filters') { query = ''; filter = 'all'; locationFilter = ''; renderInventory(); $('#inventory-search').focus(); }
    else if (action === 'edit-item') editItem(target.dataset.id);
    else if (action === 'library-tab') { libraryTab = target.dataset.tab === 'inventory' ? 'inventory' : 'drafts'; renderInventory(); $('[data-action="library-tab"][data-tab="' + libraryTab + '"]')?.focus(); }
    else if (action === 'filter') { filter = target.dataset.filter; renderInventory(); $('[data-action="filter"][data-filter="' + filter + '"]')?.focus(); }
    else if (action === 'preset') { state.request = E.clone(E.presets.find(p => p.id === target.dataset.id)); save(); render(); toast('已切换模拟需求，已有预约仍保留。'); }
    else if (action === 'strategy') { strategy = target.dataset.strategy; showAllActions = false; render(); }
    else if (action === 'more-actions') { showAllActions = !showAllActions; render(); }
    else if (['perform', 'not-found', 'deny'].includes(action)) { const a = E.buildPlan(state, strategy).actions.find(x => x.key === target.dataset.key); if (a) actionDialog(a, action); else toast('方案已更新，请选择当前动作。'); }
    else if (action === 'export-gap') exportGap();
    else if (action === 'export-data') { download('物尽其用-模拟数据-v1.json', JSON.stringify(state, null, 2), 'application/json;charset=utf-8'); toast('已导出全部模拟数据。'); }
    else if (action === 'import-data') $('#import-input').click();
    else if (action === 'restore') confirmReset(false);
    else if (action === 'clear') confirmReset(true);
  });
  $('#import-input').onchange = async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    if (file.size > 8000000) { toast('数据包超过 8 MB，无法导入。'); return; }
    try {
      const incoming = E.validateState(JSON.parse(await file.text()));
      openModal('导入模拟数据？', `<p>已通过结构检查：${incoming.items.length} 条物品、${incoming.events.length} 条核实事件。</p><p>导入后会替换当前状态。需求：<strong>${esc(incoming.request.title)}</strong></p><div class="modal-footer"><button class="button" data-action="close-modal">取消</button><button class="button primary" id="confirm-import">确认替换并导入</button></div>`);
      $('#confirm-import').onclick = () => { state = incoming; save(); closeModal(); render(); toast('模拟数据已导入。'); };
    } catch (error) { toast('导入失败：' + error.message); }
  };
  $('#data-tools').onclick = dataDialog; $('#help-button').onclick = dataDialog;
  $('#modal').addEventListener('click', e => { if (e.target === $('#modal')) { const r = $('#modal').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeModal(); } });
  window.addEventListener('hashchange', () => { render(); window.scrollTo({ top: 0, behavior: 'instant' }); });
  $('#modal').addEventListener('close', () => lastModalFocus?.focus());
  window.PhotoDraftUI?.initialize({ notify: toast, refreshService, promote: (draft, scene, done) => editItem(undefined, draft, scene, done), changed: () => { if (page === 'inventory') renderInventory(); } });
  window.CommunityUI?.init({ onNavigate: navigate, notify: toast });
  save(); render();
  refreshService();
})();
