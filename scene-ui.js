(() => {
  'use strict';
  const D = window.PhotoDraftData;
  if (!D) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = selector => document.querySelector(selector);
  let service = D.normalizeServiceHealth(null);
  let hooks = {}, store = D.emptyStore(), rawBackup = '', readError = '', session = null, controller = null, generation = 0, expanded = false, draftQuery = '', returnFocus = null;
  try { rawBackup = localStorage.getItem(D.STORAGE_KEY) || ''; if (rawBackup) store = D.parse(rawBackup); } catch (error) { readError = '已有照片草稿暂时无法读取，原始数据已保留。'; }
  const dialog = document.createElement('dialog');
  dialog.id = 'scene-dialog'; dialog.className = 'scene-dialog'; dialog.setAttribute('aria-labelledby', 'scene-title'); document.body.appendChild(dialog);
  const importInput = document.createElement('input'); importInput.type = 'file'; importInput.accept = '.json,application/json'; importInput.hidden = true; document.body.appendChild(importInput);
  function notify(text) { if (hooks.notify) hooks.notify(text); }
  function download(name, text) { const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function persist(next) {
    if (readError) throw new Error('请先备份并处理无法读取的旧草稿，避免覆盖原数据。');
    const text = D.serialize(next);
    try { localStorage.setItem(D.STORAGE_KEY, text); } catch (error) { throw new Error('浏览器本地空间不足，未覆盖任何已存记录。可下载本次草稿后再清理旧数据。'); }
    store = next; rawBackup = text; renderSection(); hooks.changed?.();
  }
  function imageElement(dataURL) { return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('无法读取这张图片，请换用 JPEG、PNG 或 WebP。')); img.src = dataURL; }); }
  async function compress(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20000000) throw new Error('请选择不超过 20 MB 的 JPEG、PNG 或 WebP 照片。HEIC 请先转为 JPEG。');
    const url = URL.createObjectURL(file);
    let img;
    try { img = await imageElement(url); } finally { URL.revokeObjectURL(url); }
    if (img.naturalWidth * img.naturalHeight > 60000000) throw new Error('图片尺寸过大，请先缩小到 6000 万像素以内。');
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
    if (!D.image(dataURL, 1200000)) throw new Error('压缩后照片仍过大，请裁去无关区域后重试。');
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
  function shell(body, title = '拍照整理') {
    dialog.innerHTML = `<div class="modal-header"><div><h2 id="scene-title">${esc(title)}</h2></div><button class="close-modal" data-scene-action="close" aria-label="关闭照片整理">×</button></div>${body}`;
    if (!dialog.open) { returnFocus = document.activeElement; dialog.showModal(); }
  }
  function updateBackendStatus(next) {
    service = next?.known === true ? next : D.normalizeServiceHealth(null);
    const shortNotice = $('#scene-processing-summary'); if (shortNotice) shortNotice.textContent = service.remoteProcessing ? '照片会发送至 OpenAI 分析，可能产生 API 费用。记录保存在此浏览器。' : service.known ? (service.ready ? '照片在本机分析，记录保存在此浏览器。' : '本地 AI 未就绪，暂不发送照片。') : 'AI 连接状态未确认，暂不发送照片。';
    const notice = $('#scene-service-notice'); if (notice) notice.textContent = D.processingNotice(service);
    const button = $('#scene-select'); if (button) button.disabled = !service.ready;
  }
  const sourceLabel = source => source === 'cloud-ai' ? '云端 AI' : source === 'public-photo-demo' ? '公开照片 · 人工预置' : source === 'preset-demo' ? '预置插画' : '本地 AI';
  function openCapture() {
    if (session?.result) { renderReview(); return; }
    shell(`<div class="scene-body"><div class="scene-upload"><div class="scene-camera" aria-hidden="true">▣</div><h3>从照片添加物品</h3><p>选择照片后自动识别，核对后保存为草稿。</p><button type="button" id="scene-select" class="button primary" ${service.ready ? '' : 'disabled'}>选择照片，开始整理 <span aria-hidden="true">→</span></button><input id="scene-file" type="file" accept="image/jpeg,image/png,image/webp" hidden><p class="footnote">JPEG / PNG / WebP · 在浏览器中自动压缩</p><p id="scene-processing-summary" class="processing-summary" role="status">${esc(service.remoteProcessing ? '照片会发送至 OpenAI 分析，可能产生 API 费用。记录保存在此浏览器。' : service.known ? '照片在本机分析，记录保存在此浏览器。' : 'AI 连接状态未确认，暂不发送照片。')}</p><details class="processing-details"><summary>处理方式与连接状态</summary><p id="scene-service-notice">${esc(D.processingNotice(service))}</p><button type="button" class="text-button" data-scene-action="refresh-service">重新检查连接</button></details></div><div class="scene-start-footer"><span>负责人和共享条件可在保存后补充。</span><button class="text-button" data-scene-action="demo">查看照片示例 →</button></div><div id="scene-error" class="error" role="alert"></div><details class="details"><summary>这一步会做什么？</summary><div class="details-body"><p>当前 AI 服务给出物品边界与名称建议，裁切缩略图后生成草稿。遮挡、数量或框选可能出错；没有输出未经校准的概率。</p><p>浏览器保存压缩后的整张照片与裁切图，原相机文件不修改。云模式的图片及必要的局部裁切会另发送 OpenAI 做推理。草稿独立保存，不会进入资源匹配，也不会默认可用或可借。</p><p>AI 服务需通过 outputs 中的“启动原型.command”启动。当前页面会显示真实处理模式；未确认服务前不上传。照片示例使用公开素材与人工预置候选，不调用 AI。</p><button class="text-button" data-scene-action="demo-illustration">查看旧版插画示例</button></div></details></div>`);
    $('#scene-select').onclick = () => $('#scene-file').click();
    $('#scene-file').onchange = event => { const file = event.target.files[0]; if (file) processFile(file); };
    hooks.refreshService?.();
  }
  async function processFile(file) {
    if (!service.ready) { notify('AI 服务尚未就绪，未发送照片。请先检查服务状态。'); return; }
    const token = ++generation;
    shell('<div class="scene-body"><div class="scene-loading"><div class="scene-spinner" aria-hidden="true"></div><h3 id="scene-progress">正在压缩照片…</h3><p>保留整张画面，按页面标明的 AI 服务处理。</p></div><div id="scene-error" class="error" role="alert"></div></div>');
    try {
      const compressed = await compress(file); if (token !== generation) return;
      session = { ...compressed, result: null, source: null, thumbnails: {}, locationHint: '' };
      if (location.protocol === 'file:' || !service.ready) throw new Error('AI 服务状态尚未确认，未发送照片。请启动服务或先看预置示例。');
      $('#scene-progress').textContent = service.remoteProcessing ? 'OpenAI 正在分析照片里的物品…' : '本机模型正在找出照片里的物品…';
      controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 240000);
      let response;
      try {
        const http = await fetch('/api/extract-scene', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: compressed.originalImage }), signal: controller.signal });
        const result = await http.json(); if (!http.ok) throw new Error(typeof result.error === 'string' ? result.error : 'AI 服务处理失败，请检查页面状态或稍后重试。'); response = result;
      } finally { clearTimeout(timeout); controller = null; }
      if (token !== generation) return;
      const normalized = D.normalizeResponse(response);
      if (!normalized.source) throw new Error('服务未返回可确认的处理来源，本次结果未保存。');
      session.result = normalized;
      session.source = normalized.source;
      for (const item of session.result.items) session.thumbnails[item.id] = thumbnail(item);
      if (dialog.open) renderReview(); else notify('照片分析完成，可从拍照入口继续核对。');
    } catch (error) {
      if (token !== generation) return;
      if (!dialog.open) { notify('照片整理未完成：' + (error.name === 'AbortError' ? '处理超时。' : error.message)); return; }
      shell(`<div class="scene-body">${session?.originalImage ? `<img class="scene-error-photo" src="${session.originalImage}" alt="尚未完成识别的整张照片">` : ''}<div class="error" role="alert">${esc(error.name === 'AbortError' ? 'AI 服务处理超时，尚未保存任何草稿。云端请求可能已产生费用；重试会发起新请求。' : error.message)}</div><div class="scene-retry"><button class="button" data-scene-action="restart">重新选图</button><button class="button" data-scene-action="demo">查看照片示例</button></div><p class="footnote">照片示例是公开素材，不是这张上传照片的 AI 结果。</p></div>`);
    }
  }
  function renderReview() {
    const { result } = session;
    const effective = D.effectiveItems(result), mergedCount = result.items.length - effective.length;
    shell(`<form id="scene-review-form"><div class="scene-body"><div class="scene-review-heading"><div><span class="status-pill ${['preset-demo', 'public-photo-demo'].includes(session.source) ? 'amber' : ''}">${session.source === 'preset-demo' ? '预置插画 · 未调用 AI' : session.source === 'public-photo-demo' ? '公开照片 · 人工预置 · 未调用 AI' : sourceLabel(session.source) + ' · 待核对'}</span><h3>核对 ${effective.length} 件物品</h3><p>${session.source === 'public-photo-demo' ? '小图使用示意图，可对照原始照片核对。候选与框选由人工预置。' : '名称、分类或裁切不准时，点开修改。'}${mergedCount ? `已收起 ${mergedCount} 项部件，随时可拆开。` : ""}</p></div><button type="button" class="text-button" data-scene-action="restart">换一张照片</button></div><div class="scene-review-layout"><aside><div class="scene-image-wrap"><img src="${session.originalImage}" alt="本次整张照片与候选边界">${result.items.map((i, n) => i.bbox ? `<div class="scene-box" data-box="${i.id}" style="left:${i.bbox[0] / 10}%;top:${i.bbox[1] / 10}%;width:${(i.bbox[2] - i.bbox[0]) / 10}%;height:${(i.bbox[3] - i.bbox[1]) / 10}%"><span>${n + 1}</span></div>` : '').join('')}</div><div class="field scene-location"><label for="scene-location">这批物品大概在哪里？<span class="muted">（选填）</span></label><input id="scene-location" maxlength="120" placeholder="例如：客厅书桌；以后也能补" value="${esc(session.locationHint)}"><small>只是地点提示，不会改写已确认的位置。</small></div>${result.sceneNotes.length ? `<details class="details"><summary>画面中还需要留意什么？</summary><div class="details-body">${result.sceneNotes.map(n => `<p>${esc(n)}</p>`).join('')}</div></details>` : ''}<details class="details scene-source"><summary>照片处理记录</summary><div class="details-body"><p>${esc(result.model)}${result.elapsedSeconds !== null ? ' · ' + esc(result.elapsedSeconds.toFixed(1)) + ' 秒' : ''}<br>${esc(sourceLabel(session.source))} · 图像是否实拍尚未核实<br>原图尺寸：${session.width} × ${session.height}</p>${session.publicPhoto ? publicPhotoCredit(session.publicPhoto) : ''}</div></details></aside><div class="scene-candidates">${effective.length ? effective.map(i => renderCandidate(i, result.items.indexOf(i))).join('') : '<div class="empty-state"><h3>这张图还没有可保存的候选</h3><p>靠近一点拍摄，让物品边缘更清楚；可把遮挡物移开后补拍。</p></div>'}</div></div><div id="scene-error" class="error" role="alert"></div><details class="details"><summary>草稿与已确认库存有什么区别？</summary><div class="details-body"><p>这些是未核实的记录。所有者、状态、共享许可和可借时段均保持未知；草稿不会进入资源匹配或被计入已保障。</p><p>可见数量并非盘点数量。低清晰度、遮挡和相似物品可能导致漏识别；可保留整图，之后再补拍。</p><p>图片与记录存在当前浏览器。空间不足时本次保存会停止，可先下载本次草稿，避免丢失。</p></div></details></div><div class="scene-save-bar"><span id="scene-selection-count"></span><div><button type="button" class="button ghost" data-scene-action="download-session">下载备份</button><button type="submit" id="scene-save" class="button primary">保存草稿</button></div></div></form>`);
    $('#scene-review-form').onsubmit = event => { event.preventDefault(); saveSession(); };
    $('#scene-location').oninput = event => { session.locationHint = event.target.value; };
    updateSelected();
  }
  function renderCandidate(item, index) {
    const proposal = session.result.grouping?.proposals.find(p => p.parentId === item.id);
    const grouped = proposal?.applied === true;
    const childNames = proposal?.childIds.map(id => session.result.items.find(i => i.id === id)?.name).join('、');
    return `<article class="scene-candidate ${item.selected ? '' : 'excluded'}" data-candidate="${item.id}"><label class="scene-select"><input type="checkbox" data-scene-field="selected" data-id="${item.id}" ${item.selected ? 'checked' : ''}><span>${index + 1}</span><span class="visually-hidden">保留${esc(item.name)}</span></label><div class="scene-crop"><img id="crop-${item.id}" src="${session.thumbnails[item.id]}" alt="${esc(item.name)}的${session.source === 'public-photo-demo' ? '示意图' : '候选裁切'}"></div><div class="scene-candidate-fields"><input aria-label="候选${index + 1}名称" data-scene-field="name" data-id="${item.id}" maxlength="100" required value="${esc(item.name)}"><div class="scene-class-quantity"><label>分类<select aria-label="候选${index + 1}类别" data-scene-field="category" data-id="${item.id}">${Object.entries(D.categories).map(([key, label]) => `<option value="${key}" ${item.category === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>可见数量<input aria-label="候选${index + 1}可见数量" data-scene-field="visibleQuantity" data-id="${item.id}" type="number" min="1" max="99" step="1" placeholder="数量未知" value="${item.visibleQuantity ?? ''}"></label></div>${session.source === 'public-photo-demo' ? '<p class="inline-note">示意小图 · 原始照片已保留</p>' : `<label class="scene-keep-original"><input type="checkbox" data-scene-field="original" data-id="${item.id}" ${item.cropMode === 'original' ? 'checked' : ''} ${!item.bbox ? 'disabled' : ''}> 框不准，保留整张图</label>`}${proposal ? `<div class="scene-grouping ${grouped ? 'applied' : ''}"><strong>${grouped ? `含 ${D.groupedComponents(session.result, item.id).length} 项部件` : `${proposal.childIds.length} 项可能属于这件物品`}</strong><button type="button" class="text-button" data-scene-action="toggle-grouping" data-parent="${item.id}">${grouped ? '拆开记录' : '合为一件'}</button><details class="grouping-evidence"><summary>分组依据</summary><p>${esc(proposal.evidence)}</p><p>${esc(childNames)}</p><small>源候选完整保留，分组不代表已核实。</small></details></div>` : ''}${item.uncertainties.length || item.visibleText ? `<details class="scene-evidence"><summary>待核实与文字线索</summary><div>${item.visibleText ? `<p>可见文字：${esc(item.visibleText)}</p>` : ''}${item.uncertainties.map(s => `<p>${esc(s)}</p>`).join('')}</div></details>` : ''}</div></article>`;
  }
  function updateSelected() {
    const count = (session?.result ? D.effectiveItems(session.result).filter(i => i.selected).length : 0);
    if ($('#scene-selection-count')) $('#scene-selection-count').textContent = `已选 ${count} 件 · 保存为待核实草稿`;
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
    try { const batch = currentBatch(); persist(D.append(store, batch)); session = null; dialog.close(); notify(`已保存 ${batch.drafts.length} 个照片草稿；未加入匹配库存。`); } catch (error) { $('#scene-error').textContent = error.message; updateSelected(); }
  }
  function renderSection(container = $('#photo-draft-section'), options = {}) {
    if (!container) return;
    if (typeof options.query === 'string') draftQuery = options.query;
    container.innerHTML = `<section class="photo-drafts"><div class="draft-section-head"><p>待核实，不参与资源匹配。</p><details class="draft-tools"><summary>草稿管理</summary><div><button class="text-button" data-scene-action="export-store">导出草稿</button><button class="text-button" data-scene-action="import-store">导入草稿</button></div></details></div>${readError ? `<div class="error">${esc(readError)} <button class="text-button" data-scene-action="export-raw">下载原始备份</button> · <button class="text-button" data-scene-action="reset-corrupt">备份后重新开始</button></div>` : ''}<div id="photo-draft-results"></div></section>`;
    renderDraftResults();
  }
  function renderDraftResults() {
    const container = $('#photo-draft-results'); if (!container) return;
    const active = store.drafts.filter(d => d.status === 'draft'), searching = !!draftQuery.trim();
    const matches = D.searchDrafts(store.drafts, draftQuery);
    const shown = searching ? matches : expanded ? store.drafts : active.slice(0, 6);
    container.innerHTML = `<p class="draft-results-count" aria-live="polite">${searching ? `找到 ${matches.length} 条 · 共 ${store.drafts.length} 条照片草稿` : `共 ${store.drafts.length} 条 · ${active.length} 条待补全${shown.length < store.drafts.length ? ' · 当前显示 ' + shown.length + ' 条' : ''}`}</p>${shown.length ? `<div class="draft-grid">${shown.map(d => `<article class="draft-card"><div class="draft-card-photo"><img src="${esc(d.thumbnail || store.scenes.find(s => s.id === d.sceneId)?.originalImage)}" alt="${esc(d.name)}${store.scenes.find(s => s.id === d.sceneId)?.source === 'public-photo-demo' ? '示意图' : '草稿照片'}"><span>${store.scenes.find(s => s.id === d.sceneId)?.source === 'public-photo-demo' ? '示意图 · 照片示例' : d.isSynthetic ? '预置示例' : '照片草稿'}</span></div><div class="draft-card-content"><h3><button class="draft-open" data-scene-action="inspect" data-draft="${esc(d.id)}" aria-label="查看${esc(d.name)}详情">${esc(d.name)}</button></h3><div class="draft-card-meta">${esc(D.categories[d.category])} · ${d.visibleQuantity === null ? '可见数量未知' : '画面可见 ' + d.visibleQuantity}</div><p class="draft-location-hint">地点提示 · ${esc(d.locationHint || '未填写')}</p><div class="draft-card-footer">${d.status === 'converted' ? '<span class="status-pill gray">已转为模拟库存</span>' : `<button class="text-button" data-scene-action="promote" data-draft="${esc(d.id)}">补全记录</button>`}<button class="draft-delete" data-scene-action="delete" data-draft="${esc(d.id)}" aria-label="删除${esc(d.name)}草稿">×</button></div></div></article>`).join('')}</div>` : searching ? '<div class="draft-search-empty"><h3>没有匹配的照片草稿</h3><p>试试物品名称、类别或地点。</p></div>' : '<div class="draft-empty"><span aria-hidden="true">▧</span><h3>还没有照片草稿</h3><p>添加一张照片，识别其中的物品。</p><button class="button" data-scene-action="capture">拍照添加</button></div>'}${!searching && store.drafts.length > shown.length ? `<button class="text-button draft-expand" data-scene-action="expand">查看全部 ${store.drafts.length} 条（含已转库存）</button>` : ''}`;
  }
  function inspectDraft(id) {
    const d = store.drafts.find(d => d.id === id), s = store.scenes.find(s => s.id === d?.sceneId); if (!d || !s) return;
    shell(`<div class="scene-body"><div class="scene-inspect-layout"><img src="${esc(s.originalImage)}" alt="${esc(d.name)}来源整张照片"><div><div class="draft-detail-heading"><span class="status-pill amber">${s.source === 'public-photo-demo' ? '公开照片 · 人工预置' : d.isSynthetic ? '预置示例' : '未核实照片草稿'}</span><h3>${esc(d.name)}</h3><p>${esc(D.categories[d.category])}${d.status === 'converted' ? ' · 已转为模拟库存' : ''}</p></div><dl class="draft-detail-facts"><div><dt>画面可见</dt><dd>${d.visibleQuantity === null ? '数量未知' : esc(d.visibleQuantity) + ' 件'}</dd></div><div><dt>地点提示</dt><dd>${esc(d.locationHint || '未填写')}</dd></div><div><dt>记录时间</dt><dd>${esc(new Date(d.createdAt).toLocaleString('zh-CN'))}</dd></div></dl><p class="footnote">地点提示尚未确认为物品当前位置；可见数量不是库存数量。</p>${d.uncertainties.length ? `<div class="draft-detail-checks"><h4>待核实</h4><ul>${d.uncertainties.map(text => `<li>${esc(text)}</li>`).join('')}</ul></div>` : ''}<p class="footnote">此草稿中的负责人、可用状态和共享许可均未知，不能作为借用批准。</p>${d.status === 'draft' ? `<button class="button primary" data-scene-action="promote" data-draft="${esc(d.id)}">补全为模拟库存</button>` : ''}${d.components?.length ? `<details class="details scene-saved-components"><summary>部件候选 · ${d.components.length} 项</summary><div class="details-body">${d.components.map(c => `<p><strong>${esc(c.name)}</strong> · ${esc(D.categories[c.category])}<br>${esc(c.evidence)}</p>`).join('')}<button class="button" data-scene-action="split-components" data-draft="${esc(d.id)}">拆回独立草稿</button><p>拆出的记录仍待核实，保留原照片、模型和记录时间${d.status === 'converted' ? '；已转换的模拟库存不受影响' : ''}。</p></div></details>` : ''}${d.visibleText || d.sourceText ? `<details class="details"><summary>照片中的文字</summary><div class="details-body">${d.visibleText ? `<p>可见文字：${esc(d.visibleText)}</p>` : ''}${d.sourceText ? `<p>原文线索：${esc(d.sourceText)}</p>` : ''}</div></details>` : ''}<details class="details"><summary>照片来源与处理记录</summary><div class="details-body"><p>模型：${esc(d.model)}<br>处理来源：${esc(sourceLabel(s.source))}${s.provider ? ' · ' + esc(s.provider) : ''}<br>图像性质：${s.source === 'public-photo-demo' ? '公开素材照片；不是真实用户库存' : d.isSynthetic ? '预置插画' : '是否实拍或合成尚未核实'}<br>框选坐标：${d.bbox ? d.bbox.map(n => Math.round(n)).join(', ') : '没有可靠边界'}<br>缩略图：${s.source === 'public-photo-demo' ? '示意图，非照片裁切' : d.cropMode === 'original' ? '保留整张图' : '按模型框选裁切'}</p>${s.publicPhoto ? publicPhotoCredit(s.publicPhoto) : ''}<p>来源标记随草稿导出导入，不是身份或实拍真实性认证。</p></div></details></div></div></div>`, '物品详情');
  }
  async function splitDraftComponents(id) {
    try {
      const next = D.splitComponents(store, id), scene = next.scenes.find(s => s.id === next.drafts.find(d => d.id === id)?.sceneId);
      if (!scene) return;
      const bitmap = await imageElement(scene.originalImage), currentIds = new Set(store.drafts.map(d => d.id));
      for (const d of next.drafts) if (!currentIds.has(d.id)) d.thumbnail = thumbnail(d, { bitmap, width: scene.width, height: scene.height });
      const count = next.drafts.length - store.drafts.length;
      persist(next); inspectDraft(id); notify(count ? `已拆回 ${count} 个独立照片草稿；共享与可用状态仍待确认。` : '这些部件已拆回，没有重复添加。');
    } catch (error) { notify(error.message); }
  }
  function deleteDraft(id) {
    const d = store.drafts.find(d => d.id === id); if (!d) return;
    if (!window.confirm(`删除“${d.name}”照片草稿${d.components?.length ? `及其中 ${d.components.length} 项部件候选` : ''}？若是这张照片最后一条草稿，整张图也会一并移除。已转入的模拟库存不受影响。`)) return;
    try { persist(D.remove(store, id)); notify('照片草稿已删除。'); } catch (error) { notify(error.message); }
  }
  function promote(id) {
    const d = store.drafts.find(d => d.id === id && d.status === 'draft'), s = store.scenes.find(s => s.id === d?.sceneId); if (!d || !s) return;
    dialog.close();
    hooks.promote?.(D.clone(d), D.clone(s), itemId => {
      const next = D.clone(store), draft = next.drafts.find(x => x.id === id); if (!draft) return;
      draft.status = 'converted'; draft.convertedItemId = itemId;
      try { persist(next); } catch (error) { notify('模拟库存已保存，但草稿标记未更新：' + error.message); }
    });
  }
  function publicPhotoCredit(photo) {
    return `<p class="photo-credit">照片：${esc(photo.author)} / Pexels<br><a href="${esc(photo.pageUrl)}" target="_blank" rel="noopener noreferrer">查看照片来源</a> · <a href="${esc(photo.licenseUrl)}" target="_blank" rel="noopener noreferrer">使用许可</a></p>`;
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
    shell('<div class="scene-body"><p>正在加载照片示例…</p></div>', '照片示例');
    try {
      const response = await fetch('assets/demo/desk.jpg');
      if (!response.ok) throw new Error('照片文件暂时无法读取。');
      const compressed = await compress(await response.blob()); if (token !== generation) return;
      const publicPhoto = { author: 'Alan Quirván', pageUrl: 'https://www.pexels.com/photo/laptop-notebooks-and-pens-on-white-desk-14541073/', licenseUrl: 'https://www.pexels.com/license/' };
      const result = D.normalizeResponse({ model: '人工预置候选，未调用 AI', data: { items: [
        { id: 'demo-laptop', name: '笔记本电脑', category: 'electronics', visibleQuantity: 1, bbox: [620, 0, 1000, 420], uncertainties: ['电脑部分超出画面，功能与配置未知。'] },
        { id: 'demo-notebook', name: '紫色笔记本', category: 'stationery', visibleQuantity: 1, bbox: [420, 305, 580, 655], uncertainties: ['内页是否使用过未知。'] },
        { id: 'demo-cup', name: '杯子', category: 'containers', visibleQuantity: 1, bbox: [220, 165, 385, 365], uncertainties: ['杯内液体性质、杯子容量与可用状态未核实。'] }
      ], sceneNotes: ['公开素材照片用于演示操作，不是真实用户库存。这里只预置了 3 件物品，不代表完整识别结果。', '候选名称、数量及边界由人工目视标注；小图为示意图，未调用任何 AI 模型。'] } });
      session = { ...compressed, result, source: 'public-photo-demo', publicPhoto, thumbnails: {}, locationHint: '' };
      for (const item of result.items) session.thumbnails[item.id] = thumbnail(item);
      if (dialog.open) renderReview(); else notify('照片示例已加载，可从拍照入口继续查看。');
    } catch (error) {
      if (token !== generation) return;
      shell(`<div class="scene-body"><p class="error">${esc(error.message)}请通过本地预览服务打开页面。</p><button class="button" data-scene-action="demo">重新加载照片示例</button><button class="text-button" data-scene-action="demo-illustration">查看旧版插画示例</button></div>`, '照片示例');
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
    c.fillStyle = '#f5f2e9'; c.font = '18px sans-serif'; c.fillText('预置插画示例 · 未调用 AI', 35, 55);
    const originalImage = canvas.toDataURL('image/jpeg', .84);
    const result = D.normalizeResponse({ model: '固定示例，未调用模型', data: { items: [
      { name: '笔记本电脑', category: 'electronics', visibleQuantity: 1, bbox: [35, 220, 455, 655], uncertainties: ['屏幕、键盘与机身属于同一件物品；功能状态仍未知。'] },
      { name: '笔记本', category: 'stationery', visibleQuantity: 1, bbox: [535, 230, 715, 580], uncertainties: [] },
      { name: '水杯', category: 'containers', visibleQuantity: 1, bbox: [810, 230, 900, 540], uncertainties: ['杯内是否有液体无法判断。'] },
      { name: '剪刀', category: 'tools', visibleQuantity: 1, bbox: [105, 710, 320, 925], uncertainties: [] },
      { name: '收纳盒', category: 'containers', visibleQuantity: 1, bbox: [525, 675, 850, 930], uncertainties: ['盒内物品不可见；不推断内部库存。'] }
    ], sceneNotes: ['这是一张固定绘制的演示插画，边界与卡片为预置结果。上传图片会由页面标明的 AI 服务重新分析；预置示例不会上传。'] } });
    session = { originalImage, width: 1200, height: 800, bitmap: await imageElement(originalImage), result, source: 'preset-demo', thumbnails: {}, locationHint: '' };
    for (const item of result.items) session.thumbnails[item.id] = thumbnail(item);
    renderReview();
  }
  document.addEventListener('click', event => {
    const el = event.target.closest('[data-scene-action]'); if (!el) return;
    const action = el.dataset.sceneAction;
    if (action === 'capture') openCapture();
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
    else if (action === 'export-store') { try { download('物尽其用-照片草稿-v1.json', D.serialize(store)); } catch (error) { notify(error.message); } }
    else if (action === 'export-raw') download('物尽其用-照片草稿-原始备份.json', rawBackup);
    else if (action === 'reset-corrupt' && window.confirm('请先下载原始备份。确认清空无法读取的草稿，重新开始？')) { readError = ''; try { persist(D.emptyStore()); } catch (error) { notify(error.message); } }
    else if (action === 'import-store') importInput.click();
    else if (action === 'download-session') { try { download('物尽其用-本次照片草稿.json', D.serialize(D.append(D.emptyStore(), currentBatch()))); } catch (error) { $('#scene-error').textContent = error.message; } }
  });
  dialog.addEventListener('close', () => { if (returnFocus?.isConnected) returnFocus.focus(); else $('[data-scene-action="capture"]')?.focus(); });
  dialog.addEventListener('input', event => {
    const field = event.target.dataset.sceneField; if (!field || !session?.result) return;
    const item = session.result.items.find(i => i.id === event.target.dataset.id); if (!item) return;
    if (field === 'selected') item.selected = event.target.checked;
    else if (field === 'original') { item.cropMode = event.target.checked ? 'original' : 'bbox'; session.thumbnails[item.id] = thumbnail(item); $('#crop-' + item.id).src = session.thumbnails[item.id]; }
    else if (field === 'visibleQuantity') item.visibleQuantity = event.target.value === '' ? null : Number(event.target.value);
    else if (field === 'name' || field === 'category') item[field] = event.target.value;
    updateSelected();
  });
  importInput.onchange = async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    try {
      if (file.size > D.MAX_STORE_BYTES) throw new Error('草稿包超过 3.8 MB，无法导入。');
      const incoming = D.parse(await file.text());
      for (const scene of incoming.scenes) {
        const bitmap = await imageElement(scene.originalImage);
        if (bitmap.naturalWidth !== scene.width || bitmap.naturalHeight !== scene.height) throw new Error('草稿照片实际尺寸与记录不一致，未导入。');
      }
      for (const draft of incoming.drafts) if (draft.thumbnail) {
        const bitmap = await imageElement(draft.thumbnail);
        if (bitmap.naturalWidth > 1000 || bitmap.naturalHeight > 1000) throw new Error('草稿缩略图尺寸异常，未导入。');
      }
      if (!window.confirm(`用 ${incoming.drafts.length} 条照片草稿替换当前照片草稿？下方模拟库存不会改变。`)) return;
      persist(incoming); notify('照片草稿已导入，模拟库存未改变。');
    } catch (error) { notify('导入失败：' + error.message); }
  };
  window.PhotoDraftUI = { initialize(options) { hooks = options || {}; renderSection(); }, renderSection, openCapture, updateBackendStatus, setQuery(query) { draftQuery = query; renderDraftResults(); }, summary() { return { total: store.drafts.length, pending: store.drafts.filter(d => d.status === 'draft').length }; } };
})();
