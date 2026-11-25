(() => {
  'use strict';
  const E = window.ResourceEngine, D = window.PhotoDraftData, STORAGE_KEY = 'resource-commons-demo-v1';
  const $ = s => document.querySelector(s);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const translate = value => window.RCI18n?.t(value) ?? value;
  const sampleItems = new Map(E.seed().items.map(item => [item.id, item]));
  const sampleField = (item, field) => field === 'place' ? sampleItems.get(item.id)?.lastConfirmed.place : sampleItems.get(item.id)?.[field];
  // A personal item can have the same name as an interface label.
  function itemText(item, field, value) {
    return value === sampleField(item, field) ? esc(value) : '<bdi translate="no">' + esc(value) + '</bdi>';
  }
  const editableSamples = new WeakMap();
  function previewSampleField(selector, value, sample) {
    const field = $(selector);
    if (!field || !sample || value !== sample) return;
    const shown = translate(sample);
    field.value = shown;
    editableSamples.set(field, {source: sample, shown});
  }
  function fieldValue(form, values, name) {
    const value = String(values.get(name) ?? '').trim();
    const preview = editableSamples.get(form.elements?.namedItem(name));
    return preview && value === preview.shown ? preview.source : value;
  }
  const now = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const formatDate = s => s ? s.slice(5, 16).replace('T', ' ') : 'Not recorded';
  const photoSpecLabels = { maxWidthMm: 'Maximum clamp width (mm)', maxWeightG: 'Maximum load (g)', widthMm: 'Width (mm)', heightMm: 'Height (mm)', maxBoardWidthMm: 'Maximum board width (mm)', maxBoardHeightMm: 'Maximum board height (mm)', connector: 'Connector' };
  let state, storageAvailable = true, page = 'inventory', query = '', filter = 'all', libraryTab = 'inventory', inventoryLayout = 'list', locationFilter = '', strategy = 'task', showAllActions = false, toastTimer;
  let modelAvailable = false, modelName = '', modelBusy = false, service = D.normalizeServiceHealth(null), healthRequest = null;
  try { const saved = localStorage.getItem(STORAGE_KEY); state = saved ? E.validateState(JSON.parse(saved)) : E.seed(); } catch (error) { state = E.seed(); storageAvailable = false; }
  function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4300); }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); storageAvailable = true; } catch (error) { storageAvailable = false; toast('Browser storage is full or unavailable. Export a JSON backup to keep your changes.'); }
    $('#save-status').textContent = storageAvailable ? 'Saved in this browser' : 'This session only · Export to save';
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
    $('#breadcrumb').textContent = ({ inventory: 'My inventory', community: 'Community board', messages: 'Messages', request: 'Match a request', plan: 'Resource plan' }[page]);
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
    $('#view').innerHTML = `<section class="page-head"><div><h1>My inventory</h1><p>Find what you have, where it was last seen, and who can share it.</p></div><button class="button primary" data-scene-action="capture"><svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h4l2-3h4l2 3h4v15H4z"/><circle cx="12" cy="13" r="4"/></svg>Add a photo</button></section>
      <div class="library-controls"><div class="search-wrap"><svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input id="inventory-search" type="search" value="${esc(query)}" placeholder="${libraryTab === 'drafts' ? 'Search by item, location, or text in a photo' : 'Search by item, owner, or last known location'}" aria-label="${libraryTab === 'drafts' ? 'Search photo drafts' : 'Search inventory'}"></div><div class="library-tabs" role="group" aria-label="Choose record type"><button data-action="library-tab" data-tab="drafts" class="${libraryTab === 'drafts' ? 'active' : ''}" aria-pressed="${libraryTab === 'drafts'}">Photo drafts <span>${drafts.total}</span></button><button data-action="library-tab" data-tab="inventory" class="${libraryTab === 'inventory' ? 'active' : ''}" aria-pressed="${libraryTab === 'inventory'}">Demo inventory <span>${state.items.length}</span></button></div></div>
      <section id="photo-draft-section" ${libraryTab === 'drafts' ? '' : 'hidden'} aria-label="Photo drafts"></section>
      <section id="confirmed-inventory" ${libraryTab === 'inventory' ? '' : 'hidden'} aria-label="Completed inventory records"><div class="inventory-browse-tools"><div class="inventory-section-tools"><label class="location-filter"><span>Last confirmed location</span><select id="inventory-location"><option value="">All locations</option>${[...new Set(state.items.map(i => i.lastConfirmed.place.split(/\s*[\uFF0F/]\s*/)[0]))].sort().map(place => `<option value="${esc(place)}" ${locationFilter === place ? 'selected' : ''}>${esc(place)}</option>`).join('')}</select></label><button class="text-button" data-action="add-item">+ Add manually</button></div><div class="filter-buttons" role="group" aria-label="Filter inventory">${[['all', 'All'], ['shareable', 'Open to requests'], ['uncertain', 'Location unverified'], ['private', 'Private']].map(([key, label]) => `<button data-action="filter" data-filter="${key}" class="${filter === key ? 'active' : ''}" aria-pressed="${filter === key}">${label}</button>`).join('')}</div></div><div class="inventory-results-bar"><p id="result-line" class="result-line" aria-live="polite"></p><div class="view-toggle" role="group" aria-label="Inventory layout"><button data-action="layout" data-layout="list" aria-pressed="${inventoryLayout === 'list'}">List</button><button data-action="layout" data-layout="photos" aria-pressed="${inventoryLayout === 'photos'}">Photos</button></div></div><div id="inventory-grid" class="inventory-grid inventory-${inventoryLayout}"></div><p class="claim-note">Check the location and get the owner’s approval before borrowing.</p></section>`;
    $('#inventory-search').addEventListener('input', e => { query = e.target.value; if (libraryTab === 'drafts') window.PhotoDraftUI?.setQuery?.(query); else renderItems(); });
    $('#inventory-location').addEventListener('change', e => { locationFilter = e.target.value; renderItems(); });
    renderItems();
    window.PhotoDraftUI?.renderSection($('#photo-draft-section'), { query });
  }
  function renderItems() {
    const q = query.trim().toLowerCase();
    const items = state.items.filter(i => (!q || ['name', 'owner', 'place'].some(field => {
      const value = field === 'place' ? i.lastConfirmed.place : i[field];
      return value.toLowerCase().includes(q) ||
        (sampleField(i, field) === value && translate(value).toLowerCase().includes(q));
    })) && (!locationFilter || i.lastConfirmed.place.split(/\s*[\uFF0F/]\s*/)[0] === locationFilter) && (filter === 'all' || filter === 'shareable' && i.share === 'request' || filter === 'uncertain' && i.positionStatus !== 'confirmed' || filter === 'private' && i.share === 'private'));
    $('#result-line').textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
    $('#inventory-grid').className = `inventory-grid inventory-${inventoryLayout}`;
    $('#inventory-grid').innerHTML = items.length ? items.map(i => `<article class="item-card inventory-entry"><div class="item-visual ${tone(i.category)}">${(i.thumbnail || i.photo) ? `<img src="${esc(i.thumbnail || i.photo)}" alt="${esc(i.name)} photo">` : icon(i.category)}</div><div class="item-content"><div class="item-title"><h3><button class="item-open" data-action="view-item" data-id="${esc(i.id)}">${itemText(i, 'name', i.name)}</button></h3><span class="item-stock">Qty ${i.quantity}</span></div><div class="location-row"><span>Last confirmed location</span>${itemText(i, 'place', i.lastConfirmed.place)}</div><div class="item-summary-bottom"><span class="item-owner">${itemText(i, 'owner', i.owner)}</span><div class="badge-row">${badge(i.share === 'private' ? 'Private' : 'Open to requests', i.share === 'private' ? 'gray' : '')}${i.positionStatus !== 'confirmed' ? badge('Location unverified', 'amber') : ''}${i.condition !== 'good' ? badge('Needs repair', 'red') : ''}</div></div></div></article>`).join('') : '<div class="empty-state"><h3>No matching items</h3><p>Try a different keyword or location, or clear your filters.</p><button class="button" data-action="clear-filters">Clear filters</button></div>';
  }
  function viewItem(id) {
    const item = state.items.find(i => i.id === id); if (!item) return;
    const predictions = item.positionStatus !== 'confirmed' ? E.predictions(item) : [];
    const seedCategories = {s1:'support',t1:'tripod',c1:'clamp',s2:'support',s3:'support',s4:'support',b1:'board',e1:'easel',h1:'chair',p1:'cable'};
    const examplePhoto = !item.photo && seedCategories[item.id] === item.category ? window.ExamplePhotos?.figure(item.category) || '' : '';
    const originalPhoto = item.photo ? `<figure class="example-photo"><a href="${esc(item.photo)}" target="_blank" rel="noopener" aria-label="View full photo"><img src="${esc(item.photo)}" alt="${esc(item.name)} photo"></a>${item.publicPhoto ? `<figcaption class="photo-credit">Public photo · Manually annotated<br>${esc(item.publicPhoto.author)} / Pexels · <a href="${esc(item.publicPhoto.pageUrl)}" target="_blank" rel="noopener noreferrer">Photo source</a> · <a href="${esc(item.publicPhoto.licenseUrl)}" target="_blank" rel="noopener noreferrer">License</a></figcaption>` : ''}</figure>` : '';
    openModal('Item details', `${originalPhoto || examplePhoto}<div class="item-detail-top"><div class="item-detail-photo ${tone(item.category)}">${item.photo ? `<img src="${esc(item.photo)}" alt="${esc(item.name)} photo">` : icon(item.category)}</div><div><span class="small-label">Demo inventory · ${esc(E.categories[item.category])}</span><h3>${itemText(item, 'name', item.name)}</h3><p><span>Recorded quantity ${item.quantity} units</span> · ${itemText(item, 'owner', item.owner)}</p><div class="badge-row">${badge(item.share === 'private' ? 'Private' : 'Open to requests', item.share === 'private' ? 'gray' : '')}${badge(item.condition === 'good' ? 'In working order' : 'Needs repair', item.condition === 'good' ? 'gray' : 'red')}</div></div></div>
      <section class="item-detail-section"><h3>Location</h3><dl class="detail-facts"><div><dt>Last confirmed</dt><dd>${itemText(item, 'place', item.lastConfirmed.place)}<small>${esc(formatDate(item.lastConfirmed.at))} · ${itemText(item, 'owner', item.lastConfirmed.by || item.owner)}</small></dd></div><div><dt>Current status</dt><dd>${item.positionStatus === 'confirmed' ? 'Location verified in the demo' : 'May have moved'}</dd></div></dl>${predictions.length ? `<div class="detail-prediction"><strong>Suggested location · Unconfirmed</strong><ol>${predictions.map(p => `<li>${esc(p.place)}</li>`).join('')}</ol></div>` : ''}</section>
      <section class="item-detail-section"><h3>Specifications and notes</h3><dl class="detail-facts">${Object.entries(item.specs).map(([key, value]) => `<div><dt>${esc(photoSpecLabels[key] || key)}</dt><dd>${value === null || value === '' ? 'Needs verification' : esc(value)}</dd></div>`).join('') || '<div><dt>Specifications</dt><dd>No information yet</dd></div>'}</dl>${item.note ? `<p class="inline-note">${itemText(item, 'note', item.note)}</p>` : ''}</section>
      <details class="details"><summary>Location and booking history (${item.history.length + item.reservations.length})</summary><div class="details-body">${item.history.map(h => `<p>${esc(formatDate(h.at))} · ${esc(h.place)}<br>${esc(({ confirmed: 'Confirmed location', activity: 'Recorded activity', returned: 'Returned here' })[h.kind] || 'Previous location')}</p>`).join('')}${item.reservations.map(r => `<p>${esc(r.purpose || r.requestId)} · ${r.quantity} units<br>${esc(r.start.replace('T', ' '))} — ${esc(r.end.replace('T', ' '))}<br>${r.approved ? 'Demo approval' : 'Pending approval'}</p>`).join('')}</div></details>
      <p class="inline-note">Each booking needs the owner’s approval. Available quantity depends on the requested dates.</p><div class="modal-footer"><button class="button" data-action="close-modal">Close</button><a class="button" href="groups.html#item=${esc(encodeURIComponent(item.id))}">Share with a group</a><button class="button primary" data-action="edit-item" data-id="${esc(item.id)}">Edit record</button></div>`);
  }
  function renderRequest(r = state.request) {
    const phoneNeed = r.needs.find(n => n.id === 'phone');
    $('#view').innerHTML = `<section class="page-head"><div><h1>Find resources</h1></div></section>
      <details class="preset-picker"><summary>Demo scenario: ${esc(E.presets.find(p => p.id === r.id)?.title || 'Custom request')}</summary><div class="preset-tabs" role="group" aria-label="Choose a demo request">${E.presets.map((p, i) => `<button data-action="preset" data-id="${p.id}" class="preset-tab ${r.id === p.id ? 'active' : ''}" aria-pressed="${r.id === p.id}">${esc(p.title)}</button>`).join('')}</div></details>
      <div class="request-layout"><form id="request-form" class="panel"><div class="section-title"><span class="step-circle">1</span><h2>Describe your activity</h2></div><div class="field request-purpose-field"><label for="request-purpose">Purpose and items needed</label><textarea id="request-purpose" name="purpose" maxlength="1000" placeholder="Example: Three groups need phone stands for a club exhibition on Friday afternoon.">${esc(r.purpose)}</textarea></div><div class="field"><label for="request-title">Request name</label><input id="request-title" name="title" required maxlength="100" value="${esc(r.title)}"></div><div class="form-grid"><div class="field"><label for="request-start">Start time</label><input id="request-start" name="start" type="datetime-local" required value="${esc(r.start)}"></div><div class="field"><label for="request-end">End time / Return</label><input id="request-end" name="end" type="datetime-local" required value="${esc(r.end)}"></div></div><div class="form-divider"></div><div class="section-title"><span class="step-circle">2</span><h2>Requirements</h2></div>${r.needs.map(n => `<div class="need-input-row"><div><h3>${esc(n.label)}</h3><p>${n.id === 'phone' ? 'One phone support per group' : n.id === 'display' ? 'A display board with a compatible easel' : 'A chair in working order'}</p></div><input aria-label="${esc(n.label)} quantity needed" name="qty-${n.id}" type="number" min="1" max="12" step="1" required value="${n.quantity}"></div>`).join('')}${r.needs.some(n => n.id === 'phone') ? `<div class="form-grid bottom-space"><div class="field"><label for="phone-width">Phone width (mm)</label><input id="phone-width" name="phoneWidth" type="number" min="1" max="300" step="0.1" value="${phoneNeed?.phoneWidthMm ?? ''}" required></div><div class="field"><label for="phone-weight">Phone and accessory weight (g)</label><input id="phone-weight" name="phoneWeight" type="number" min="1" max="2000" step="1" value="${phoneNeed?.phoneWeightG ?? ''}" required></div></div><label class="checkbox-row"><input name="alternatives" type="checkbox" ${r.allowAlternatives ? 'checked' : ''}><span>Allow compatible alternatives<br><small class="muted">For example, a tripod and clamp with compatible connectors and load ratings.</small></span></label>` : '<p class="inline-note">Each display board needs an easel that supports its dimensions.</p>'}<div id="request-error" class="error" role="alert"></div><div class="form-actions"><span class="muted">Supports phone stands, display kits, and chairs</span><button class="button primary" type="submit">View resource plan <span aria-hidden="true">→</span></button></div></form>
      <details class="details request-guidance"><summary>How matching works</summary><div class="details-body"><p>The planner matches phone supports, display kits, and chairs using the purpose, quantity, specifications, and dates you confirm.</p><p>A unit counts as secured once its location, condition, and booking approval are confirmed in this local simulation.</p></div></details></div>`;
    const preset = E.presets.find(p => p.id === r.id);
    previewSampleField('#request-title', r.title, preset?.title);
    previewSampleField('#request-purpose', r.purpose, preset?.purpose);
    $('#request-purpose').parentElement.insertAdjacentHTML('beforeend', '<div class="request-ai-tools"><div class="request-ai-row"><button class="button small" type="button" id="ai-request-button">Use AI to organize text</button><p id="request-ai-summary" class="inline-note"></p></div><details class="request-ai-details"><summary>AI processing details</summary><p data-ai-notice="request">' + esc(D.processingNotice(service, 'request')) + '</p></details></div>');
    $('#ai-request-button').onclick = () => organizeRequest(r);
    updateAINotices();
    $('#request-form').addEventListener('submit', e => {
      e.preventDefault();
      const f = new FormData(e.target), next = E.clone(state); next.request = E.clone(r);
      next.request.title = fieldValue(e.target, f, 'title'); next.request.purpose = fieldValue(e.target, f, 'purpose'); next.request.start = String(f.get('start')); next.request.end = String(f.get('end')); next.request.allowAlternatives = next.request.needs.some(n => n.id === 'phone') ? f.has('alternatives') : true;
      for (const n of next.request.needs) { n.quantity = Number(f.get('qty-' + n.id)); if (n.id === 'phone') { n.phoneWidthMm = Number(f.get('phoneWidth')); n.phoneWeightG = Number(f.get('phoneWeight')); } }
      try { state = E.validateState(next); save(); showAllActions = false; navigate('plan'); } catch (error) { $('#request-error').textContent = error.message; }
    });
  }
  function requestText(request, field) {
    const preset = E.presets.find(entry => entry.id === request.id);
    return request[field] === preset?.[field] ? esc(request[field]) : '<bdi translate="no">' + esc(request[field]) + '</bdi>';
  }
  function renderPlan(plan) {
    const r = state.request, pending = plan.needs.reduce((n, p) => n + p.pending, 0);
    $('#view').innerHTML = `<section class="page-head plan-head"><div><h1>${requestText(r, 'title')}</h1><p>${requestText(r, 'purpose')}</p><div class="request-period"><span aria-hidden="true">◷</span>${esc(r.start.replace('T', ' '))} — ${esc(r.end.replace('T', ' '))}<a class="text-button" href="#request">Edit requirements</a></div></div><div><details class="strategy-options"><summary>Verification order</summary><div class="strategy-switch" role="group" aria-label="Sort checks"><button data-action="strategy" data-strategy="task" class="${strategy === 'task' ? 'active' : ''}" aria-pressed="${strategy === 'task'}">Task priority</button><button data-action="strategy" data-strategy="inventory" class="${strategy === 'inventory' ? 'active' : ''}" aria-pressed="${strategy === 'inventory'}">By item name</button></div></details></div></section>
      <div class="summary-strip plan-summary"><div class="summary-cell"><div><div class="summary-label">Requested</div><div class="summary-number">${plan.total}<small>units needed</small></div></div><span class="summary-symbol" aria-hidden="true">◫</span></div><div class="summary-cell secured"><div><div class="summary-label">Secured · Approved and reserved in demo</div><div class="summary-number">${plan.secured}<small>units</small></div></div><span class="summary-symbol" aria-hidden="true">✓</span></div><div class="summary-cell unsecured"><div><div class="summary-label">Outstanding · Includes candidates awaiting checks</div><div class="summary-number">${plan.unsecured}<small>units</small></div></div><span class="summary-symbol" aria-hidden="true">…</span></div></div>
      <div class="progress-track" aria-label="${plan.secured} secured, ${pending} awaiting checks, ${plan.total} requested"><div class="progress-done" style="width:${plan.secured / plan.total * 100}%"></div><div class="progress-pending" style="width:${pending / plan.total * 100}%"></div></div><div class="legend"><span><i></i>Secured ${plan.secured}</span><span><i class="pending"></i>Candidates awaiting checks ${pending} (included in outstanding units)</span><span>A set of compatible parts counts as one requested unit.</span></div>
      <details class="strategy-note"><summary>Sort order: ${strategy === 'task' ? 'Task priority' : 'By item name'} · Rule-based demo</summary><p class="strategy-explanation">${strategy === 'task' ? 'The planner prioritizes missing details for the current plan, then sorts by estimated effort.' : 'Sorts the same available checks alphabetically by item name.'}</p></details>
      <div class="plan-layout"><section><div class="section-line"><h2>${plan.unsecured ? 'Next checks' : 'Your plan is complete'}</h2><span>${plan.actions.length} available checks</span></div>${plan.unsecured ? `<div class="action-progress">Record a result to recalculate the plan.${strategy === 'task' ? '<span class="progress-index">Current plan</span>' : ''}</div>${plan.actions.length ? (showAllActions ? plan.actions : plan.actions.slice(0, 3)).map((a, index) => renderAction(a, index)).join('') : '<div class="empty-state"><h3>The remaining demand exceeds available inventory</h3><p>Review excluded items below or add another item.</p><a class="button" href="#inventory">Back to inventory</a></div>'}${plan.actions.length > 3 ? `<button class="button ghost more-actions" data-action="more-actions">${showAllActions ? 'Hide other checks' : `Show ${plan.actions.length - 3} more checks`}</button>` : ''}` : '<div class="success-panel"><div class="success-mark" aria-hidden="true">✓</div><h2>Available items cover this request</h2><p>These approvals belong to the demo. Real loans also require pickup and return.</p></div>'}
      <details class="details"><summary>Why were items excluded?</summary><div class="details-body">${plan.blocked.length ? `<ul class="block-list">${plan.blocked.map(b => `<li><strong>${esc(b.name)}</strong>: <span>${esc(b.reason)}</span></li>`).join('')}</ul>` : '<p>All items passed the sharing, condition, and booking checks.</p>'}<p>Matching also accounts for category, dimensions, connectors, and supported combinations.</p></div></details>
      <details class="details"><summary>Checks and planning rules (${state.events.length} demo events)</summary><div class="details-body"><p>The current plan has a weight of 10 and alternatives have a weight of 1. Priority is the weight times the number of units awaiting checks, divided by estimated minutes. Specifications: 2 min, location check: 5 min, new location inquiry: 8 min, approval: 4 min. These times are estimates. The search keeps up to 96 possible plans at each step.</p><p>Location suggestions use the type and age of each recorded event. A failed check removes a location until the next confirmed sighting. Rules rank both combinations and checks. AI assists with request text and photo recognition. Review its suggestions.</p>${state.events.length ? state.events.slice(0, 12).map(e => `<div class="audit-row">${esc(e.action)} · ${esc(outcomeLabel(e.outcome))}${e.value ? ' · ' + esc(e.value) : ''}<small>${esc(formatDate(e.at))} · ${esc(e.requestId)} · Demo data</small></div>`).join('') : '<p>No checks recorded yet.</p>'}</div></details></section>
      <aside class="plan-aside"><section class="plan-card"><h2>Current plan</h2>${plan.needs.map(n => `<div class="need-heading"><span>${esc(n.label)}</span><span>${n.secured}/${n.quantity} Secured</span></div>${n.allocations.map(a => `<div class="allocation"><div class="allocation-title"><span>${esc(a.candidate.label)} × ${a.quantity}</span>${badge(a.pending ? 'Needs verification' : 'Secured', a.pending ? 'amber' : '')}</div><div class="allocation-parts">${a.candidate.parts.map(i => `<span>${esc(i.name)} × ${a.quantity}</span>`).join('')}</div><div class="allocation-meta">${a.pending ? `${a.secured ? a.secured + ' secured, ' : ''}${a.pending} awaiting confirmation` : 'Location, specifications, and demo reservation confirmed'}</div></div>`).join('')}${n.noCandidate ? `<div class="allocation-parts">Another ${n.noCandidate} units have no suitable candidate.</div>` : ''}`).join('')}</section><section class="gap-box"><h3>Outstanding needs</h3>${plan.needs.filter(n => n.unsecured).map(n => `<div class="gap-row"><span>${esc(n.label)}</span><strong>${n.unsecured} outstanding</strong></div>`).join('') || '<div class="gap-row"><span>No additional items needed</span><strong>0</strong></div>'}<p>${pending ? `Of these, ${pending} units have candidates awaiting verification.` : ''} Additional borrowing, a revised request, or new offers can fill the gap.</p><button class="button small" data-action="export-gap">Export list .txt</button></section></aside></div>`;
  }
  function renderAction(a, index) {
    return `<article class="action-card ${index === 0 && strategy === 'task' ? 'recommended' : ''}"><div class="action-top"><div class="rank">${String(index + 1).padStart(2, '0')}</div><div><h3>${esc(a.title)}</h3><p>${esc(a.detail)}</p></div></div><div class="action-badges">${badge(a.selected ? 'Current plan' : 'Alternative', a.selected ? '' : 'gray')}${badge(`Estimated effort ${a.cost} min`, 'gray')}${a.type === 'spec' ? badge('Check specifications', 'amber') : a.type === 'locate' ? badge('Suggested location', 'amber') : badge('Ask the owner', 'amber')}</div><div class="action-foot"><span>${a.selected ? 'Record a result to check the whole plan again' : 'An alternative if the current plan falls through'}</span><div class="action-buttons">${a.type === 'locate' && a.place ? `<button class="button small ghost" data-action="not-found" data-key="${esc(a.key)}">Not found here</button>` : ''}${a.type === 'approve' ? `<button class="button small ghost" data-action="deny" data-key="${esc(a.key)}">Simulate refusal</button>` : ''}<button class="button small ${index === 0 ? 'primary' : ''}" data-action="perform" data-key="${esc(a.key)}">${a.type === 'spec' ? 'Record findings' : a.type === 'locate' ? 'Confirm location' : 'Simulate approval'} <span aria-hidden="true">→</span></button></div></div></article>`;
  }
  function outcomeLabel(outcome) { return ({ verified: 'Specifications updated', found: 'Location confirmed', 'not-found': 'Not found here', approved: 'Approved and reserved in demo', denied: 'Declined in demo' })[outcome] || outcome; }
  function updateAINotices() {
    if ($('#request-ai-summary')) $('#request-ai-summary').textContent = service.remoteProcessing ? `Request text goes to ${service.provider}. Charges may apply. Review the suggested fields.` : service.known ? 'A local model will organize your text for review.' : 'AI offline. Your request text stays here.';
    $('#service-summary').textContent = service.remoteProcessing ? (service.ready ? 'Cloud recognition · Confirm each upload. Charges may apply.' : 'Cloud recognition unavailable') : service.known ? 'Local recognition · ' + (service.ready ? 'Processed on this device' : 'Service unavailable') : 'Manual mode';
    $('#model-notice').innerHTML = '<strong>Simulated inventory and approvals.</strong> Review new photo drafts before adding them. ' + esc(D.processingNotice(service));
    for (const element of document.querySelectorAll('[data-ai-notice]')) element.textContent = D.processingNotice(service, element.dataset.aiNotice);
    const provider = service.remoteProcessing ? service.provider : service.known ? 'local AI' : 'AI';
    for (const [id, action] of [['#ai-request-button', 'Organize text'], ['#ai-photo-button', 'Recognize photo']]) {
      const button = $(id);
      if (button) {
        button.disabled = !service.ready || modelBusy;
        if (!modelBusy) button.textContent = action + ' with ' + provider;
      }
    }
    window.PhotoDraftUI?.updateBackendStatus?.(service);
  }
  function refreshService() {
    if (healthRequest) return healthRequest;
    if (!window.ResourceAI.available) { service = D.normalizeServiceHealth(null); updateAINotices(); return Promise.resolve(service); }
    healthRequest = (async () => {
      try {
        const reported = D.normalizeServiceHealth(await window.ResourceAI.health());
        service = window.ResourceAI.hosted && !reported.remoteProcessing ? D.normalizeServiceHealth(null) : reported;
      } catch (error) { service = D.normalizeServiceHealth(null); }
      modelAvailable = service.ready; modelName = service.model; updateAINotices(); return service;
    })().finally(() => { healthRequest = null; });
    return healthRequest;
  }
  async function callModel(endpoint, payload, button) {
    if (!modelAvailable || location.protocol === 'file:') {
      toast('Recognition is unavailable. Check the connection in Photo capture and try again.');
      return null;
    }
    if (modelBusy) { toast( 'The previous request is still processing.'); return null; }
    const oldText = button.textContent, controller = new AbortController(), timer = setTimeout(() => controller.abort(), 180000);
    modelBusy = true; button.disabled = true; button.textContent = service.remoteProcessing ? `Processing with ${service.provider}…` : 'Local model running…';
    try {
      return await window.ResourceAI.extract(endpoint, payload, service, controller.signal);
    } catch (error) { throw new Error(error.name === 'AbortError' ? 'The request timed out after three minutes. Cloud charges may apply if you retry.' : error.message); }
    finally { clearTimeout(timer); modelBusy = false; button.disabled = !service.ready; button.textContent = oldText; updateAINotices(); }
  }
  async function organizeRequest(current) {
    const form = $('#request-form'), text = $('#request-purpose').value.trim();
    if (!text) { $('#request-error').textContent = 'Enter a purpose, quantity, specification, or date first.'; return; }
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
        seen.add(n.id); supported.push({ id: n.id, label: ({ phone: 'Phone support kit', display: 'Display kit', chair: 'Chair' })[n.id], quantity: Number.isInteger(n.quantity) && n.quantity > 0 && n.quantity <= 12 ? n.quantity : null, ...(n.id === 'phone' ? { phoneWidthMm: Number.isFinite(n.phoneWidthMm) && n.phoneWidthMm > 0 && n.phoneWidthMm <= 300 ? n.phoneWidthMm : null, phoneWeightG: Number.isFinite(n.phoneWeightG) && n.phoneWeightG > 0 && n.phoneWeightG <= 2000 ? n.phoneWeightG : null } : {}) });
      }
      openModal('Review AI suggestions', `<div class="info-panel">Model: ${esc(result.model || modelName)} · ${Number.isFinite(result.elapsedSeconds) ? esc(result.elapsedSeconds.toFixed(1)) + ' sec' : 'AI reasoning'}<br>Review the proposed quantities, dimensions, and times before saving.</div><h3>Identified needs</h3>${unsupported.length ? `<div class="error"><strong>Unsupported needs: </strong><br>${unsupported.map(n => esc(n.label || n.sourceText || 'Unknown need')).join('<br>')}<br>Resolve the unsupported needs before applying this draft.</div>` : ''}${supported.length ? `<ul>${supported.map(n => `<li>${esc(n.label)}: ${n.quantity ?? 'Unknown quantity'}${n.id === 'phone' ? `. Phone width: ${n.phoneWidthMm ?? 'Unknown'} mm, weight: ${n.phoneWeightG ?? 'Unknown'} g` : ''}</li>`).join('')}</ul>` : '<p>No supported need identified. Enter the details in the form.</p>'}<p>Start: ${esc(d.startLocal || 'Unknown. Fill this in after applying the draft.')}<br>End: ${esc(d.endLocal || 'Unknown. Fill this in after applying the draft.')}<br>Alternative combinations: ${typeof d.allowAlternatives === 'boolean' ? d.allowAlternatives ? 'Allowed' : 'Disallowed' : 'Confirm this choice'}</p>${Array.isArray(d.missingQuestions) && d.missingQuestions.length ? `<h3>Details to add</h3><ul>${d.missingQuestions.map(q => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}${Array.isArray(d.evidence) && d.evidence.length ? `<details class="details"><summary>View excerpts from your request</summary><div class="details-body">${d.evidence.map(e => `<p>${esc(e.field)}: ${esc(e.quote)}</p>`).join('')}</div></details>` : ''}<p>Complete missing quantities, specifications, and dates in the form. Unsupported needs must be resolved before applying the draft.</p><div class="modal-footer"><button class="button" data-action="close-modal">Back</button><button id="adopt-request" class="button primary" ${supported.length && !unsupported.length ? '' : 'disabled'}>Apply draft</button></div>`);
      $('#adopt-request').onclick = () => {
        draft.needs = supported;
        if (typeof d.purpose === 'string' && d.purpose.length <= 1000) draft.purpose = d.purpose;
        draft.start = typeof d.startLocal === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.startLocal) ? d.startLocal : '';
        draft.end = typeof d.endLocal === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.endLocal) ? d.endLocal : '';
        draft.allowAlternatives = d.allowAlternatives === true;
        closeModal(); renderRequest(draft); toast('Draft applied. Fill in missing fields and review before submitting.');
      };
    } catch (error) { if ($('#request-error')) $('#request-error').textContent = error.message; }
  }
  let lastModalFocus;
  function openModal(title, html) {
    if (!$('#modal').open) lastModalFocus = document.activeElement;
    $('#modal-content').innerHTML = `<div class="modal-header"><h2 id="modal-title">${esc(title)}</h2><button class="close-modal" aria-label="Close dialog" data-action="close-modal">×</button></div><div class="modal-body">${html}</div>`;
    if (!$('#modal').open) $('#modal').showModal();
  }
  function closeModal() { $('#modal').close(); lastModalFocus?.focus(); }
  function runAction(action, outcome, value) {
    try { state = E.applyAction(state, action, outcome, value, now()); save(); closeModal(); render(); toast(outcomeLabel(outcome) + '. Plan recalculated.'); } catch (error) { if ($('#action-error')) $('#action-error').textContent = error.message; else toast(error.message); }
  }
  function actionDialog(action, mode) {
    const item = state.items.find(i => i.id === action.itemId);
    if (mode === 'not-found') { runAction(action, 'not-found'); return; }
    if (mode === 'deny') { openModal('Simulate a declined request', `<p><strong>${esc(item.name)}</strong> will be removed from this request. The planner will check other combinations.</p><div class="info-panel">This action records a refusal in the local demo.</div><div class="modal-footer"><button class="button" data-action="close-modal">Cancel</button><button id="confirm-deny" class="button danger">Record demo refusal</button></div>`); $('#confirm-deny').onclick = () => runAction(action, 'denied'); return; }
    if (action.type === 'spec') {
      openModal('Verify a specification', `<p>${esc(item.name)} · ${esc(action.fieldLabel)}</p><div class="info-panel">${action.field === 'connector' ? 'Check the connector markings to confirm compatibility.' : `This request requires ${esc(action.min)}. Enter the measured value, even if it falls below the requirement.`}<br>Enter the result of your own measurement or label check.</div><form id="action-form"><div class="field"><label for="action-value">${esc(action.fieldLabel)}</label>${action.field === 'connector' ? '<select id="action-value" required><option value="quarter-inch">1/4-inch connector</option><option value="other">Other connector</option></select>' : '<input id="action-value" type="number" min="0.01" max="100000" step="any" required placeholder="Enter the measured value">'}</div><div id="action-error" class="error" role="alert"></div><div class="modal-footer"><button type="button" class="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit">Save demo result</button></div></form>`);
      $('#action-form').onsubmit = e => { e.preventDefault(); runAction(action, 'verified', $('#action-value').value); };
    } else if (action.type === 'locate') {
      openModal('Confirm item location', `<p>Record a location for <strong>${esc(item.name)}</strong> .</p><div class="info-panel">Last confirmed location: ${esc(item.lastConfirmed.place)}<br>The new location will be saved as a timestamped demo sighting.</div><form id="action-form"><div class="field"><label for="action-value">Confirmed location</label><input id="action-value" required maxlength="120" value="${esc(action.place)}" placeholder="Enter the location where you found it"></div><div id="action-error" class="error" role="alert"></div><div class="modal-footer"><button type="button" class="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit">Save location</button></div></form>`);
      $('#action-form').onsubmit = e => { e.preventDefault(); runAction(action, 'found', $('#action-value').value); };
    } else {
      openModal('Simulate owner approval and reservation', `<p><strong>${esc(item.owner)}</strong> · ${esc(item.name)} × ${action.quantity}</p><div class="info-panel">${esc(state.request.start.replace('T', ' '))} <span>to</span> ${esc(state.request.end.replace('T', ' '))}<br>Review the purpose, quantity, and dates before reserving.</div><p>This demo records approval on this device. Arrange actual loans with the owner.</p><div id="action-error" class="error" role="alert"></div><div class="modal-footer"><button class="button" data-action="close-modal">Cancel</button><button id="confirm-approve" class="button primary">Approve demo booking</button></div>`);
      $('#confirm-approve').onclick = () => runAction(action, 'approved');
    }
  }
  function specFields(category, specs) {
    const defs = { support: [['maxWidthMm', 'Maximum supported phone width (mm)'], ['maxWeightG', 'Maximum load (g)']], tripod: [['maxWeightG', 'Maximum load (g)'], ['connector', 'Connector']], clamp: [['maxWidthMm', 'Maximum clamp width (mm)'], ['maxWeightG', 'Maximum load (g)'], ['connector', 'Connector']], board: [['widthMm', 'Board width (mm)'], ['heightMm', 'Board height (mm)']], easel: [['maxBoardWidthMm', 'Maximum board width (mm)'], ['maxBoardHeightMm', 'Maximum board height (mm)']] };
    return (defs[category] || []).map(([key, label]) => `<div class="field"><label for="spec-${key}">${label}</label>${key === 'connector' ? `<select name="spec-${key}" id="spec-${key}"><option value="">Unknown</option><option value="quarter-inch" ${specs[key] === 'quarter-inch' ? 'selected' : ''}>1/4-inch connector</option><option value="other" ${specs[key] === 'other' ? 'selected' : ''}>Other connector</option></select>` : `<input name="spec-${key}" id="spec-${key}" type="number" min="0.01" max="100000" step="any" placeholder="Optional if unknown" value="${esc(specs[key] ?? '')}">`}</div>`).join('');
  }
  function editItem(id, fromDraft = null, draftScene = null, onSaved = null) {
    const existing = state.items.find(i => i.id === id);
    const item = existing ? E.clone(existing) : { id: 'local-' + Date.now().toString(36), isSynthetic: true, name: '', category: 'support', quantity: 1, owner: '', share: 'request', condition: 'good', specs: {}, lastConfirmed: { place: '', at: now(), by: 'Demo recorder' }, positionStatus: 'confirmed', history: [], checkedPlaces: [], reservations: [], deniedFor: [], photo: '', note: '' };
    if (fromDraft) {
      item.name = fromDraft.name; item.category = fromDraft.category; item.quantity = fromDraft.visibleQuantity;
      item.photo = (draftScene?.source === 'public-photo-demo' ? draftScene.originalImage : fromDraft.thumbnail || draftScene?.originalImage) || ''; item.owner = ''; item.share = ''; item.condition = ''; item.positionStatus = 'uncertain';
      if (draftScene?.source === 'public-photo-demo') { item.thumbnail = fromDraft.thumbnail; item.publicPhoto = draftScene.publicPhoto; }
      item.lastConfirmed = { place: '', at: '', by: '' }; item.note = 'From a photo draft. Model: ' + fromDraft.model + '. Requires review.' + (fromDraft.uncertainties.length ? '\nTo verify: ' + fromDraft.uncertainties.join(', ') : '');
    }
    let photo = item.photo;
    openModal(fromDraft ? 'Add to demo inventory' : existing ? 'Item record' : 'Add an item', `<div class="info-panel">Your item stays in this browser. Review its quantity and sharing terms with the owner.</div><form id="item-form"><div class="photo-upload"><img id="photo-preview" ${photo ? `src="${esc(photo)}"` : 'hidden'} alt="Local photo preview"><p>Add a photo of the item</p><input id="photo-input" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Choose a photo"><p>JPEG, PNG, or WebP, up to 20 MB. Large images are resized in this browser.</p></div><div class="form-grid"><div class="field"><label for="item-name">Item name</label><input id="item-name" name="name" required maxlength="100" value="${esc(item.name)}"></div><div class="field"><label for="item-category">Category</label><select name="category" id="item-category">${Object.entries(E.categories).map(([k, v]) => `<option value="${k}" ${k === item.category ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="field"><label for="item-qty">Quantity</label><input id="item-qty" name="quantity" type="number" min="1" max="30" step="1" required value="${item.quantity}"></div><div class="field"><label for="item-owner">Owner or contact</label><input id="item-owner" name="owner" required maxlength="100" value="${esc(item.owner)}"></div><div class="field"><label for="item-share">Sharing</label><select id="item-share" name="share"><option value="request" ${item.share === 'request' ? 'selected' : ''}>Requests allowed. Each loan needs approval.</option><option value="private" ${item.share === 'private' ? 'selected' : ''}>Sharing disabled</option></select></div><div class="field"><label for="item-condition">Condition</label><select id="item-condition" name="condition"><option value="good" ${item.condition === 'good' ? 'selected' : ''}>In working order</option><option value="repair" ${item.condition === 'repair' ? 'selected' : ''}>Needs repair / Out of service</option></select></div></div><div class="form-divider"></div><h3>Location record</h3><div class="field"><label for="item-place">Last known location</label><input id="item-place" name="place" required maxlength="120" value="${esc(item.lastConfirmed.place)}"></div><div class="form-grid"><div class="field"><label for="item-at">Last confirmation</label><input id="item-at" name="at" type="datetime-local" required value="${esc(item.lastConfirmed.at)}"></div><div class="field"><label for="item-position">Location status</label><select id="item-position" name="positionStatus"><option value="confirmed" ${item.positionStatus === 'confirmed' ? 'selected' : ''}>Location verified</option><option value="uncertain" ${item.positionStatus === 'uncertain' ? 'selected' : ''}>May have moved</option></select></div></div>${existing && item.positionStatus !== 'confirmed' ? `<p class="inline-note">Suggested location: ${E.predictions(item).map(p => esc(p.place)).join(' → ') || 'Add a new lead'}. Suggestions are stored separately from confirmations.</p>` : ''}<div class="form-divider"></div><h3>Key specifications</h3><div id="spec-fields" class="form-grid">${specFields(item.category, item.specs)}</div><p class="inline-note">Leave unknown fields blank. The planner flags unknowns and excludes incompatible items.</p><div class="field"><label for="item-note">Notes</label><textarea id="item-note" name="note" maxlength="1000">${esc(item.note)}</textarea></div>${existing && item.reservations.length ? `<details class="details"><summary>Demo bookings (${item.reservations.length})</summary><div class="details-body">${item.reservations.map(r => `<p>${esc(r.requestId)} · ${r.quantity} units<br>${esc(r.start.replace('T', ' '))} — ${esc(r.end.replace('T', ' '))}<br>${r.approved ? 'Demo approval' : 'Pending approval'}</p>`).join('')}</div></details>` : ''}<div id="item-error" class="error" role="alert"></div><div class="modal-footer"><button type="button" class="button" data-action="close-modal">Cancel</button><button id="save-item" class="button primary" type="submit">Save demo record</button></div></form>`);
    previewSampleField('#item-name', item.name, sampleField(item, 'name'));
    previewSampleField('#item-owner', item.owner, sampleField(item, 'owner'));
    previewSampleField('#item-note', item.note, sampleField(item, 'note'));
    previewSampleField('#item-place', item.lastConfirmed.place, sampleField(item, 'place'));
    $('.photo-upload').insertAdjacentHTML('beforeend', '<button type="button" class="button small" id="ai-photo-button" style="margin-top:12px">✧ Recognize photo with AI</button><p class="inline-note" data-ai-notice="item">' + esc(D.processingNotice(service, 'item')) + '</p><div id="ai-photo-result"></div>');
    updateAINotices();
    $('#ai-photo-button').onclick = async () => {
      if (!photo) { $('#item-error').textContent = 'Choose a local photo first.'; return; }
      const button = $('#ai-photo-button'), requestedPhoto = photo;
      try {
        const response = await callModel('/api/extract-item', { image: photo, text: $('#item-note').value || $('#item-name').value }, button);
        if (!response || !$('#ai-photo-result') || photo !== requestedPhoto) return;
        const d = response.data || {};
        $('#ai-photo-result').innerHTML = `<div class="info-panel" style="text-align:left;margin:15px 0 0"><strong>Model suggestions · ${esc(response.model || modelName)}</strong><p>Name: ${esc(d.name || 'Unknown')}<br>Category: ${esc(E.categories[d.category] || 'Unknown')}<br>Visible quantity: ${esc(d.visibleQuantity ?? 'Unknown')}</p>${d.visibleText ? `<p>Visible text: ${esc(d.visibleText)}</p>` : ''}${Array.isArray(d.specSuggestions) && d.specSuggestions.length ? `<p>Specification clues to review: <br>${d.specSuggestions.map(s => esc(photoSpecLabels[s.field] || 'Other specifications') + ': ' + esc(s.value)).join('<br>')}</p>` : ''}${Array.isArray(d.uncertainties) ? `<p>${d.uncertainties.map(esc).join('<br>')}</p>` : ''}<p>Applying fills in the name, category, and visible quantity. Check the actual inventory before saving.</p><button id="adopt-photo" type="button" class="button small">Use these fields</button></div>`;
        $('#adopt-photo').onclick = () => {
          if (typeof d.name === 'string' && d.name.length <= 100) $('#item-name').value = d.name;
          if (Object.hasOwn(E.categories, d.category)) { $('#item-category').value = d.category; $('#spec-fields').innerHTML = specFields(d.category, {}); }
          if (Number.isInteger(d.visibleQuantity) && d.visibleQuantity > 0 && d.visibleQuantity <= 30) $('#item-qty').value = d.visibleQuantity;
          $('#adopt-photo').disabled = true; $('#adopt-photo').textContent = 'Fields filled in. Review before saving.';
        };
      } catch (error) { if ($('#item-error')) $('#item-error').textContent = error.message; }
    };
    if (fromDraft) {
      $('#item-form').insertAdjacentHTML('afterbegin', '<div class="info-panel">Review the photo draft, enter the owner and condition, and choose sharing settings. Record the location and time you verified it.</div>');
      for (const [selector, label] of [['#item-share', 'Choose sharing terms'], ['#item-condition', 'Choose a condition'], ['#item-position', 'Choose a location status']]) {
        const select = $(selector); select.insertAdjacentHTML('afterbegin', '<option value="" selected>' + label + '</option>'); select.value = ''; select.required = true;
      }
      $('#item-qty').value = fromDraft.visibleQuantity ?? '';
      $('#item-place').placeholder = fromDraft.locationHint ? 'Draft location hint: ' + fromDraft.locationHint + ' (verify before entering)' : 'Enter the last verified location';
    }
    $('#item-category').onchange = e => { $('#spec-fields').innerHTML = specFields(e.target.value, {}); };
    let photoPending = false;
    $('#photo-input').onchange = async event => {
      const input = event.target, file = input.files[0];
      const saveButton = $('#save-item');
      if (!file) {
        photoPending = false;
        saveButton.disabled = false;
        $('#item-error').textContent = '';
        return;
      }
      photoPending = true;
      saveButton.disabled = true;
      $('#item-error').textContent = 'Preparing photo…';
      try {
        const image = await window.PhotoDraftUI.preparePhoto(file);
        if ($('#photo-input') !== input || input.files[0] !== file) return;
        photo = image;
        delete item.thumbnail;
        delete item.publicPhoto;
        $('#photo-preview').src = image;
        $('#photo-preview').hidden = false;
        $('#item-error').textContent = '';
      } catch (error) {
        if ($('#photo-input') !== input || input.files[0] !== file) return;
        $('#item-error').textContent = error.message || 'Could not read this photo.';
      } finally {
        if ($('#photo-input') === input && input.files[0] === file) {
          photoPending = false;
          saveButton.disabled = false;
        }
      }
    };
    $('#item-form').onsubmit = e => {
      e.preventDefault();
      if (photoPending) return;
      const f = new FormData(e.target), next = E.clone(state), updated = { ...item };
      updated.name = fieldValue(e.target, f, 'name'); updated.category = String(f.get('category')); updated.quantity = Number(f.get('quantity')); updated.owner = fieldValue(e.target, f, 'owner'); updated.share = String(f.get('share')); updated.condition = String(f.get('condition')); updated.positionStatus = String(f.get('positionStatus')); updated.note = fieldValue(e.target, f, 'note'); updated.photo = photo; updated.specs = {};
      for (const [key, value] of f.entries()) if (key.startsWith('spec-') && value !== '') updated.specs[key.slice(5)] = key === 'spec-connector' ? String(value) : Number(value);
      const place = fieldValue(e.target, f, 'place'), at = String(f.get('at'));
      updated.lastConfirmed = { place, at, by: updated.owner };
      if (!existing || place !== item.lastConfirmed.place || at !== item.lastConfirmed.at) { updated.history.push({ place, at, kind: 'confirmed' }); updated.checkedPlaces = []; }
      if (existing) next.items[next.items.findIndex(i => i.id === item.id)] = updated; else next.items.push(updated);
      try { state = E.validateState(next); save(); closeModal(); render(); if (onSaved) onSaved(updated.id); toast('Demo record saved.'); } catch (error) { $('#item-error').textContent = error.message; }
    };
  }
  function download(name, text, type) { const blob = new Blob([text], { type }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function exportGap() {
    const plan = E.buildPlan(state, strategy), r = state.request;
    const format = (template, ...args) =>
      translate(template).replace(/\{(\d+)\}/g, (token, index) => args[index] ?? token);
    const preset = E.presets.find(entry => entry.id === r.id);
    const requestField = key => preset?.[key] === r[key] ? translate(r[key]) : r[key];
    const lines = [
      translate('Resource Commons · Outstanding needs'), translate('[Demo planning list]'), '',
      format('Activity: {0}', requestField('title')), format('Purpose: {0}', requestField('purpose')),
      format('Dates: {0} to {1}', r.start, r.end), ''
    ];
    for (const need of plan.needs) {
      lines.push(format('{0}: requested {1}, secured {2}, outstanding {3} (including {4} awaiting checks)',
        translate(need.label), need.quantity, need.secured, need.unsecured, need.pending));
      if (need.id === 'phone') lines.push(format('Phone width: {0} mm, weight: {1} g', need.phoneWidthMm, need.phoneWeightG));
    }
    lines.push('', translate('Outstanding units may already have candidates awaiting approval or verification.'),
      translate('Secured units meet the specifications, location, and approval checks in the local demo.'));
    download(translate('Resource Commons-Demo sourcing list.txt'), lines.join('\\n'), 'text/plain;charset=utf-8');
    toast('Demo sourcing list exported.');
  }
  function dataDialog() {
    openModal('Data and settings', `<div class="info-panel"><strong>Inventory and approvals here are simulated. Review photo drafts before adding an item to your inventory.</strong><br>${esc(D.processingNotice(service))}<br>Posts and messages on the demo board stay in this browser. Use Groups to share selected items with other members.</div><h3>Available in the planner</h3><p>Batch photo drafts, cropping, manual corrections, item records, AI request parsing, rule-based matching, quantity and connector checks, booking conflicts, and location history.</p><h3>Loan coordination</h3><p>Arrange actual approval, pickup, and return with the owner. Private group listings are available under Groups. The public workspace offers cloud recognition. Running the Python backend lets you use a local model. Opening HTML directly supports the rule-based demo.</p><h3>Save and transfer</h3><p>This browser stores data in localStorage. Clearing site data or ending a private session can erase it. Photos stay in browser storage. Cloud recognition sends images to the provider named before upload. An inventory backup includes the request and up to 30 items. Export photo drafts from the Photo drafts section using its import and export controls.</p><div class="data-actions"><button class="button primary" data-action="export-data">Export JSON backup</button><button class="button" data-action="import-data">Import JSON</button></div><h3>Start over</h3><p>Resetting replaces the demo inventory. Export inventory and photo drafts separately to back them up.</p><div class="data-actions"><button class="button" data-action="restore">Restore sample inventory</button><button class="button danger" data-action="clear">Clear inventory and checks</button></div><p class="footnote">Version 1.3 · Photo drafts and demo inventory are stored separately.<br>See the project README for local hosting instructions.</p>`);
  }
  function confirmReset(clear) {
    openModal(clear ? 'Clear demo records?' : 'Restore sample inventory?', `<p>${clear ? 'All items and checks will be cleared. Your current request will be kept.' : 'The sample inventory will replace current items, requests, and checks.'} This action cannot be undone here.</p><div class="modal-footer"><button class="button" data-action="close-modal">Cancel</button><button id="confirm-reset" class="button danger">${clear ? 'Clear inventory' : 'Restore samples'}</button></div>`);
    $('#confirm-reset').onclick = () => { const request = state.request; state = E.seed(); if (clear) { state.items = []; state.events = []; state.request = request; } query = ''; filter = 'all'; save(); closeModal(); render(); toast(clear ? 'Demo inventory cleared.' : 'Sample inventory restored.'); };
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
    else if (action === 'preset') { state.request = E.clone(E.presets.find(p => p.id === target.dataset.id)); save(); render(); toast('Scenario changed. Existing reservations retained.'); }
    else if (action === 'strategy') { strategy = target.dataset.strategy; showAllActions = false; render(); }
    else if (action === 'more-actions') { showAllActions = !showAllActions; render(); }
    else if (['perform', 'not-found', 'deny'].includes(action)) { const a = E.buildPlan(state, strategy).actions.find(x => x.key === target.dataset.key); if (a) actionDialog(a, action); else toast('Plan updated. Select a current check.'); }
    else if (action === 'export-gap') exportGap();
    else if (action === 'export-data') { download('Resource Commons-Demo data-v1.json', JSON.stringify(state, null, 2), 'application/json;charset=utf-8'); toast('Demo data exported.'); }
    else if (action === 'import-data') $('#import-input').click();
    else if (action === 'restore') confirmReset(false);
    else if (action === 'clear') confirmReset(true);
  });
  $('#import-input').onchange = async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    if (file.size > 8000000) { toast('File exceeds 8 MB. Import stopped.'); return; }
    try {
      const incoming = E.validateState(JSON.parse(await file.text()));
      openModal('Import demo data?', `<p>File validated: ${incoming.items.length} items, ${incoming.events.length} checks.</p><p>Importing replaces your current inventory. Request: <strong>${esc(incoming.request.title)}</strong></p><div class="modal-footer"><button class="button" data-action="close-modal">Cancel</button><button class="button primary" id="confirm-import">Replace and import</button></div>`);
      $('#confirm-import').onclick = () => { state = incoming; save(); closeModal(); render(); toast('Demo data imported.'); };
    } catch (error) { toast('Import failed: ' + error.message); }
  };
  $('#data-tools').onclick = dataDialog; $('#help-button').onclick = dataDialog;
  $('#modal').addEventListener('click', e => { if (e.target === $('#modal')) { const r = $('#modal').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeModal(); } });
  window.addEventListener('rc-language-change', () => {
    if (page === 'inventory' && query.trim()) renderItems();
    for (const field of document.querySelectorAll('#request-form input, #request-form textarea, #item-form input, #item-form textarea')) {
      const preview = editableSamples.get(field);
      if (!preview || field.value !== preview.shown) continue;
      preview.shown = translate(preview.source);
      field.value = preview.shown;
    }
  });
  window.addEventListener('hashchange', () => { render(); window.scrollTo({ top: 0, behavior: 'instant' }); });
  $('#modal').addEventListener('close', () => lastModalFocus?.focus());
  window.PhotoDraftUI?.initialize({ notify: toast, refreshService, addManual: () => { libraryTab = 'inventory'; editItem(); }, promote: (draft, scene, done) => editItem(undefined, draft, scene, done), changed: () => { if (page === 'inventory') renderInventory(); } });
  window.CommunityUI?.init({ onNavigate: navigate, notify: toast });
  save(); render();
  refreshService();
})();
