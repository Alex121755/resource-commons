(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PhotoDraftData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const STORAGE_KEY = 'resource-commons-photo-drafts-v1';
  const MAX_STORE_BYTES = 3800000;
  const categories = { electronics: 'Electronics', tools: 'Tools', stationery: 'Stationery', furniture: 'Furniture', containers: 'Containers and storage', other: 'Other items', unknown: 'Uncategorized' };
  const clone = value => JSON.parse(JSON.stringify(value));
  const plain = (value, limit, fallback = '') => typeof value === 'string' ? value.slice(0, limit) : fallback;
  const identifier = prefix => prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  function bbox(value) {
    if (!Array.isArray(value) || value.length !== 4 || !value.every(n => Number.isFinite(n) && n >= 0 && n <= 1000)) return null;
    return value[2] > value[0] && value[3] > value[1] ? [...value] : null;
  }
  function image(value, limit = 1800000) {
    return typeof value === 'string' && value.length <= limit && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
  }
  const cloudProviders = {openai: 'OpenAI', deepseek: 'DeepSeek'};
  function normalizeServiceHealth(value) {
    const cloud = Object.hasOwn(cloudProviders, value?.backend) && value.localOnly === false && value.remoteProcessing === true;
    const local = ['local', 'ollama'].includes(value?.backend) && value.localOnly === true && value.remoteProcessing === false;
    const known = value?.service === 'waicy-resource-commons' && (cloud || local);
    return { known, ready: known && value.modelAvailable === true, backend: known ? value.backend : null,
      provider: known ? (cloud ? cloudProviders[value.backend] : 'Ollama') : '', model: plain(value?.model, 120),
      localOnly: known ? local : null, remoteProcessing: known ? cloud : null };
  }
  function processingNotice(service, kind = 'scene') {
    if (!service?.known) return 'Recognition is offline. No photo or request text is sent. You can still open the sample photo.';
    if (service.remoteProcessing) {
      const content = kind === 'request' ? 'your request text' : kind === 'item' ? 'your photo and text clues' : 'the compressed photo and any detail crops';
      const status = service.ready ? 'Key configured. A live request will check service access and quota.' : 'Configure a server-side key to enable recognition.';
      return `Cloud AI · ${service.model || service.provider}. Starting recognition sends ${content} through Resource Commons to ${service.provider}. API charges may apply. ${status} Inventory records stay in this browser. Share selected items separately through Groups.`;
    }
    const status = service.ready ? 'Images and text are processed by your local model.' : 'Start the model to enable recognition.';
    return `Local AI · ${service.model || 'Ollama'}. ${status} Records stay in this browser. Review the results before saving.`;
  }
  function responseProvenance(response) {
    const backend = ['openai', 'deepseek', 'local', 'ollama'].includes(response?.backend) ? response.backend : null;
    const localOnly = typeof response?.localOnly === 'boolean' ? response.localOnly : null;
    const remoteProcessing = typeof response?.remoteProcessing === 'boolean' ? response.remoteProcessing : null;
    // Any explicit remote signal wins over a contradictory local label.
    const source = Object.hasOwn(cloudProviders, backend) || localOnly === false || remoteProcessing === true ? 'cloud-ai' : ['local', 'ollama'].includes(backend) && localOnly === true && remoteProcessing === false ? 'local-ai' : null;
    return { source, backend, provider: plain(response?.provider, 100), localOnly, remoteProcessing };
  }
  function normalizeResponse(response) {
    if (!response || !response.data || !Array.isArray(response.data.items)) throw new Error('The response is missing the item list. Try again.');
    const items = response.data.items.slice(0, 12).map((raw, index) => {
      if (!raw || typeof raw !== 'object') throw new Error('The response contains an invalid item.');
      const box = bbox(raw.bbox);
      const uncertainties = (Array.isArray(raw.uncertainties) ? raw.uncertainties : []).slice(0, 12).map(s => plain(s, 300)).filter(Boolean);
      if (!box) { uncertainties.unshift('Uncertain boundaries. The full photo is kept by default.'); uncertainties.splice(12); }
      return { id: 'candidate-' + index, sourceId: plain(raw.id, 100) || 'unidentified-' + index, name: plain(raw.name, 100, 'Unnamed item') || 'Unnamed item', category: Object.hasOwn(categories, raw.category) ? raw.category : 'unknown', bbox: box, visibleQuantity: Number.isInteger(raw.visibleQuantity) && raw.visibleQuantity > 0 && raw.visibleQuantity <= 99 ? raw.visibleQuantity : null, visibleText: plain(raw.visibleText, 1000), sourceText: plain(raw.sourceText, 1000), uncertainties, cropMode: box ? 'bbox' : 'original', selected: true };
    });
    const sourceCounts = new Map();
    for (const i of items) sourceCounts.set(i.sourceId, (sourceCounts.get(i.sourceId) || 0) + 1);
    const occupied = new Set(items.map(i => i.sourceId));
    for (const [index, i] of items.entries()) if (sourceCounts.get(i.sourceId) > 1) {
      i.uncertainties.unshift('Duplicate source ID. Each candidate has been given a unique ID.'); i.uncertainties.splice(12);
      let unique = 'unidentified-' + index;
      while (occupied.has(unique)) unique += '-x';
      occupied.add(unique); i.sourceId = unique;
    }
    const notes = (Array.isArray(response.data.sceneNotes) ? response.data.sceneNotes : []).slice(0, 12).map(s => plain(s, 500)).filter(Boolean);
    if (response.data.items.length > 12) { notes.splice(11); notes.push('Showing the first 12 items. Take another photo to add more.'); }
    const grouping = normalizeGrouping(response.grouping, items, notes);
    return { items, grouping, sceneNotes: notes, model: plain(response.model, 120, 'AI Model'), elapsedSeconds: Number.isFinite(response.elapsedSeconds) ? response.elapsedSeconds : null, ...responseProvenance(response) };
  }
  function normalizeGrouping(raw, items, notes) {
    if (raw === undefined) return { version: 1, proposals: [] };
    const invalid = () => { notes.splice(11); notes.push('Invalid or conflicting grouping suggestions. All candidates are available individually.'); return { version: 1, proposals: [] }; };
    const known = new Map(items.map(i => [i.sourceId, i.id]));
    if (!raw || raw.version !== 1 || !Array.isArray(raw.proposals) || raw.proposals.length > 12 || Object.keys(raw).some(k => !['version', 'proposals'].includes(k)) || known.size !== items.length) return invalid();
    const parents = new Set(), childParent = new Map(), proposals = [];
    for (const p of raw.proposals) {
      if (!p || Object.keys(p).some(k => !['parentId', 'childIds', 'relation', 'evidence', 'applyByDefault'].includes(k)) || !known.has(p.parentId) || parents.has(p.parentId) || !Array.isArray(p.childIds) || !p.childIds.length || p.childIds.length > 11 || new Set(p.childIds).size !== p.childIds.length || !['integrated-part', 'same-object'].includes(p.relation) || typeof p.evidence !== 'string' || !p.evidence.trim() || p.evidence.length > 500 || (p.applyByDefault !== undefined && typeof p.applyByDefault !== 'boolean')) return invalid();
      parents.add(p.parentId);
      for (const child of p.childIds) { if (!known.has(child) || child === p.parentId || childParent.has(child)) return invalid(); childParent.set(child, p.parentId); }
      proposals.push({ parentId: known.get(p.parentId), childIds: p.childIds.map(id => known.get(id)), relation: p.relation, evidence: p.evidence, applied: p.applyByDefault === true });
    }
    for (const child of childParent.keys()) {
      const visited = new Set([child]); let parent = childParent.get(child);
      while (parent !== undefined) { if (visited.has(parent)) return invalid(); visited.add(parent); parent = childParent.get(parent); }
    }
    return { version: 1, proposals };
  }
  function activeChildren(result, parentId) { return result.grouping?.proposals.find(p => p.parentId === parentId && p.applied === true)?.childIds || []; }
  function effectiveItems(result) {
    const hidden = new Set((result.grouping?.proposals || []).filter(p => p.applied === true).flatMap(p => p.childIds));
    return result.items.filter(i => !hidden.has(i.id));
  }
  function setGrouping(result, parentId, applied) {
    const proposal = result.grouping?.proposals.find(p => p.parentId === parentId);
    if (!proposal) throw new Error('Grouping suggestion not found.');
    proposal.applied = applied === true; return result;
  }
  function groupedComponents(result, parentId) {
    const components = [];
    const visit = id => {
      const proposal = result.grouping?.proposals.find(p => p.parentId === id && p.applied === true);
      for (const childId of proposal?.childIds || []) {
        const child = result.items.find(i => i.id === childId);
        if (child?.selected === true) {
          components.push({ sourceId: child.sourceId, name: child.name, category: child.category, bbox: bbox(child.bbox), cropMode: child.cropMode === 'bbox' && bbox(child.bbox) ? 'bbox' : 'original', visibleQuantity: child.visibleQuantity, visibleText: child.visibleText, sourceText: child.sourceText, uncertainties: [...child.uncertainties], relation: proposal.relation, evidence: proposal.evidence });
          visit(childId);
        }
      }
    };
    visit(parentId); return components;
  }
  function checkPublicPhoto(value) {
    if (!value || typeof value.author !== 'string' || !value.author.trim() || value.author.length > 120 || !['pageUrl', 'licenseUrl'].every(key => typeof value[key] === 'string' && value[key].length <= 500 && /^https:\/\/[^\s<>"']+$/.test(value[key]))) throw new Error('The example photo needs a valid credit and source URL.');
    return { author: value.author, pageUrl: value.pageUrl, licenseUrl: value.licenseUrl };
  }
  function createBatch({ result, originalImage, width, height, locationHint = '', source, thumbnails = {}, publicPhoto, at = new Date().toISOString() }) {
    if (!image(originalImage)) throw new Error('Invalid image format or size. Choose another photo.');
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 2000 || height > 2000) throw new Error('Invalid image dimensions.');
    const chosen = effectiveItems(result).filter(i => i.selected === true);
    if (!chosen.length) throw new Error('Choose at least one item to save.');
    if (chosen.length > 12) throw new Error('Each photo supports up to 12 items.');
    if (result.source && source && result.source !== source) throw new Error('Recognition and draft sources differ. Changes were not saved.');
    source = result.source || source || 'local-ai';
    if (!['local-ai', 'cloud-ai', 'preset-demo', 'public-photo-demo'].includes(source)) throw new Error('Invalid recognition source.');
    const provenance = result.backend ? { backend: result.backend, provider: result.provider || (cloudProviders[result.backend] || 'Ollama'), localOnly: result.localOnly, remoteProcessing: result.remoteProcessing } : {};
    const scene = { id: identifier('scene'), originalImage, width, height, createdAt: at, model: result.model, source, ...provenance, ...(source === 'public-photo-demo' ? { publicPhoto: checkPublicPhoto(publicPhoto) } : {}), sceneNotes: result.sceneNotes, isSynthetic: source === 'preset-demo' ? true : null };
    const drafts = chosen.map(i => ({ id: identifier('draft'), sceneId: scene.id, status: 'draft', sourceId: i.sourceId, ...(groupedComponents(result, i.id).length ? { components: groupedComponents(result, i.id) } : {}), name: plain(i.name, 100, 'Unnamed item') || 'Unnamed item', category: Object.hasOwn(categories, i.category) ? i.category : 'unknown', visibleQuantity: Number.isInteger(i.visibleQuantity) && i.visibleQuantity > 0 && i.visibleQuantity <= 99 ? i.visibleQuantity : null, bbox: bbox(i.bbox), cropMode: i.cropMode === 'bbox' && bbox(i.bbox) ? 'bbox' : 'original', thumbnail: image(thumbnails[i.id], 250000) ? thumbnails[i.id] : '', locationHint: plain(locationHint, 120), visibleText: plain(i.visibleText, 1000), sourceText: plain(i.sourceText, 1000), uncertainties: Array.isArray(i.uncertainties) ? i.uncertainties.slice(0, 12).map(s => plain(s, 300)) : [], createdAt: at, model: scene.model, isSynthetic: scene.isSynthetic, owner: null, condition: 'unknown', sharePermission: 'unknown', approval: 'not-requested', availability: 'unknown' }));
    return { scene, drafts };
  }
  function emptyStore() { return { version: 1, kind: 'resource-commons-photo-drafts', scenes: [], drafts: [] }; }
  function validateStore(raw) {
    if (!raw || raw.version !== 1 || raw.kind !== 'resource-commons-photo-drafts' || !Array.isArray(raw.scenes) || !Array.isArray(raw.drafts) || raw.scenes.length > 10 || raw.drafts.length > 60) throw new Error('Invalid photo draft bundle or more than 60 records.');
    const checkString = (v, max, field, allowEmpty = false) => { if (typeof v !== 'string' || v.length > max || (!allowEmpty && !v.trim())) throw new Error(field + ' is invalid.'); return v; };
    const checkDate = v => { if (typeof v !== 'string' || v.length > 40 || !Number.isFinite(Date.parse(v))) throw new Error('Invalid photo timestamp.'); return v; };
    const scenes = raw.scenes.map(s => {
      if (!s || !image(s.originalImage) || !['local-ai', 'cloud-ai', 'preset-demo', 'public-photo-demo'].includes(s.source) || !Number.isInteger(s.width) || !Number.isInteger(s.height) || s.width < 1 || s.height < 1 || s.width > 2000 || s.height > 2000 || !Array.isArray(s.sceneNotes) || s.sceneNotes.length > 12) throw new Error('Invalid photo source, size, or format.');
      let provenance = {};
      if (s.backend !== undefined || s.provider !== undefined || s.localOnly !== undefined || s.remoteProcessing !== undefined) {
        const cloud = s.source === 'cloud-ai', local = s.source === 'local-ai';
        const expected = cloud ? Object.hasOwn(cloudProviders, s.backend) : local && ['local', 'ollama'].includes(s.backend);
        if (!expected || typeof s.provider !== 'string' || s.provider.length > 100 || s.localOnly !== local || s.remoteProcessing !== cloud) throw new Error('Photo source and processing service do not match.');
        provenance = { backend: s.backend, provider: s.provider, localOnly: s.localOnly, remoteProcessing: s.remoteProcessing };
      }
      return { id: checkString(s.id, 100, 'Photo ID'), originalImage: s.originalImage, width: s.width, height: s.height, createdAt: checkDate(s.createdAt), model: checkString(s.model, 120, 'Model name'), source: s.source, ...provenance, ...(s.source === 'public-photo-demo' ? { publicPhoto: checkPublicPhoto(s.publicPhoto) } : {}), sceneNotes: s.sceneNotes.map(n => checkString(n, 500, 'Scene description', true)), isSynthetic: s.source === 'preset-demo' ? true : null };
    });
    if (new Set(scenes.map(s => s.id)).size !== scenes.length) throw new Error('Duplicate photo ID.');
    if (new Set(scenes.map(s => s.originalImage)).size !== scenes.length) throw new Error('This photo already has a saved batch.');
    const componentKeys = ['sourceId', 'name', 'category', 'bbox', 'cropMode', 'visibleQuantity', 'visibleText', 'sourceText', 'uncertainties', 'relation', 'evidence'];
    const checkComponents = list => {
      if (!Array.isArray(list) || list.length > 11) throw new Error('Invalid component list.');
      const components = list.map(c => {
        if (!c || Object.keys(c).some(k => !componentKeys.includes(k)) || !Object.hasOwn(categories, c.category) || c.bbox !== null && !bbox(c.bbox) || c.cropMode !== undefined && !['bbox', 'original'].includes(c.cropMode) || c.cropMode === 'bbox' && !bbox(c.bbox) || c.visibleQuantity !== null && (!Number.isInteger(c.visibleQuantity) || c.visibleQuantity < 1 || c.visibleQuantity > 99) || !Array.isArray(c.uncertainties) || c.uncertainties.length > 12 || !['integrated-part', 'same-object'].includes(c.relation)) throw new Error('Invalid component, bounds, quantity, or relation.');
        return { sourceId: checkString(c.sourceId, 100, 'Component source ID'), name: checkString(c.name, 100, 'Component name'), category: c.category, bbox: bbox(c.bbox), cropMode: c.cropMode === undefined ? (bbox(c.bbox) ? 'bbox' : 'original') : c.cropMode, visibleQuantity: c.visibleQuantity, visibleText: checkString(c.visibleText, 1000, 'Visible component text', true), sourceText: checkString(c.sourceText || '', 1000, 'Component evidence', true), uncertainties: c.uncertainties.map(u => checkString(u, 300, 'Component details to verify', true)), relation: c.relation, evidence: checkString(c.evidence, 500, 'Grouping evidence') };
      });
      if (new Set(components.map(c => c.sourceId)).size !== components.length) throw new Error('Duplicate component source ID.');
      return components;
    };
    const drafts = raw.drafts.map(d => {
      const scene = scenes.find(s => s.id === d?.sceneId);
      if (!d || !scene || !Object.hasOwn(categories, d.category) || !['draft', 'converted'].includes(d.status) || !['bbox', 'original'].includes(d.cropMode) || d.bbox !== null && !bbox(d.bbox) || d.cropMode === 'bbox' && !bbox(d.bbox) || d.visibleQuantity !== null && (!Number.isInteger(d.visibleQuantity) || d.visibleQuantity < 1 || d.visibleQuantity > 99) || !Array.isArray(d.uncertainties) || d.uncertainties.length > 12 || (d.thumbnail && !image(d.thumbnail, 250000))) throw new Error('Invalid draft item, quantity, or crop.');
      // Imported drafts cannot carry authorization or availability into inventory.
      if (d.owner !== null || d.condition !== 'unknown' || d.sharePermission !== 'unknown' || d.approval !== 'not-requested' || d.availability !== 'unknown') throw new Error('Photo drafts cannot contain confirmed status or sharing approvals.');
      return { id: checkString(d.id, 100, 'Draft ID'), sceneId: scene.id, status: d.status, ...(d.sourceId !== undefined ? { sourceId: checkString(d.sourceId, 100, 'Candidate source ID') } : {}), ...(d.components !== undefined ? { components: checkComponents(d.components) } : {}), name: checkString(d.name, 100, 'Item name'), category: d.category, visibleQuantity: d.visibleQuantity, bbox: bbox(d.bbox), cropMode: d.cropMode, thumbnail: d.thumbnail || '', locationHint: checkString(d.locationHint, 120, 'Location hint', true), visibleText: checkString(d.visibleText, 1000, 'Visible text', true), sourceText: checkString(d.sourceText || '', 1000, 'Source evidence', true), uncertainties: d.uncertainties.map(s => checkString(s, 300, 'Details to verify', true)), createdAt: checkDate(d.createdAt), model: checkString(d.model, 120, 'Model name'), isSynthetic: scene.isSynthetic, owner: null, condition: 'unknown', sharePermission: 'unknown', approval: 'not-requested', availability: 'unknown', ...(d.status === 'converted' ? { convertedItemId: checkString(d.convertedItemId, 100, 'Inventory ID') } : {}) };
    });
    if (new Set(drafts.map(d => d.id)).size !== drafts.length) throw new Error('Duplicate draft ID.');
    const usedSources = new Set();
    for (const d of drafts) for (const sourceId of [d.sourceId, ...(d.components || []).map(c => c.sourceId)].filter(Boolean)) {
      const key = d.sceneId + ':' + sourceId;
      if (usedSources.has(key)) throw new Error('A photo candidate was recorded or grouped twice.');
      usedSources.add(key);
    }
    return { version: 1, kind: 'resource-commons-photo-drafts', scenes, drafts };
  }
  function serialize(store) { const text = JSON.stringify(validateStore(store)); if (new TextEncoder().encode(text).length > MAX_STORE_BYTES) throw new Error('Draft storage is nearly full. Export your drafts and remove unwanted records.'); return text; }
  function parse(text) { if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_STORE_BYTES) throw new Error('Draft file exceeds 3.8 MB. Import stopped.'); return validateStore(JSON.parse(text)); }
  function append(store, batch) {
    if (store.scenes.some(s => s.originalImage === batch.scene.originalImage)) throw new Error('This photo already has drafts. Open Photo drafts to see them.');
    return validateStore({ ...clone(store), scenes: [...store.scenes, batch.scene], drafts: [...store.drafts, ...batch.drafts] });
  }
  function remove(store, id) { const next = clone(store); next.drafts = next.drafts.filter(d => d.id !== id); const used = new Set(next.drafts.map(d => d.sceneId)); next.scenes = next.scenes.filter(s => used.has(s.id)); return next; }
  function splitComponents(store, id) {
    const next = clone(validateStore(store)), parent = next.drafts.find(d => d.id === id);
    if (!parent) throw new Error('Photo draft not found.');
    if (!parent.components?.length) return next;
    const scene = next.scenes.find(s => s.id === parent.sceneId);
    const components = parent.components;
    delete parent.components;
    for (const c of components) {
      // A split creates photo drafts only, even when the parent was converted earlier.
      const splitNote = plain('Split from group: ' + c.evidence, 300).replace(/[\uD800-\uDBFF]$/, '');
      next.drafts.push({ ...clone(parent), id: identifier('draft'), status: 'draft', sourceId: c.sourceId, name: c.name, category: c.category, bbox: c.bbox, cropMode: c.cropMode, thumbnail: '', visibleQuantity: c.visibleQuantity, visibleText: c.visibleText, sourceText: c.sourceText, uncertainties: [...c.uncertainties, splitNote].slice(0, 12), model: scene.model, owner: null, condition: 'unknown', sharePermission: 'unknown', approval: 'not-requested', availability: 'unknown' });
      delete next.drafts[next.drafts.length - 1].convertedItemId;
    }
    return validateStore(next);
  }
  function searchDrafts(drafts, query = '') {
    const text = String(query).trim().toLocaleLowerCase();
    return drafts.filter(d => !text || [d.name, categories[d.category] || '', d.locationHint, d.visibleText, ...(d.components || []).flatMap(c => [c.name, categories[c.category] || '', c.visibleText])].join(' ').toLocaleLowerCase().includes(text));
  }
  return { STORAGE_KEY, MAX_STORE_BYTES, categories, clone, bbox, image, normalizeServiceHealth, processingNotice, responseProvenance, normalizeResponse, normalizeGrouping, effectiveItems, activeChildren, setGrouping, groupedComponents, createBatch, emptyStore, validateStore, serialize, parse, append, remove, splitComponents, searchDrafts };
});
