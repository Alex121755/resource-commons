(() => {
  'use strict';
  const D = window.PhotoDraftData;
  if (!D) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const translate = value => window.RCI18n?.t(value) ?? value;
  const confirmAction = message => window.confirm(translate(message));
  const sampleSource = source => source === 'preset-demo' || source === 'public-photo-demo';
  const sampleText = (source, value) => sampleSource(source) ? esc(value) : `<span translate="no">${esc(value)}</span>`;
  const $ = selector => document.querySelector(selector);
  let service = D.normalizeServiceHealth(null);
  let hooks = {}, store = D.emptyStore(), rawBackup = '', readError = '', session = null, controller = null, generation = 0, expanded = false, draftQuery = '', returnFocus = null;
  try { rawBackup = localStorage.getItem(D.STORAGE_KEY) || ''; if (rawBackup) store = D.parse(rawBackup); } catch (error) { readError = 'Could not read your saved photo drafts. The original data is still available.'; }
  const dialog = document.createElement('dialog');
  dialog.id = 'scene-dialog'; dialog.className = 'scene-dialog'; dialog.setAttribute('aria-labelledby', 'scene-title'); document.body.appendChild(dialog);
  const importInput = document.createElement('input'); importInput.type = 'file'; importInput.accept = '.json,application/json'; importInput.hidden = true; document.body.appendChild(importInput);
  function notify(text) { if (hooks.notify) hooks.notify(text); }
  function download(name, text) { const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function persist(next) {
    if (readError) throw new Error('Back up your existing drafts before starting again.');
    const text = D.serialize(next);
    try { localStorage.setItem(D.STORAGE_KEY, text); } catch (error) { throw new Error('Browser storage is full. Download this batch, then free some space.'); }
    store = next; rawBackup = text; renderSection(); hooks.changed?.();
  }
  function imageElement(dataURL) { return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Could not read this image. Choose a JPEG, PNG or WebP image.')); img.src = dataURL; }); }
  async function compress(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20000000) throw new Error('Choose a JPEG, PNG or WebP file up to 20 MB. Convert HEIC images to JPEG first.');
    const url = URL.createObjectURL(file);
    let img;
    try { img = await imageElement(url); } finally { URL.revokeObjectURL(url); }
    if (img.naturalWidth * img.naturalHeight > 60000000) throw new Error('Resize the image to 60 megapixels or less.');
    let maxEdge = 1400, quality = .84, dataURL, width, height;
    for (let attempt = 0; attempt < 8; attempt++) {
      const ratio = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      width = Math.max(1, Math.round(img.naturalWidth * ratio)); height = Math.max(1, Math.round(img.naturalHeight * ratio));
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); ctx.drawImage(img, 0, 0, width, height);
      dataURL = canvas.toDataURL('image/jpeg', quality);
      if (dataURL.length <= 1200000) break;
      if (quality > .59) quality -= .09; else maxEdge = Math.round(maxEdge * .8);
    }
    if (!D.image(dataURL, 1200000)) throw new Error('The compressed image is still too large. Crop it and try again.');
    return { originalImage: dataURL, width, height, bitmap: await imageElement(dataURL) };
  }
  function thumbnail(item, scene = session) {
    if (scene.source === 'public-photo-demo') return schematicThumbnail(item);
    const box = item.cropMode === 'bbox' ? D.bbox(item.bbox) : null;
    const [x1, y1, x2, y2] = box || [0, 0, 1000, 1000];
    const sx = x1 / 1000 * scene.width, sy = y1 / 1000 * scene.height, sw = (x2 - x1) / 1000 * scene.width, sh = (y2 - y1) / 1000 * scene.height;
    const scale = Math.min(1, 360 / Math.max(sw, sh)), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale)); canvas.height = Math.max(1, Math.round(sh * scale));
    canvas.getContext('2d').drawImage(scene.bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .76);
  }
  function shell(body, title = 'Photo capture') {
    dialog.innerHTML = `<div class="modal-header"><div><h2 id="scene-title">${esc(title)}</h2></div><button class="close-modal" data-scene-action="close" aria-label="Close photo capture">×</button></div>${body}`;
    if (!dialog.open) { returnFocus = document.activeElement; dialog.showModal(); }
  }
  function updateBackendStatus(next) {
    service = next?.known === true ? next : D.normalizeServiceHealth(null);
    const shortNotice = $('#scene-processing-summary'); if (shortNotice) shortNotice.textContent = captureNotice();
    const notice = $('#scene-service-notice'); if (notice) notice.textContent = D.processingNotice(service);
    const button = $('#scene-select'); if (button) { button.disabled = !service.ready; button.hidden = !service.ready; }
    const manual = $('#scene-manual'); if (manual) manual.classList.toggle('primary', !service.ready);
  }
  const sourceLabel = source => source === 'cloud-ai' ? 'Cloud AI' : source === 'public-photo-demo' ? 'Public photo · Manually annotated' : source === 'preset-demo' ? 'Sample illustration' : 'Local AI';
  function captureNotice() {
    if (!service.ready) return 'Manual entry and the sample photo are available. Automatic recognition needs a connected AI service.';
    return service.remoteProcessing
      ? `${service.provider} processes the photo and may charge for the request. Drafts stay in this browser.`
      : 'Photos are analyzed on this device. Drafts stay in this browser.';
  }
  function openCapture() {
    if (session?.result) { renderReview(); return; }
    shell(`<div class="scene-body"><div class="scene-upload"><div class="scene-camera" aria-hidden="true">▣</div><h3>Add items from a photo</h3><p>Record an item yourself, or use photo recognition to create drafts for review.</p><button type="button" id="scene-select" class="button primary" ${service.ready ? '' : 'hidden disabled'}>Identify items in a photo <span aria-hidden="true">→</span></button><button type="button" id="scene-manual" class="button ${service.ready ? '' : 'primary'}" data-scene-action="add-manual">Add a photo manually</button><input id="scene-file" type="file" accept="image/jpeg,image/png,image/webp" hidden><p class="footnote">JPEG / PNG / WebP · Compressed in your browser</p><p id="scene-processing-summary" class="processing-summary" role="status">${esc(captureNotice())}</p><details class="processing-details"><summary>Recognition service</summary><p id="scene-service-notice">${esc(D.processingNotice(service))}</p><button type="button" class="text-button" data-scene-action="refresh-service">Check connection</button></details></div><div class="scene-start-footer"><span>You can add the owner and sharing terms after saving.</span><button class="text-button" data-scene-action="demo">Try a sample photo →</button></div><div id="scene-error" class="error" role="alert"></div><details class="details"><summary>How photo capture works</summary><div class="details-body"><p>The AI service suggests item names and boundaries. Review each crop, especially overlapping or partially hidden items.</p><p>This browser saves a compressed copy and item thumbnails. Cloud recognition sends the photo to the provider named in the confirmation. Drafts enter the planner after you review them and add them to inventory.</p><p>To use recognition locally, run <code>python3 outputs/local_ai/server.py</code> from the repository root and open <a href="http://127.0.0.1:8765/prototype/">the local workspace</a>. The public sample uses hand-labeled items.</p><button class="text-button" data-scene-action="demo-illustration">Try the illustrated example</button></div></details></div>`);
    $('#scene-select').onclick = () => $('#scene-file').click();
    $('#scene-file').onchange = event => { const file = event.target.files[0]; if (file) processFile(file); };
    hooks.refreshService?.();
  }
  async function processFile(file) {
    if (!service.ready) { notify('Photo recognition is unavailable. Add the photo manually or try a sample.'); return; }
    const token = ++generation;
    shell('<div class="scene-body"><div class="scene-loading"><div class="scene-spinner" aria-hidden="true"></div><h3 id="scene-progress">Compressing photo…</h3><p>The whole frame is preserved. The selected AI service processes the image.</p></div><div id="scene-error" class="error" role="alert"></div></div>');
    try {
      const compressed = await compress(file); if (token !== generation) return;
      session = { ...compressed, result: null, source: null, thumbnails: {}, locationHint: '' };
      if (location.protocol === 'file:' || !service.ready) throw new Error('Connect the recognition service or try the built-in sample.');
      $('#scene-progress').textContent = service.remoteProcessing ? `${service.provider} is identifying items in your photo…` : 'The local model is finding items…';
      controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 240000);
      let response;
      try {
        response = await window.ResourceAI.extract('/api/extract-scene', {image: compressed.originalImage}, service, controller.signal);
        if (!response) {
          session = null;
          openCapture();
          return;
        }
      } finally { clearTimeout(timeout); controller = null; }
      if (token !== generation) return;
      const normalized = D.normalizeResponse(response);
      if (!normalized.source) throw new Error('The service did not return a recognized source. No draft was saved.');
      session.result = normalized;
      session.source = normalized.source;
      for (const item of session.result.items) session.thumbnails[item.id] = thumbnail(item);
      if (dialog.open) renderReview(); else notify('Photo processed. Open photo capture to review the result.');
    } catch (error) {
      if (token !== generation) return;
      if (!dialog.open) { notify('Photo capture interrupted: ' + (error.name === 'AbortError' ? 'Request timed out.' : error.message)); return; }
      shell(`<div class="scene-body">${session?.originalImage ? `<img class="scene-error-photo" src="${session.originalImage}" alt="Original photo awaiting recognition">` : ''}<div class="error" role="alert">${esc(error.name === 'AbortError' ? 'The request timed out. If you used cloud recognition, the provider may have processed the request. Retrying starts a new request.' : error.message)}</div><div class="scene-retry"><button class="button" data-scene-action="restart">Choose a different image</button><button class="button" data-scene-action="demo">Try a sample photo</button></div><p class="footnote">The sample is a public photo with its own annotations. To review items in your own photo, try recognition again or add them manually.</p></div>`);
    }
  }
  function renderReview() {
    const { result } = session;
    const effective = D.effectiveItems(result), mergedCount = result.items.length - effective.length;
    shell(`<form id="scene-review-form"><div class="scene-body"><div class="scene-review-heading"><div><span class="status-pill ${['preset-demo', 'public-photo-demo'].includes(session.source) ? 'amber' : ''}">${session.source === 'preset-demo' ? 'Sample illustration · No call to AI' : session.source === 'public-photo-demo' ? 'Public photo · Manually annotated · No call to AI' : sourceLabel(session.source) + ' · To review'}</span><h3>Review ${effective.length} ${effective.length === 1 ? 'item' : 'items'}</h3><p>${session.source === 'public-photo-demo' ? 'Thumbnails are illustrations. Check them against the original photo and its manually annotated regions.' : 'Select an item to edit its name, category, or crop.'}${mergedCount ? ` <span>${mergedCount} ${mergedCount === 1 ? 'component is' : 'components are'} grouped. You can separate them at any time.</span>` : ""}</p></div><button type="button" class="text-button" data-scene-action="restart">Change photo</button></div><div class="scene-review-layout"><aside><div class="scene-image-wrap"><img src="${session.originalImage}" alt="Full photo and suggested boundaries">${result.items.map((i, n) => i.bbox ? `<div class="scene-box" data-box="${i.id}" style="left:${i.bbox[0] / 10}%;top:${i.bbox[1] / 10}%;width:${(i.bbox[2] - i.bbox[0]) / 10}%;height:${(i.bbox[3] - i.bbox[1]) / 10}%"><span>${n + 1}</span></div>` : '').join('')}</div><div class="field scene-location"><label for="scene-location">Where are these items?<span class="muted"> (optional)</span></label><input id="scene-location" maxlength="120" placeholder="For example, on the living room desk" value="${esc(session.locationHint)}"><small>Add a location hint for later verification.</small></div>${result.sceneNotes.length ? `<details class="details"><summary>Other details to check</summary><div class="details-body">${result.sceneNotes.map(n => `<p>${sampleText(session.source, n)}</p>`).join('')}</div></details>` : ''}<details class="details scene-source"><summary>Processing details</summary><div class="details-body"><p>${esc(result.model)}${result.elapsedSeconds !== null ? ' · ' + esc(result.elapsedSeconds.toFixed(1)) + ' sec' : ''}<br>${esc(sourceLabel(session.source))} · Photo authenticity unverified<br>Original size: ${session.width} × ${session.height}</p>${session.publicPhoto ? publicPhotoCredit(session.publicPhoto) : ''}</div></details></aside><div class="scene-candidates">${effective.length ? effective.map(i => renderCandidate(i, result.items.indexOf(i))).join('') : '<div class="empty-state"><h3>No items available to save</h3><p>Take a closer photo with clear edges and move obstructions if possible.</p></div>'}</div></div><div id="scene-error" class="error" role="alert"></div><details class="details"><summary>How are drafts used?</summary><div class="details-body"><p>Review the owner, condition, sharing rights, and availability before adding a draft to inventory.</p><p>Visible quantity is an estimate. A closer photo can help with hidden items or similar objects.</p><p>Drafts and photos stay in this browser. Download a backup if storage is low.</p></div></details></div><div class="scene-save-bar"><span id="scene-selection-count"></span><div><button type="button" class="button ghost" data-scene-action="download-session">Download backup</button><button type="submit" id="scene-save" class="button primary">Save drafts</button></div></div></form>`);
    $('#scene-review-form').onsubmit = event => { event.preventDefault(); saveSession(); };
    $('#scene-location').oninput = event => { session.locationHint = event.target.value; };
    updateSelected();
  }
  function renderCandidate(item, index) {
    const proposal = session.result.grouping?.proposals.find(p => p.parentId === item.id);
    const grouped = proposal?.applied === true;
    const childNames = proposal?.childIds.map(id => session.result.items.find(i => i.id === id)?.name).join(', ');
    return `<article class="scene-candidate ${item.selected ? '' : 'excluded'}" data-candidate="${item.id}"><label class="scene-select"><input type="checkbox" data-scene-field="selected" data-id="${item.id}" ${item.selected ? 'checked' : ''}><span>${index + 1}</span><span class="visually-hidden">Keep ${esc(item.name)}</span></label><div class="scene-crop"><img id="crop-${item.id}" src="${session.thumbnails[item.id]}" alt="${session.source === 'public-photo-demo' ? 'Illustration' : 'Suggested crop'} of ${esc(item.name)}"></div><div class="scene-candidate-fields"><input aria-label="Item ${index + 1} name" data-scene-field="name" data-id="${item.id}" maxlength="100" required value="${esc(sampleSource(session.source) && !item.nameEdited ? translate(item.name) : item.name)}"><div class="scene-class-quantity"><label>Category<select aria-label="Item ${index + 1} category" data-scene-field="category" data-id="${item.id}">${Object.entries(D.categories).map(([key, label]) => `<option value="${key}" ${item.category === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Visible quantity<input aria-label="Item ${index + 1} visible quantity" data-scene-field="visibleQuantity" data-id="${item.id}" type="number" min="1" max="99" step="1" placeholder="Unknown quantity" value="${item.visibleQuantity ?? ''}"></label></div>${session.source === 'public-photo-demo' ? '<p class="inline-note">Illustrated thumbnail · Original photo retained</p>' : `<label class="scene-keep-original"><input type="checkbox" data-scene-field="original" data-id="${item.id}" ${item.cropMode === 'original' ? 'checked' : ''} ${!item.bbox ? 'disabled' : ''}> Keep full photo</label>`}${proposal ? `<div class="scene-grouping ${grouped ? 'applied' : ''}"><strong>${grouped ? `Grouped components: ${D.groupedComponents(session.result, item.id).length}` : `Possible components: ${proposal.childIds.length}`}</strong><button type="button" class="text-button" data-scene-action="toggle-grouping" data-parent="${item.id}">${grouped ? 'Separate' : 'Group as one item'}</button><details class="grouping-evidence"><summary>Grouping evidence</summary><p>${esc(proposal.evidence)}</p><p>${esc(childNames)}</p><small>Original candidates are retained for review.</small></details></div>` : ''}${item.uncertainties.length || item.visibleText ? `<details class="scene-evidence"><summary>Text and details to verify</summary><div>${item.visibleText ? `<p>Visible text: <span translate="no">${esc(item.visibleText)}</span></p>` : ''}${item.uncertainties.map(s => `<p>${sampleText(session.source, s)}</p>`).join('')}</div></details>` : ''}</div></article>`;
  }
  function updateSelected() {
    const count = (session?.result ? D.effectiveItems(session.result).filter(i => i.selected).length : 0);
    if ($('#scene-selection-count')) $('#scene-selection-count').textContent = `${count} selected for review`;
    if ($('#scene-save')) $('#scene-save').disabled = count === 0;
    if (!session?.result) return;
    for (const i of session.result.items) {
      const card = dialog.querySelector(`[data-candidate="${i.id}"]`); card?.classList.toggle('excluded', !i.selected);
      if (card) card.querySelectorAll('[data-scene-field]:not([data-scene-field="selected"])').forEach(input => { input.disabled = !i.selected || input.dataset.sceneField === 'original' && !i.bbox; });
      const box = dialog.querySelector(`[data-box="${i.id}"]`); if (box) box.hidden = !D.effectiveItems(session.result).includes(i) || !i.selected || i.cropMode === 'original';
    }
  }
  function currentBatch() { return D.createBatch({ result: session.result, originalImage: session.originalImage, width: session.width, height: session.height, locationHint: session.locationHint, source: session.source, thumbnails: session.thumbnails, publicPhoto: session.publicPhoto }); }
  function saveSession() {
    if (!session?.result) return;
    const saveButton = $('#scene-save'); if (saveButton) saveButton.disabled = true;
    try { const batch = currentBatch(); persist(D.append(store, batch)); session = null; dialog.close(); notify(`Saved ${batch.drafts.length} ${batch.drafts.length === 1 ? 'draft' : 'drafts'} for review.`); } catch (error) { $('#scene-error').textContent = error.message; updateSelected(); }
  }
  function renderSection(container = $('#photo-draft-section'), options = {}) {
    if (!container) return;
    if (typeof options.query === 'string') draftQuery = options.query;
    container.innerHTML = `<section class="photo-drafts"><div class="draft-section-head"><p>Review before adding to the planner.</p><details class="draft-tools"><summary>Manage drafts</summary><div><button class="text-button" data-scene-action="export-store">Export drafts</button><button class="text-button" data-scene-action="import-store">Import drafts</button></div></details></div>${readError ? `<div class="error">${esc(readError)} <button class="text-button" data-scene-action="export-raw">Download original backup</button> · <button class="text-button" data-scene-action="reset-corrupt">Back up and restart</button></div>` : ''}<div id="photo-draft-results"></div></section>`;
    renderDraftResults();
  }
  function renderDraftResults() {
    const container = $('#photo-draft-results'); if (!container) return;
    const active = store.drafts.filter(d => d.status === 'draft'), searching = !!draftQuery.trim();
    const matches = D.searchDrafts(store.drafts.map(d => {
      const scene = store.scenes.find(s => s.id === d.sceneId);
      const labels = [translate(D.categories[d.category]), ...(d.components || []).map(c => translate(D.categories[c.category]))];
      if (sampleSource(scene?.source)) labels.push(translate(d.name));
      return {...d, visibleText: [d.visibleText, ...labels].join(' ')};
    }), draftQuery);
    const shown = searching ? matches : expanded ? store.drafts : active.slice(0, 6);
    container.innerHTML = `<p class="draft-results-count" aria-live="polite">${searching ? `Showing ${matches.length} of ${store.drafts.length} drafts` : `${store.drafts.length} ${store.drafts.length === 1 ? 'draft' : 'drafts'} · ${active.length} to review${shown.length < store.drafts.length ? ' · Showing ' + shown.length : ''}`}</p>${shown.length ? `<div class="draft-grid">${shown.map(d => `<article class="draft-card"><div class="draft-card-photo"><img src="${esc(d.thumbnail || store.scenes.find(s => s.id === d.sceneId)?.originalImage)}" alt="${store.scenes.find(s => s.id === d.sceneId)?.source === 'public-photo-demo' ? 'Illustration' : 'Draft photo'} of ${esc(d.name)}"><span>${store.scenes.find(s => s.id === d.sceneId)?.source === 'public-photo-demo' ? 'Illustration · Sample photo' : d.isSynthetic ? 'Built-in sample' : 'Photo draft'}</span></div><div class="draft-card-content"><h3><button class="draft-open" data-scene-action="inspect" data-draft="${esc(d.id)}" aria-label="View details for ${esc(d.name)}">${sampleText(store.scenes.find(s => s.id === d.sceneId)?.source, d.name)}</button></h3><div class="draft-card-meta">${esc(D.categories[d.category])} · ${d.visibleQuantity === null ? 'Visible quantity unknown' : 'Visible: ' + d.visibleQuantity}</div><p class="draft-location-hint">Location hint <span aria-hidden="true">·</span> ${d.locationHint ? `<span translate="no">${esc(d.locationHint)}</span>` : 'Unspecified'}</p><div class="draft-card-footer">${d.status === 'converted' ? '<span class="status-pill gray">Added to demo inventory</span>' : `<button class="text-button" data-scene-action="promote" data-draft="${esc(d.id)}">Complete record</button>`}<button class="draft-delete" data-scene-action="delete" data-draft="${esc(d.id)}" aria-label="Delete the draft for ${esc(d.name)}">×</button></div></div></article>`).join('')}</div>` : searching ? '<div class="draft-search-empty"><h3>No matching drafts</h3><p>Try an item name, category, or location.</p></div>' : '<div class="draft-empty"><span aria-hidden="true">▧</span><h3>No photo drafts yet</h3><p>Add a photo to identify and review the items in it.</p><button class="button" data-scene-action="capture">Add a photo</button></div>'}${!searching && store.drafts.length > shown.length ? `<button class="text-button draft-expand" data-scene-action="expand">View all drafts (${store.drafts.length}), including added items</button>` : ''}`;
  }
  function inspectDraft(id) {
    const d = store.drafts.find(d => d.id === id), s = store.scenes.find(s => s.id === d?.sceneId); if (!d || !s) return;
    shell(`<div class="scene-body"><div class="scene-inspect-layout"><img src="${esc(s.originalImage)}" alt="Original photo of ${esc(d.name)}"><div><div class="draft-detail-heading"><span class="status-pill amber">${s.source === 'public-photo-demo' ? 'Public photo · Manually annotated' : d.isSynthetic ? 'Built-in sample' : 'Unverified photo draft'}</span><h3>${sampleText(s.source, d.name)}</h3><p>${esc(D.categories[d.category])}${d.status === 'converted' ? ' · Added to demo inventory' : ''}</p></div><dl class="draft-detail-facts"><div><dt>Visible quantity</dt><dd>${d.visibleQuantity === null ? 'Unknown' : esc(d.visibleQuantity)}</dd></div><div><dt>Location hint</dt><dd${d.locationHint ? ' translate="no"' : ''}>${esc(d.locationHint || 'Unspecified')}</dd></div><div><dt>Recorded</dt><dd><time data-draft-time datetime="${esc(d.createdAt)}">${esc(new Date(d.createdAt).toLocaleString(window.RCI18n?.language || 'en'))}</time></dd></div></dl><p class="footnote">Check the item's current location and actual quantity before using it.</p>${d.uncertainties.length ? `<div class="draft-detail-checks"><h4>Needs verification</h4><ul>${d.uncertainties.map(text => `<li>${sampleText(s.source, text)}</li>`).join('')}</ul></div>` : ''}<p class="footnote">Verify the owner, availability, and sharing terms before discussing a loan.</p>${d.status === 'draft' ? `<button class="button primary" data-scene-action="promote" data-draft="${esc(d.id)}">Add to demo inventory</button>` : ''}${d.components?.length ? `<details class="details scene-saved-components"><summary>Components (${d.components.length})</summary><div class="details-body">${d.components.map(c => `<p><strong>${esc(c.name)}</strong> <span aria-hidden="true">·</span> ${esc(D.categories[c.category])}<br>${esc(c.evidence)}</p>`).join('')}<button class="button" data-scene-action="split-components" data-draft="${esc(d.id)}">Split into separate drafts</button><p>New drafts retain the original photo, model and timestamp.${d.status === 'converted' ? ' Existing inventory records are kept.' : ''}</p></div></details>` : ''}${d.visibleText || d.sourceText ? `<details class="details"><summary>Text in photo</summary><div class="details-body">${d.visibleText ? `<p>Visible text: <span translate="no">${esc(d.visibleText)}</span></p>` : ''}${d.sourceText ? `<p>Source evidence: <span translate="no">${esc(d.sourceText)}</span></p>` : ''}</div></details>` : ''}<details class="details"><summary>Photo and processing details</summary><div class="details-body"><p>Model: ${esc(d.model)}<br>Processing source: ${esc(sourceLabel(s.source))}${s.provider ? ' · ' + esc(s.provider) : ''}<br>Image origin: ${s.source === 'public-photo-demo' ? 'Public sample photo' : d.isSynthetic ? 'Sample illustration' : 'Camera or synthetic origin unverified'}<br>Bounding box: ${d.bbox ? d.bbox.map(n => Math.round(n)).join(', ') : 'No reliable boundary'}<br>Thumbnail: ${s.source === 'public-photo-demo' ? 'Illustration' : d.cropMode === 'original' ? 'Full photo' : 'Model crop'}</p>${s.publicPhoto ? publicPhotoCredit(s.publicPhoto) : ''}<p>Source metadata accompanies the exported draft.</p></div></details></div></div></div>`, 'Item details');
  }
  async function splitDraftComponents(id) {
    try {
      const next = D.splitComponents(store, id), scene = next.scenes.find(s => s.id === next.drafts.find(d => d.id === id)?.sceneId);
      if (!scene) return;
      const bitmap = await imageElement(scene.originalImage), currentIds = new Set(store.drafts.map(d => d.id));
      for (const d of next.drafts) if (!currentIds.has(d.id)) d.thumbnail = thumbnail(d, { bitmap, width: scene.width, height: scene.height });
      const count = next.drafts.length - store.drafts.length;
      persist(next); inspectDraft(id); notify(count ? `Restored ${count} ${count === 1 ? 'draft' : 'drafts'}. Check the sharing terms and availability.` : 'These components already have separate drafts.');
    } catch (error) { notify(error.message); }
  }
  function deleteDraft(id) {
    const d = store.drafts.find(d => d.id === id); if (!d) return;
    if (!confirmAction(`Delete the “${d.name}” draft${d.components?.length ? ` and the attached components (${d.components.length})` : ''}? Deleting the last draft from a photo also removes that photo from draft storage.`)) return;
    try { persist(D.remove(store, id)); notify('Photo draft deleted.'); } catch (error) { notify(error.message); }
  }
  function promote(id) {
    const d = store.drafts.find(d => d.id === id && d.status === 'draft'), s = store.scenes.find(s => s.id === d?.sceneId); if (!d || !s) return;
    dialog.close();
    hooks.promote?.(D.clone(d), D.clone(s), itemId => {
      const next = D.clone(store), draft = next.drafts.find(x => x.id === id); if (!draft) return;
      draft.status = 'converted'; draft.convertedItemId = itemId;
      try { persist(next); } catch (error) { notify('Inventory saved. The draft status could not be updated: ' + error.message); }
    });
  }
  function publicPhotoCredit(photo) {
    return `<p class="photo-credit">Photo: ${esc(photo.author)} / Pexels<br><a href="${esc(photo.pageUrl)}" target="_blank" rel="noopener noreferrer">Photo source</a> · <a href="${esc(photo.licenseUrl)}" target="_blank" rel="noopener noreferrer">License</a></p>`;
  }
  function schematicThumbnail(item) {
    const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 240;
    const c = canvas.getContext('2d'); c.fillStyle = '#e8eee4'; c.fillRect(0, 0, 360, 240);
    if (item.category === 'electronics') {
      c.fillStyle = '#536764'; c.fillRect(66, 37, 228, 148); c.fillStyle = '#a4c8c3'; c.fillRect(78, 49, 204, 122);
      c.fillStyle = '#6e8079'; c.beginPath(); c.moveTo(66, 185); c.lineTo(294, 185); c.lineTo(321, 212); c.lineTo(39, 212); c.closePath(); c.fill();
    } else if (item.category === 'stationery') {
      c.fillStyle = '#749286'; c.fillRect(110, 22, 143, 195); c.fillStyle = '#f2efdb'; c.fillRect(120, 22, 126, 185); c.fillStyle = '#bf9d5c'; c.fillRect(120, 22, 9, 185);
      c.strokeStyle = '#c8c9b2'; c.lineWidth = 2; for (let y = 57; y < 190; y += 20) { c.beginPath(); c.moveTo(143, y); c.lineTo(228, y); c.stroke(); }
    } else {
      c.strokeStyle = '#749286'; c.lineWidth = 15; c.beginPath(); c.ellipse(259, 117, 31, 37, 0, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#87aeba'; c.fillRect(95, 62, 140, 123); c.beginPath(); c.ellipse(165, 184, 70, 22, 0, 0, Math.PI); c.fill();
      c.fillStyle = '#b5d1d1'; c.beginPath(); c.ellipse(165, 62, 70, 22, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#536764'; c.beginPath(); c.ellipse(165, 62, 57, 13, 0, 0, Math.PI * 2); c.fill();
    }
    return canvas.toDataURL('image/jpeg', .8);
  }
  async function demo() {
    const token = ++generation; controller?.abort(); session = null;
    shell('<div class="scene-body"><p>Loading sample photo…</p></div>', 'Sample photo');
    try {
      const response = await fetch('assets/demo/desk.jpg');
      if (!response.ok) throw new Error('Sample photo unavailable.');
      const compressed = await compress(await response.blob()); if (token !== generation) return;
      const publicPhoto = { author: 'Alan Quirván', pageUrl: 'https://www.pexels.com/photo/laptop-notebooks-and-pens-on-white-desk-14541073/', licenseUrl: 'https://www.pexels.com/license/' };
      const result = D.normalizeResponse({ model: 'Manual annotations. No call to AI', data: { items: [
        { id: 'demo-laptop', name: 'Laptop', category: 'electronics', visibleQuantity: 1, bbox: [620, 0, 1000, 420], uncertainties: ['Part of the laptop is outside the frame. Check its condition and specifications.'] },
        { id: 'demo-notebook', name: 'Purple notebook', category: 'stationery', visibleQuantity: 1, bbox: [420, 305, 580, 655], uncertainties: ['Pages may have been used.'] },
        { id: 'demo-cup', name: 'Cup', category: 'containers', visibleQuantity: 1, bbox: [220, 165, 385, 365], uncertainties: ['Check the contents, capacity, and condition.'] }
      ], sceneNotes: ['This public photo illustrates the workflow. It includes three hand-labeled items.', 'Names, quantities, and boxes were annotated by hand. Thumbnails are illustrations. No AI model was used.'] } });
      session = { ...compressed, result, source: 'public-photo-demo', publicPhoto, thumbnails: {}, locationHint: '' };
      for (const item of result.items) session.thumbnails[item.id] = thumbnail(item);
      if (dialog.open) renderReview(); else notify('Sample ready. Open photo capture to review.');
    } catch (error) {
      if (token !== generation) return;
      shell(`<div class="scene-body"><p class="error">${esc(error.message)} Open the page using a web server to load the sample.</p><button class="button" data-scene-action="demo">Reload sample</button><button class="text-button" data-scene-action="demo-illustration">Try the illustrated example</button></div>`, 'Sample photo');
    }
  }
  async function illustrationDemo() {
    ++generation; controller?.abort();
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
    const c = canvas.getContext('2d'); c.fillStyle = '#e8eee4'; c.fillRect(0, 0, 1200, 800); c.fillStyle = '#d4bfa0'; c.fillRect(0, 120, 1200, 680);
    // Fixed illustration: complete objects, not fabricated recognition results.
    c.fillStyle = '#536764'; c.fillRect(90, 180, 400, 270); c.fillStyle = '#a4c8c3'; c.fillRect(110, 200, 360, 225); c.fillStyle = '#6e8079'; c.beginPath(); c.moveTo(90, 450); c.lineTo(490, 450); c.lineTo(540, 520); c.lineTo(45, 520); c.closePath(); c.fill();
    c.fillStyle = '#749286'; c.fillRect(650, 190, 200, 270); c.fillStyle = '#f2efdb'; c.fillRect(665, 190, 180, 260); c.fillStyle = '#bf9d5c'; c.fillRect(665, 190, 12, 260); c.strokeStyle = '#c8c9b2'; c.lineWidth = 2; for (let y = 235; y < 420; y += 25) { c.beginPath(); c.moveTo(700, y); c.lineTo(815, y); c.stroke(); }
    c.fillStyle = '#87aeba'; c.fillRect(980, 225, 90, 200); c.fillStyle = '#607e86'; c.fillRect(995, 190, 60, 40); c.fillStyle = '#b5d1d1'; c.fillRect(990, 250, 70, 115);
    c.strokeStyle = '#6c7d78'; c.lineWidth = 14; c.beginPath(); c.moveTo(220, 610); c.lineTo(370, 700); c.moveTo(220, 690); c.lineTo(370, 600); c.stroke(); c.strokeStyle = '#bd765c'; c.lineWidth = 16; for (const [x, y] of [[180, 600], [180, 700]]) { c.beginPath(); c.ellipse(x, y, 40, 26, 0, 0, Math.PI * 2); c.stroke(); }
    c.fillStyle = '#b68a5e'; c.fillRect(650, 560, 350, 175); c.fillStyle = '#d7b785'; c.fillRect(635, 545, 380, 40); c.fillStyle = '#f0dfb9'; c.fillRect(765, 620, 100, 40);
    c.fillStyle = '#f5f2e9'; c.font = '18px sans-serif'; c.fillText(translate('Sample illustration · No call to AI'), 35, 55);
    const originalImage = canvas.toDataURL('image/jpeg', .84);
    const result = D.normalizeResponse({ model: 'Annotated sample', data: { items: [
      { name: 'Laptop', category: 'electronics', visibleQuantity: 1, bbox: [35, 220, 455, 655], uncertainties: ['Screen, keyboard, and housing are parts of the same unit. Check its condition.'] },
      { name: 'Notebook', category: 'stationery', visibleQuantity: 1, bbox: [535, 230, 715, 580], uncertainties: [] },
      { name: 'Drinking cup', category: 'containers', visibleQuantity: 1, bbox: [810, 230, 900, 540], uncertainties: ['Contents unknown.'] },
      { name: 'Scissors', category: 'tools', visibleQuantity: 1, bbox: [105, 710, 320, 925], uncertainties: [] },
      { name: 'Storage box', category: 'containers', visibleQuantity: 1, bbox: [525, 675, 850, 930], uncertainties: ['The box is closed. Check its contents in person.'] }
    ], sceneNotes: ['This sample illustration has preset boxes and cards. Uploaded photos are processed by the AI service.'] } });
    session = { originalImage, width: 1200, height: 800, bitmap: await imageElement(originalImage), result, source: 'preset-demo', thumbnails: {}, locationHint: '' };
    for (const item of result.items) session.thumbnails[item.id] = thumbnail(item);
    renderReview();
  }
  document.addEventListener('click', event => {
    const el = event.target.closest('[data-scene-action]'); if (!el) return;
    const action = el.dataset.sceneAction;
    if (action === 'capture') openCapture();
    else if (action === 'add-manual') { dialog.close(); hooks.addManual?.(); }
    else if (action === 'refresh-service') hooks.refreshService?.();
    else if (action === 'close') dialog.close();
    else if (action === 'demo') demo();
    else if (action === 'demo-illustration') illustrationDemo();
    else if (action === 'restart') { ++generation; controller?.abort(); session = null; openCapture(); }
    else if (action === 'expand') { expanded = true; renderSection(); }
    else if (action === 'inspect') inspectDraft(el.dataset.draft);
    else if (action === 'split-components') splitDraftComponents(el.dataset.draft);
    else if (action === 'toggle-grouping' && session?.result) { const proposal = session.result.grouping?.proposals.find(p => p.parentId === el.dataset.parent); if (proposal) { D.setGrouping(session.result, proposal.parentId, !proposal.applied); renderReview(); } }
    else if (action === 'delete') deleteDraft(el.dataset.draft);
    else if (action === 'promote') promote(el.dataset.draft);
    else if (action === 'export-store') { try { download('Resource Commons-Photo drafts-v1.json', D.serialize(store)); } catch (error) { notify(error.message); } }
    else if (action === 'export-raw') download('Resource Commons-Photo drafts-Original backup.json', rawBackup);
    else if (action === 'reset-corrupt' && confirmAction('Download the original backup first. Clear unreadable drafts and start over?')) { readError = ''; try { persist(D.emptyStore()); } catch (error) { notify(error.message); } }
    else if (action === 'import-store') importInput.click();
    else if (action === 'download-session') { try { download('Resource Commons-Photo draft batch.json', D.serialize(D.append(D.emptyStore(), currentBatch()))); } catch (error) { $('#scene-error').textContent = error.message; } }
  });
  dialog.addEventListener('close', () => { if (returnFocus?.isConnected) returnFocus.focus(); else $('[data-scene-action="capture"]')?.focus(); });
  dialog.addEventListener('input', event => {
    const field = event.target.dataset.sceneField; if (!field || !session?.result) return;
    const item = session.result.items.find(i => i.id === event.target.dataset.id); if (!item) return;
    if (field === 'selected') item.selected = event.target.checked;
    else if (field === 'original') { item.cropMode = event.target.checked ? 'original' : 'bbox'; session.thumbnails[item.id] = thumbnail(item); $('#crop-' + item.id).src = session.thumbnails[item.id]; }
    else if (field === 'visibleQuantity') item.visibleQuantity = event.target.value === '' ? null : Number(event.target.value);
    else if (field === 'name' || field === 'category') {
      item[field] = event.target.value;
      if (field === 'name') item.nameEdited = true;
    }
    updateSelected();
  });
  importInput.onchange = async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    try {
      if (file.size > D.MAX_STORE_BYTES) throw new Error('Draft file exceeds 3.8 MB. Import stopped.');
      const incoming = D.parse(await file.text());
      for (const scene of incoming.scenes) {
        const bitmap = await imageElement(scene.originalImage);
        if (bitmap.naturalWidth !== scene.width || bitmap.naturalHeight !== scene.height) throw new Error('The draft image dimensions differ from its record. Import stopped.');
      }
      for (const draft of incoming.drafts) if (draft.thumbnail) {
        const bitmap = await imageElement(draft.thumbnail);
        if (bitmap.naturalWidth > 1000 || bitmap.naturalHeight > 1000) throw new Error('Invalid thumbnail dimensions. Import stopped.');
      }
      if (!confirmAction(`Replace the current drafts with ${incoming.drafts.length} from the imported file?`)) return;
      persist(incoming); notify('Photo drafts imported.');
    } catch (error) { notify('Import failed: ' + error.message); }
  };
  window.addEventListener?.('rc-language-change', () => {
    for (const label of dialog.querySelectorAll('[data-draft-time]')) {
      label.textContent = new Date(label.dateTime).toLocaleString(window.RCI18n.language);
    }
    if (!session?.result || !sampleSource(session.source)) return;
    for (const input of dialog.querySelectorAll('[data-scene-field="name"]')) {
      const item = session.result.items.find(i => i.id === input.dataset.id);
      if (item && !item.nameEdited) input.value = translate(item.name);
    }
  });
  async function preparePhoto(file) {
    const photo = await compress(file);
    return photo.originalImage;
  }
  window.PhotoDraftUI = { preparePhoto, initialize(options) { hooks = options || {}; renderSection(); }, renderSection, openCapture, updateBackendStatus, setQuery(query) { draftQuery = query; renderDraftResults(); }, summary() { return { total: store.drafts.length, pending: store.drafts.filter(d => d.status === 'draft').length }; } };
})();
