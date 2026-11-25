'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('./scene-drafts.js');
const E = require('./engine.js');
const photo = 'data:image/jpeg;base64,YWJj';
const response = () => D.normalizeResponse({ model: 'test-local-model', data: { items: [
  { name: 'Laptop', category: 'electronics', bbox: [10, 20, 480, 600], visibleQuantity: 1, uncertainties: ['Condition unknown'] },
  { name: 'Storage box', category: 'containers', bbox: [500, 100, 900, 700], visibleQuantity: null, visibleText: 'BOX' }
], sceneNotes: ['The inside of the storage box is out of view.'] } });
const batch = (result = response()) => D.createBatch({ result, originalImage: photo, width: 1200, height: 800, source: 'local-ai', locationHint: 'Beside the desk', thumbnails: {}, at: '2026-11-03T10:00:00.000Z' });

test('Invalid, reversed, out-of-range or nonnumeric bounds retain the whole photo', () => {
  for (const box of [null, [0, 0, 0, 9], [100, 0, 50, 99], [-1, 0, 99, 99], [0, 0, 1001, 999], [0, '2', 3, 4], [1, 2, 3]]) {
    assert.equal(D.bbox(box), null);
    const r = D.normalizeResponse({ data: { items: [{ name: 'Unknown item', bbox: box }] } });
    assert.equal(r.items[0].cropMode, 'original'); assert.equal(r.items[0].bbox, null);
  }
});
test('Only selected items are saved and an empty selection cannot be saved', () => {
  const r = response(); r.items[1].selected = false;
  assert.equal(batch(r).drafts.length, 1); assert.equal(batch(r).drafts[0].name, 'Laptop');
  r.items[0].selected = false; assert.throws(() => batch(r), /Choose at least one/);
});
test('Unknown visible quantities stay null; photos cannot establish condition, responsibility, sharing permission or approval', () => {
  const b = batch(); const d = b.drafts[1];
  assert.equal(d.visibleQuantity, null); assert.equal(d.owner, null); assert.equal(d.condition, 'unknown');
  assert.equal(d.sharePermission, 'unknown'); assert.equal(d.approval, 'not-requested'); assert.equal(d.availability, 'unknown');
  assert.equal(d.locationHint, 'Beside the desk'); assert.equal(d.lastConfirmed, undefined);
});
test('Draft export and import preserve the source image, bounds, attribution, text, time and unknown fields', () => {
  const original = D.append(D.emptyStore(), batch()); const restored = D.parse(D.serialize(original));
  assert.deepEqual(restored, original); assert.equal(restored.scenes[0].originalImage, photo);
  assert.equal(restored.drafts[1].visibleText, 'BOX'); assert.equal(restored.drafts[0].createdAt, '2026-11-03T10:00:00.000Z');
});
test('Import rejects sharing approvals, condition claims and invalid bounds', () => {
  for (const mutate of [s => s.drafts[0].approval = 'approved', s => s.drafts[0].condition = 'good', s => s.drafts[0].sharePermission = 'allowed', s => s.drafts[0].bbox = [0, 0, 1500, 50], s => s.scenes[0].originalImage = 'javascript:alert(1)']) {
    const s = D.append(D.emptyStore(), batch()); mutate(s); assert.throws(() => D.validateStore(s));
  }
});
test('Saving the same photo again never duplicates cards or batches', () => {
  const s = D.append(D.emptyStore(), batch()); assert.throws(() => D.append(s, batch()), /already has drafts/);
  assert.equal(s.drafts.length, 2); assert.equal(s.scenes.length, 1);
});
test('Deleting the last related draft removes the source photo while remaining cards retain their provenance', () => {
  let s = D.append(D.emptyStore(), batch()); s = D.remove(s, s.drafts[0].id);
  assert.equal(s.scenes.length, 1); assert.equal(s.drafts.length, 1);
  s = D.remove(s, s.drafts[0].id); assert.equal(s.scenes.length, 0);
});
test('Drafts are separate from inventory and cannot be imported as matching engine data', () => {
  const s = D.append(D.emptyStore(), batch()); assert.throws(() => E.validateState(s));
});
test('Uploaded photo provenance is unknown, sample provenance is known and earlier records can migrate', () => {
  const r = response(); r.items[0].cropMode = 'original'; const b = batch(r);
  assert.equal(b.scene.isSynthetic, null); assert.equal(b.drafts[0].isSynthetic, null); assert.deepEqual(b.drafts[0].bbox, [10, 20, 480, 600]);
  assert.equal(b.drafts[0].cropMode, 'original');
  const legacy = D.append(D.emptyStore(), b); legacy.scenes[0].isSynthetic = false; legacy.drafts[0].isSynthetic = false;
  const migrated = D.validateStore(legacy); assert.equal(migrated.scenes[0].isSynthetic, null); assert.equal(migrated.drafts[0].isSynthetic, null);
  const demo = D.createBatch({ result: r, originalImage: photo, width: 1200, height: 800, source: 'preset-demo' }); assert.equal(demo.drafts[0].isSynthetic, true);
});
test('Unknown categories, invalid quantities and excess entries do not invent hidden contents', () => {
  const r = D.normalizeResponse({ data: { items: Array.from({ length: 15 }, () => ({ name: 'box', category: 'imagined', visibleQuantity: 0, bbox: null })) } });
  assert.equal(r.items.length, 12); assert.equal(r.items[0].category, 'unknown'); assert.equal(r.items[0].visibleQuantity, null);
  assert.ok(r.sceneNotes.some(s => /first\s+12\s+items/.test(s)));
});
test('Draft search covers names, English categories, locations and visible text without altering review status', () => {
  const s = D.append(D.emptyStore(), batch()); const original = D.serialize(s);
  for (const [query, count] of [['laptop', 1], ['Electronics', 1], ['containers', 1], ['desk', 2], ['box', 1], ['no such item', 0]]) assert.equal(D.searchDrafts(s.drafts, query).length, count);
  const many = Array.from({ length: 9 }, (_, i) => ({ ...s.drafts[0], id: 'draft-' + i }));
  assert.equal(D.searchDrafts(many, 'Electronics').length, 9);
  assert.equal(D.serialize(s), original); assert.equal(s.drafts[0].approval, 'not-requested');
});

const groupedResponse = (overrides = {}) => D.normalizeResponse({
  model: 'grouping-test', data: { items: [
    { id: 'scene-001', name: 'Laptop', category: 'electronics', bbox: [0, 0, 600, 800], visibleQuantity: 1, uncertainties: [] },
    { id: 'scene-002', name: 'Built-in keyboard', category: 'electronics', bbox: [50, 500, 550, 750], visibleQuantity: 1, visibleText: 'ENTER', uncertainties: ['Whether it can be detached is unknown'] },
    { id: 'scene-003', name: 'External keyboard', category: 'electronics', bbox: [650, 500, 950, 750], visibleQuantity: 1, uncertainties: [] }
  ], sceneNotes: [] },
  grouping: { version: 1, proposals: [{ parentId: 'scene-001', childIds: ['scene-002'], relation: 'integrated-part', evidence: 'The keyboard sits inside the same laptop housing with a continuous outer edge.', applyByDefault: true }] }, ...overrides
});

test('Default grouping collapses only the child card and preserves all source candidates and selection states for undo', () => {
  const r = groupedResponse();
  assert.equal(r.items.length, 3); assert.equal(r.items[1].sourceId, 'scene-002');
  assert.deepEqual(D.effectiveItems(r).map(i => i.id), ['candidate-0', 'candidate-2']);
  assert.deepEqual(r.grouping.proposals[0].childIds, ['candidate-1']);
  r.items[0].selected = false;
  assert.equal(r.items[1].selected, true); assert.equal(batch(r).drafts.length, 1);
  D.setGrouping(r, 'candidate-0', false);
  assert.equal(D.effectiveItems(r).length, 3); assert.equal(batch(r).drafts.length, 2);
  D.setGrouping(r, 'candidate-0', true);
  assert.equal(D.effectiveItems(r).length, 2); assert.equal(r.items.length, 3);
});

test('Missing or false groups remain suggestions and leave independent items visible', () => {
  for (const applyByDefault of [undefined, false]) {
    const r = groupedResponse({ grouping: { version: 1, proposals: [{ parentId: 'scene-001', childIds: ['scene-002'], relation: 'integrated-part', evidence: 'Only the bounds are close. Check this relationship.', ...(applyByDefault === undefined ? {} : { applyByDefault }) }] } });
    assert.equal(D.effectiveItems(r).length, 3); assert.equal(batch(r).drafts.length, 3);
    D.setGrouping(r, 'candidate-0', true); assert.equal(batch(r).drafts.length, 2);
  }
});

test('Invalid references, cycles, duplicate parents or children and multiple parents retain independent candidates', () => {
  const p = { parentId: 'scene-001', childIds: ['scene-002'], relation: 'integrated-part', evidence: 'Continuous housing', applyByDefault: true };
  const examples = [
    [{ ...p, childIds: ['missing'] }], [{ ...p, childIds: ['scene-001'] }],
    [{ ...p, childIds: ['scene-002', 'scene-002'] }], [p, { ...p }],
    [p, { ...p, parentId: 'scene-003' }],
    [p, { ...p, parentId: 'scene-002', childIds: ['scene-001'] }],
    [{ ...p, relation: 'inside-container' }], [{ ...p, applyByDefault: 'true' }],
    [{ ...p, evidence: '' }], [{ ...p, approval: 'approved' }]
  ];
  for (const proposals of examples) {
    const r = groupedResponse({ grouping: { version: 1, proposals } });
    assert.equal(r.grouping.proposals.length, 0); assert.equal(D.effectiveItems(r).length, 3);
    assert.ok(r.sceneNotes.some(n => n.includes('All candidates are available individually')));
  }
});

test('Duplicate source IDs prevent grouping and keep every candidate visible', () => {
  const raw = { items: [ { id: 'same', name: 'A' }, { id: 'same', name: 'B' } ], sceneNotes: [] };
  const r = D.normalizeResponse({ data: raw, grouping: { version: 1, proposals: [{ parentId: 'same', childIds: ['same'], relation: 'same-object', evidence: 'overlap', applyByDefault: true }] } });
  assert.equal(r.items.length, 2); assert.equal(r.grouping.proposals.length, 0);
  const saved = D.append(D.emptyStore(), batch(r));
  assert.equal(saved.drafts.length, 2); assert.notEqual(saved.drafts[0].sourceId, saved.drafts[1].sourceId);
});

test('Grouped drafts preserve component sources, visible text, bounds, quantities and evidence; older v1 packages remain readable', () => {
  const s = D.append(D.emptyStore(), batch(groupedResponse())), restored = D.parse(D.serialize(s));
  assert.equal(restored.drafts.length, 2); assert.equal(restored.drafts[0].components.length, 1);
  const c = restored.drafts[0].components[0];
  assert.equal(c.sourceId, 'scene-002'); assert.equal(c.visibleText, 'ENTER');
  assert.deepEqual(c.bbox, [50, 500, 550, 750]); assert.equal(c.visibleQuantity, 1);
  assert.match(c.evidence, /same laptop housing/); assert.deepEqual(restored, s);
  const old = D.append(D.emptyStore(), batch()); old.drafts.forEach(d => { delete d.sourceId; });
  assert.equal(D.parse(D.serialize(old)).drafts.length, 2);
});

test('Components reject permissions, arbitrary relations, nesting, invalid bounds and duplicate source fields', () => {
  for (const mutate of [
    c => c.approval = 'approved', c => c.owner = 'owner', c => c.relation = 'borrowable',
    c => c.bbox = [0, 0, 1001, 99], c => c.visibleQuantity = 0,
    c => c.components = [], c => c.sourceId = 'scene-001'
  ]) {
    const s = D.append(D.emptyStore(), batch(groupedResponse())); mutate(s.drafts[0].components[0]);
    assert.throws(() => D.validateStore(s));
  }
  const s = D.append(D.emptyStore(), batch(groupedResponse())); s.drafts[0].components.push({ ...s.drafts[0].components[0] });
  assert.throws(() => D.validateStore(s), /Duplicate /);
});

test('Splitting a component creates a single draft with unknown status and preserves the source photo, model and timestamp', () => {
  const s = D.append(D.emptyStore(), batch(groupedResponse())), parentId = s.drafts[0].id;
  const split = D.splitComponents(s, parentId), child = split.drafts.find(d => d.sourceId === 'scene-002');
  assert.equal(s.drafts.length, 2); assert.equal(split.drafts.length, 3); assert.equal(split.drafts[0].components, undefined);
  assert.equal(child.status, 'draft'); assert.equal(child.owner, null); assert.equal(child.condition, 'unknown');
  assert.equal(child.sharePermission, 'unknown'); assert.equal(child.approval, 'not-requested'); assert.equal(child.availability, 'unknown');
  assert.equal(child.sceneId, s.drafts[0].sceneId); assert.equal(child.createdAt, s.drafts[0].createdAt); assert.equal(child.model, s.drafts[0].model);
  assert.equal(split.scenes[0].originalImage, photo); assert.equal(child.visibleText, 'ENTER');
  assert.equal(D.splitComponents(split, parentId).drafts.length, 3);
  assert.equal(D.searchDrafts(s.drafts, 'Built-in keyboard').length, 1);
});

test('Splitting a component from a converted draft creates a draft without inheriting its inventory ID', () => {
  const s = D.append(D.emptyStore(), batch(groupedResponse())); s.drafts[0].status = 'converted'; s.drafts[0].convertedItemId = 'inventory-123';
  const split = D.splitComponents(s, s.drafts[0].id), child = split.drafts.find(d => d.sourceId === 'scene-002');
  assert.equal(split.drafts[0].status, 'converted'); assert.equal(split.drafts[0].convertedItemId, 'inventory-123');
  assert.equal(child.status, 'draft'); assert.equal(child.convertedItemId, undefined); assert.equal(child.approval, 'not-requested');
});

test('Valid nested groups preserve all descendants and create one record per source on split', () => {
  const r = groupedResponse({ grouping: { version: 1, proposals: [
    { parentId: 'scene-001', childIds: ['scene-002'], relation: 'integrated-part', evidence: 'Inside the chassis', applyByDefault: true },
    { parentId: 'scene-002', childIds: ['scene-003'], relation: 'same-object', evidence: 'Reversible nested relationship', applyByDefault: true }
  ] } });
  assert.equal(D.effectiveItems(r).length, 1);
  const s = D.append(D.emptyStore(), batch(r)); assert.equal(s.drafts[0].components.length, 2);
  assert.equal(D.splitComponents(s, s.drafts[0].id).drafts.length, 3);
});

test('Valid 500-character grouping evidence supports splitting; the new note fits within 300 characters and preserves emoji boundaries', () => {
  for (const evidence of ['Edge seam.'.repeat(50).padEnd(500, '.'), 'a' + '😀'.repeat(249) + '.']) {
    const r = groupedResponse(); r.grouping.proposals[0].evidence = evidence;
    const s = D.append(D.emptyStore(), batch(r)), before = D.serialize(s);
    const split = D.splitComponents(s, s.drafts[0].id), child = split.drafts.find(d => d.sourceId === 'scene-002');
    const note = child.uncertainties.find(u => u.startsWith('Split from group: '));
    assert.ok(note); assert.ok(note.length <= 300); assert.doesNotMatch(note, /[\uD800-\uDBFF]$/);
    assert.equal(D.serialize(s), before); assert.equal(child.approval, 'not-requested');
    assert.equal(D.parse(D.serialize(split)).drafts.length, 3);
  }
});

test('Splitting preserves the existing 12 review notes and keeps all source candidate information', () => {
  const r = groupedResponse(); r.items[1].uncertainties = Array.from({ length: 12 }, (_, i) => 'Original observation ' + i);
  const s = D.append(D.emptyStore(), batch(r)), split = D.splitComponents(s, s.drafts[0].id);
  assert.deepEqual(split.drafts.find(d => d.sourceId === 'scene-002').uncertainties, r.items[1].uncertainties);
});

test('Rejecting a child crop keeps the whole photo after grouping, export, import and splitting', () => {
  const r = groupedResponse(); r.items[1].cropMode = 'original';
  const s = D.parse(D.serialize(D.append(D.emptyStore(), batch(r))));
  assert.equal(s.drafts[0].components[0].cropMode, 'original');
  const split = D.splitComponents(s, s.drafts[0].id), child = split.drafts.find(d => d.sourceId === 'scene-002');
  assert.equal(child.cropMode, 'original'); assert.deepEqual(child.bbox, r.items[1].bbox);
  assert.equal(child.thumbnail, ''); assert.equal(split.scenes[0].originalImage, photo);
});

test('Older component packages without cropMode use crops for boxed items and full images for unboxed items', () => {
  for (const box of [[50, 500, 550, 750], null]) {
    const s = D.append(D.emptyStore(), batch(groupedResponse())), c = s.drafts[0].components[0];
    delete c.cropMode; c.bbox = box;
    const restored = D.parse(D.serialize(s)), mode = box ? 'bbox' : 'original';
    assert.equal(restored.drafts[0].components[0].cropMode, mode);
    assert.equal(D.splitComponents(restored, restored.drafts[0].id).drafts.find(d => d.sourceId === 'scene-002').cropMode, mode);
  }
});

test('Component cropMode rejects unknown values and cropping without bounds', () => {
  for (const mode of ['invented', null, 1, false]) {
    const s = D.append(D.emptyStore(), batch(groupedResponse())); s.drafts[0].components[0].cropMode = mode;
    assert.throws(() => D.validateStore(s), /component/i);
  }
  const s = D.append(D.emptyStore(), batch(groupedResponse()));
  s.drafts[0].components[0].bbox = null; s.drafts[0].components[0].cropMode = 'bbox';
  assert.throws(() => D.validateStore(s), /component/i);
});

const cloudMetadata = { backend: 'openai', provider: 'OpenAI(Cloud)', localOnly: false, remoteProcessing: true };
const health = overrides => ({ service: 'waicy-resource-commons', modelAvailable: true, model: 'cloud-test-model', ...cloudMetadata, ...overrides });
test('Only matching service identity and processing metadata from health allow submission; key configuration alone does not establish that API has been tested', () => {
  const cloud = D.normalizeServiceHealth(health({ apiVerified: false, availabilityCheck: 'configuration-only' }));
  assert.equal(cloud.known, true); assert.equal(cloud.ready, true); assert.equal(cloud.remoteProcessing, true);
  assert.match(D.processingNotice(cloud), /Key configured.*live request.*service access and quota/i);
  for (const value of [null, {}, health({ service: 'other' }), health({ localOnly: true }), health({ remoteProcessing: false }), health({ backend: 'unknown' })]) {
    const s = D.normalizeServiceHealth(value); assert.equal(s.known, false); assert.equal(s.ready, false);
    assert.equal(s.localOnly, null); assert.match(D.processingNotice(s), /No photo or request text is sent/);
  }
});
test('Current and legacy local backends and an unconfigured cloud key have explicit availability states', () => {
  for (const backend of ['local', 'ollama']) {
    const local = D.normalizeServiceHealth(health({ backend, localOnly: true, remoteProcessing: false }));
    assert.equal(local.ready, true); assert.equal(local.backend, backend);
    assert.match(D.processingNotice(local), /processed by your local model/);
    assert.doesNotMatch(D.processingNotice(local), /to OpenAI/);
  }
  const unavailable = D.normalizeServiceHealth(health({ modelAvailable: false }));
  assert.equal(unavailable.known, true); assert.equal(unavailable.ready, false);
  assert.match(D.processingNotice(unavailable), /Configure a server-side key/);
});
test('Photo, single-item and text workflows explain what is sent, potential costs and browser storage', () => {
  const service = D.normalizeServiceHealth(health());
  for (const [kind, content] of [['scene', 'the compressed photo and any detail crops'], ['item', 'your photo and text clues'], ['request', 'your request text']]) {
    const notice = D.processingNotice(service, kind); assert.ok(notice.includes(content));
    assert.match(notice, /to OpenAI/); assert.match(notice, /API charges may apply/);
    assert.match(notice, /records stay in this browser/i); assert.match(notice, /Share selected items separately through Groups/);
  }
});
test('DeepSeek Flash photo drafts preserve their provider through save and import', () => {
  const metadata = {backend:'deepseek', provider:'DeepSeek', model:'deepseek-flash', localOnly:false, remoteProcessing:true};
  const status = D.normalizeServiceHealth(health(metadata));
  assert.equal(status.ready, true);
  assert.equal(status.provider, 'DeepSeek');
  assert.match(D.processingNotice(status), /to DeepSeek/);
  const result = groupedResponse(metadata);
  const batch = D.createBatch({result, originalImage:photo, width:1200, height:800});
  const store = D.append(D.emptyStore(), batch);
  const imported = D.parse(D.serialize(store)).scenes[0];
  assert.equal(imported.backend, 'deepseek');
  assert.equal(imported.provider, 'DeepSeek');
  assert.equal(imported.source, 'cloud-ai');
  assert.equal(imported.model, 'deepseek-flash');
});

test('Cloud responses retain processing metadata and save independently of the calling local-ai default', () => {
  const result = groupedResponse({ ...cloudMetadata });
  assert.equal(result.source, 'cloud-ai'); assert.equal(result.backend, 'openai'); assert.equal(result.provider, 'OpenAI(Cloud)');
  const b = D.createBatch({ result, originalImage: photo, width: 1200, height: 800 });
  assert.equal(b.scene.source, 'cloud-ai'); assert.equal(b.scene.backend, 'openai');
  assert.equal(b.scene.localOnly, false); assert.equal(b.scene.remoteProcessing, true);
  assert.equal(b.scene.isSynthetic, null); assert.equal(b.drafts[0].isSynthetic, null);
  assert.equal(b.drafts[0].sharePermission, 'unknown'); assert.equal(b.drafts[0].approval, 'not-requested');
  assert.throws(() => D.createBatch({ result, originalImage: photo, width: 1200, height: 800, source: 'local-ai' }), /Recognition and draft sources differ/);
});
test('Cloud provenance, model and unknown image authenticity survive export, import and splitting without granting sharing permission', () => {
  const result = groupedResponse({ ...cloudMetadata });
  const original = D.append(D.emptyStore(), D.createBatch({ result, originalImage: photo, width: 1200, height: 800 }));
  const restored = D.parse(D.serialize(original)), split = D.splitComponents(restored, restored.drafts[0].id);
  assert.deepEqual(restored, original); assert.equal(split.scenes[0].source, 'cloud-ai');
  assert.equal(split.scenes[0].provider, 'OpenAI(Cloud)'); assert.equal(split.scenes[0].remoteProcessing, true);
  assert.ok(split.drafts.every(d => d.isSynthetic === null && d.sharePermission === 'unknown' && d.approval === 'not-requested'));
  assert.equal(split.drafts.find(d => d.sourceId === 'scene-002').model, result.model);
});
test('Older local-ai and preset-demo drafts remain readable without inventing cloud inference metadata', () => {
  const old = D.append(D.emptyStore(), batch());
  assert.equal(D.parse(D.serialize(old)).scenes[0].source, 'local-ai');
  assert.equal(D.parse(D.serialize(old)).scenes[0].backend, undefined);
  const demo = D.append(D.emptyStore(), D.createBatch({ result: response(), originalImage: photo, width: 1200, height: 800, source: 'preset-demo' }));
  assert.equal(D.parse(D.serialize(demo)).scenes[0].isSynthetic, true);
  assert.equal(response().source, null);
});
test('Import rejects contradictory origins and approval fields; cloud labels do not verify image authenticity', () => {
  const make = () => D.append(D.emptyStore(), D.createBatch({ result: groupedResponse({ ...cloudMetadata }), originalImage: photo, width: 1200, height: 800 }));
  for (const mutate of [s => s.scenes[0].source = 'local-ai', s => s.scenes[0].localOnly = true, s => s.scenes[0].remoteProcessing = false, s => s.scenes[0].backend = 'ollama', s => s.drafts[0].approval = 'approved']) {
    const s = make(); mutate(s); assert.throws(() => D.validateStore(s));
  }
  const s = make(); s.scenes[0].isSynthetic = false; s.drafts[0].isSynthetic = false;
  const restored = D.validateStore(s); assert.equal(restored.scenes[0].isSynthetic, null); assert.equal(restored.drafts[0].isSynthetic, null);
});

const publicPhoto = { author: 'Alan Quirván', pageUrl: 'https://www.pexels.com/photo/laptop-notebooks-and-pens-on-white-desk-14541073/', licenseUrl: 'https://www.pexels.com/license/' };
test('Public photo samples preserve preview illustrations, source photos and attribution without granting sharing permission after reimport', () => {
  const r = response(), illustration = 'data:image/jpeg;base64,ZGVtbw==';
  const b = D.createBatch({ result: r, originalImage: photo, width: 1200, height: 800, source: 'public-photo-demo', publicPhoto, thumbnails: { [r.items[0].id]: illustration } });
  const restored = D.parse(D.serialize(D.append(D.emptyStore(), b)));
  assert.equal(restored.scenes[0].source, 'public-photo-demo');
  assert.deepEqual(restored.scenes[0].publicPhoto, publicPhoto);
  assert.equal(restored.scenes[0].originalImage, photo);
  assert.equal(restored.drafts[0].thumbnail, illustration);
  assert.equal(restored.scenes[0].isSynthetic, null, 'Source labels do not verify image authenticity');
  assert.equal(restored.drafts[0].approval, 'not-requested');
  assert.equal(restored.drafts[0].sharePermission, 'unknown');
  assert.equal(restored.drafts[0].owner, null);
  assert.equal(restored.drafts[1].visibleQuantity, null);
});
test('Public photo samples reject missing attribution, script links and fabricated cloud inference flags', () => {
  const make = data => D.createBatch({ result: response(), originalImage: photo, width: 1200, height: 800, source: 'public-photo-demo', publicPhoto: data });
  for (const data of [undefined, { ...publicPhoto, author: '' }, { ...publicPhoto, pageUrl: 'javascript:alert(1)' }, { ...publicPhoto, licenseUrl: 'https://example.com/\"onclick=bad' }]) assert.throws(() => make(data), /source URL/);
  const s = D.append(D.emptyStore(), make(publicPhoto));
  Object.assign(s.scenes[0], { backend: 'openai', provider: 'OpenAI', localOnly: false, remoteProcessing: true });
  assert.throws(() => D.validateStore(s), /source and processing service do not match/);
});
test('New photo samples preserve the distinct provenance of earlier illustrated examples', () => {
  const b = D.createBatch({ result: response(), originalImage: photo, width: 1200, height: 800, source: 'preset-demo' });
  const s = D.parse(D.serialize(D.append(D.emptyStore(), b)));
  assert.equal(s.scenes[0].source, 'preset-demo'); assert.equal(s.scenes[0].isSynthetic, true);
  assert.equal(s.scenes[0].publicPhoto, undefined); assert.equal(s.drafts[0].isSynthetic, true);
});
