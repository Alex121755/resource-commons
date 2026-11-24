'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('./scene-drafts.js');
const E = require('./engine.js');
const photo = 'data:image/jpeg;base64,YWJj';
const response = () => D.normalizeResponse({ model: 'test-local-model', data: { items: [
  { name: '笔记本电脑', category: 'electronics', bbox: [10, 20, 480, 600], visibleQuantity: 1, uncertainties: ['状态未知'] },
  { name: '收纳盒', category: 'containers', bbox: [500, 100, 900, 700], visibleQuantity: null, visibleText: 'BOX' }
], sceneNotes: ['收纳盒内部不可见。'] } });
const batch = (result = response()) => D.createBatch({ result, originalImage: photo, width: 1200, height: 800, source: 'local-ai', locationHint: '书桌旁', thumbnails: {}, at: '2026-11-03T10:00:00.000Z' });

test('非法、反向、越界或非数字边界退回整张图，不制造裁切', () => {
  for (const box of [null, [0, 0, 0, 9], [100, 0, 50, 99], [-1, 0, 99, 99], [0, 0, 1001, 999], [0, '2', 3, 4], [1, 2, 3]]) {
    assert.equal(D.bbox(box), null);
    const r = D.normalizeResponse({ data: { items: [{ name: '未知物品', bbox: box }] } });
    assert.equal(r.items[0].cropMode, 'original'); assert.equal(r.items[0].bbox, null);
  }
});
test('只保存用户勾选的物品，零项选择无法保存', () => {
  const r = response(); r.items[1].selected = false;
  assert.equal(batch(r).drafts.length, 1); assert.equal(batch(r).drafts[0].name, '笔记本电脑');
  r.items[0].selected = false; assert.throws(() => batch(r), /至少选择/);
});
test('照片数量未知保持 null；照片不能默认状态、负责人、共享许可或批准', () => {
  const b = batch(); const d = b.drafts[1];
  assert.equal(d.visibleQuantity, null); assert.equal(d.owner, null); assert.equal(d.condition, 'unknown');
  assert.equal(d.sharePermission, 'unknown'); assert.equal(d.approval, 'not-requested'); assert.equal(d.availability, 'unknown');
  assert.equal(d.locationHint, '书桌旁'); assert.equal(d.lastConfirmed, undefined);
});
test('草稿完整序列化往返保留整图、边界、来源、文字、时间和未知字段', () => {
  const original = D.append(D.emptyStore(), batch()); const restored = D.parse(D.serialize(original));
  assert.deepEqual(restored, original); assert.equal(restored.scenes[0].originalImage, photo);
  assert.equal(restored.drafts[1].visibleText, 'BOX'); assert.equal(restored.drafts[0].createdAt, '2026-11-03T10:00:00.000Z');
});
test('导入不能夹带共享批准、物品状态或非法边界', () => {
  for (const mutate of [s => s.drafts[0].approval = 'approved', s => s.drafts[0].condition = 'good', s => s.drafts[0].sharePermission = 'allowed', s => s.drafts[0].bbox = [0, 0, 1500, 50], s => s.scenes[0].originalImage = 'javascript:alert(1)']) {
    const s = D.append(D.emptyStore(), batch()); mutate(s); assert.throws(() => D.validateStore(s));
  }
});
test('重复保存同一张图不会累加卡片或重复批次', () => {
  const s = D.append(D.emptyStore(), batch()); assert.throws(() => D.append(s, batch()), /已有草稿/);
  assert.equal(s.drafts.length, 2); assert.equal(s.scenes.length, 1);
});
test('删除最后一条关联草稿才清理整张照片，其他卡片仍能追溯', () => {
  let s = D.append(D.emptyStore(), batch()); s = D.remove(s, s.drafts[0].id);
  assert.equal(s.scenes.length, 1); assert.equal(s.drafts.length, 1);
  s = D.remove(s, s.drafts[0].id); assert.equal(s.scenes.length, 0);
});
test('草稿包与匹配库存隔离，不能直接作为引擎数据导入', () => {
  const s = D.append(D.emptyStore(), batch()); assert.throws(() => E.validateState(s));
});
test('用户上传图片的合成来源未知；预置示例已知，旧记录可迁移', () => {
  const r = response(); r.items[0].cropMode = 'original'; const b = batch(r);
  assert.equal(b.scene.isSynthetic, null); assert.equal(b.drafts[0].isSynthetic, null); assert.deepEqual(b.drafts[0].bbox, [10, 20, 480, 600]);
  assert.equal(b.drafts[0].cropMode, 'original');
  const legacy = D.append(D.emptyStore(), b); legacy.scenes[0].isSynthetic = false; legacy.drafts[0].isSynthetic = false;
  const migrated = D.validateStore(legacy); assert.equal(migrated.scenes[0].isSynthetic, null); assert.equal(migrated.drafts[0].isSynthetic, null);
  const demo = D.createBatch({ result: r, originalImage: photo, width: 1200, height: 800, source: 'preset-demo' }); assert.equal(demo.drafts[0].isSynthetic, true);
});
test('未知分类、越界数量和多余项有明确退路，不猜测内部物品', () => {
  const r = D.normalizeResponse({ data: { items: Array.from({ length: 15 }, () => ({ name: '盒子', category: 'imagined', visibleQuantity: 0, bbox: null })) } });
  assert.equal(r.items.length, 12); assert.equal(r.items[0].category, 'unknown'); assert.equal(r.items[0].visibleQuantity, null);
  assert.ok(r.sceneNotes.some(s => s.includes('前 12 项')));
});
test('草稿可按名称、中文类别、地点与可见文字检索，匹配不截断或修改未确认状态', () => {
  const s = D.append(D.emptyStore(), batch()); const original = D.serialize(s);
  for (const [query, count] of [['电脑', 1], ['电子设备', 1], ['容器', 1], ['书桌', 2], ['box', 1], ['没有这件物品', 0]]) assert.equal(D.searchDrafts(s.drafts, query).length, count);
  const many = Array.from({ length: 9 }, (_, i) => ({ ...s.drafts[0], id: 'draft-' + i }));
  assert.equal(D.searchDrafts(many, '电子设备').length, 9);
  assert.equal(D.serialize(s), original); assert.equal(s.drafts[0].approval, 'not-requested');
});

const groupedResponse = (overrides = {}) => D.normalizeResponse({
  model: 'grouping-test', data: { items: [
    { id: 'scene-001', name: '笔记本电脑', category: 'electronics', bbox: [0, 0, 600, 800], visibleQuantity: 1, uncertainties: [] },
    { id: 'scene-002', name: '内置键盘', category: 'electronics', bbox: [50, 500, 550, 750], visibleQuantity: 1, visibleText: 'ENTER', uncertainties: ['是否可独立拆卸未知'] },
    { id: 'scene-003', name: '外接键盘', category: 'electronics', bbox: [650, 500, 950, 750], visibleQuantity: 1, uncertainties: [] }
  ], sceneNotes: [] },
  grouping: { version: 1, proposals: [{ parentId: 'scene-001', childIds: ['scene-002'], relation: 'integrated-part', evidence: '键盘位于同一笔记本机身内，边缘与机身连续。', applyByDefault: true }] }, ...overrides
});

test('明确默认应用的分组仅收起子卡，全部源候选与选中状态仍可撤销恢复', () => {
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

test('缺省或 false 的分组只提供建议，不自动吞掉独立物品', () => {
  for (const applyByDefault of [undefined, false]) {
    const r = groupedResponse({ grouping: { version: 1, proposals: [{ parentId: 'scene-001', childIds: ['scene-002'], relation: 'integrated-part', evidence: '仅有边界接近，需确认。', ...(applyByDefault === undefined ? {} : { applyByDefault }) }] } });
    assert.equal(D.effectiveItems(r).length, 3); assert.equal(batch(r).drafts.length, 3);
    D.setGrouping(r, 'candidate-0', true); assert.equal(batch(r).drafts.length, 2);
  }
});

test('无效引用、循环、重复父、重复子和多父均退回全部独立候选', () => {
  const p = { parentId: 'scene-001', childIds: ['scene-002'], relation: 'integrated-part', evidence: '连续机身', applyByDefault: true };
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
    assert.ok(r.sceneNotes.some(n => n.includes('保留全部独立候选')));
  }
});

test('重复源编号无法安全定位关系，保留全部候选并不接受分组', () => {
  const raw = { items: [ { id: 'same', name: 'A' }, { id: 'same', name: 'B' } ], sceneNotes: [] };
  const r = D.normalizeResponse({ data: raw, grouping: { version: 1, proposals: [{ parentId: 'same', childIds: ['same'], relation: 'same-object', evidence: '重叠', applyByDefault: true }] } });
  assert.equal(r.items.length, 2); assert.equal(r.grouping.proposals.length, 0);
  const saved = D.append(D.emptyStore(), batch(r));
  assert.equal(saved.drafts.length, 2); assert.notEqual(saved.drafts[0].sourceId, saved.drafts[1].sourceId);
});

test('分组草稿往返保留部件来源、可见文字、坐标、数量和依据，旧 v1 包仍可读', () => {
  const s = D.append(D.emptyStore(), batch(groupedResponse())), restored = D.parse(D.serialize(s));
  assert.equal(restored.drafts.length, 2); assert.equal(restored.drafts[0].components.length, 1);
  const c = restored.drafts[0].components[0];
  assert.equal(c.sourceId, 'scene-002'); assert.equal(c.visibleText, 'ENTER');
  assert.deepEqual(c.bbox, [50, 500, 550, 750]); assert.equal(c.visibleQuantity, 1);
  assert.match(c.evidence, /同一笔记本机身/); assert.deepEqual(restored, s);
  const old = D.append(D.emptyStore(), batch()); old.drafts.forEach(d => { delete d.sourceId; });
  assert.equal(D.parse(D.serialize(old)).drafts.length, 2);
});

test('部件不接受权限、任意关系、嵌套、非法边界与重复来源字段', () => {
  for (const mutate of [
    c => c.approval = 'approved', c => c.owner = 'owner', c => c.relation = 'borrowable',
    c => c.bbox = [0, 0, 1001, 99], c => c.visibleQuantity = 0,
    c => c.components = [], c => c.sourceId = 'scene-001'
  ]) {
    const s = D.append(D.emptyStore(), batch(groupedResponse())); mutate(s.drafts[0].components[0]);
    assert.throws(() => D.validateStore(s));
  }
  const s = D.append(D.emptyStore(), batch(groupedResponse())); s.drafts[0].components.push({ ...s.drafts[0].components[0] });
  assert.throws(() => D.validateStore(s), /重复/);
});

test('分组拆回仅创建一次未知状态草稿，原图模型和记录时间不变', () => {
  const s = D.append(D.emptyStore(), batch(groupedResponse())), parentId = s.drafts[0].id;
  const split = D.splitComponents(s, parentId), child = split.drafts.find(d => d.sourceId === 'scene-002');
  assert.equal(s.drafts.length, 2); assert.equal(split.drafts.length, 3); assert.equal(split.drafts[0].components, undefined);
  assert.equal(child.status, 'draft'); assert.equal(child.owner, null); assert.equal(child.condition, 'unknown');
  assert.equal(child.sharePermission, 'unknown'); assert.equal(child.approval, 'not-requested'); assert.equal(child.availability, 'unknown');
  assert.equal(child.sceneId, s.drafts[0].sceneId); assert.equal(child.createdAt, s.drafts[0].createdAt); assert.equal(child.model, s.drafts[0].model);
  assert.equal(split.scenes[0].originalImage, photo); assert.equal(child.visibleText, 'ENTER');
  assert.equal(D.splitComponents(split, parentId).drafts.length, 3);
  assert.equal(D.searchDrafts(s.drafts, '内置键盘').length, 1);
});

test('已转库存的父草稿拆部件仍只产生草稿，不继承库存编号', () => {
  const s = D.append(D.emptyStore(), batch(groupedResponse())); s.drafts[0].status = 'converted'; s.drafts[0].convertedItemId = 'inventory-123';
  const split = D.splitComponents(s, s.drafts[0].id), child = split.drafts.find(d => d.sourceId === 'scene-002');
  assert.equal(split.drafts[0].status, 'converted'); assert.equal(split.drafts[0].convertedItemId, 'inventory-123');
  assert.equal(child.status, 'draft'); assert.equal(child.convertedItemId, undefined); assert.equal(child.approval, 'not-requested');
});

test('合法多层关系保存所有后代，拆回时每个源候选只出现一次', () => {
  const r = groupedResponse({ grouping: { version: 1, proposals: [
    { parentId: 'scene-001', childIds: ['scene-002'], relation: 'integrated-part', evidence: '位于机身内', applyByDefault: true },
    { parentId: 'scene-002', childIds: ['scene-003'], relation: 'same-object', evidence: '测试嵌套关系的可逆状态', applyByDefault: true }
  ] } });
  assert.equal(D.effectiveItems(r).length, 1);
  const s = D.append(D.emptyStore(), batch(r)); assert.equal(s.drafts[0].components.length, 2);
  assert.equal(D.splitComponents(s, s.drafts[0].id).drafts.length, 3);
});

test('合法的 500 字分组依据仍可拆回，新增说明不超过 300 字且不截断表情字符', () => {
  for (const evidence of ['机身边缘连续。'.repeat(50), '一' + '😀'.repeat(249) + '末']) {
    const r = groupedResponse(); r.grouping.proposals[0].evidence = evidence;
    const s = D.append(D.emptyStore(), batch(r)), before = D.serialize(s);
    const split = D.splitComponents(s, s.drafts[0].id), child = split.drafts.find(d => d.sourceId === 'scene-002');
    const note = child.uncertainties.find(u => u.startsWith('从分组拆回：'));
    assert.ok(note); assert.ok(note.length <= 300); assert.doesNotMatch(note, /[\uD800-\uDBFF]$/);
    assert.equal(D.serialize(s), before); assert.equal(child.approval, 'not-requested');
    assert.equal(D.parse(D.serialize(split)).drafts.length, 3);
  }
});

test('拆回保留已有的 12 条待核实线索，不为新增说明丢弃源候选信息', () => {
  const r = groupedResponse(); r.items[1].uncertainties = Array.from({ length: 12 }, (_, i) => '原始线索 ' + i);
  const s = D.append(D.emptyStore(), batch(r)), split = D.splitComponents(s, s.drafts[0].id);
  assert.deepEqual(split.drafts.find(d => d.sourceId === 'scene-002').uncertainties, r.items[1].uncertainties);
});

test('用户否定子项裁切框后，合并保存、导出导入再拆回仍保留整张图', () => {
  const r = groupedResponse(); r.items[1].cropMode = 'original';
  const s = D.parse(D.serialize(D.append(D.emptyStore(), batch(r))));
  assert.equal(s.drafts[0].components[0].cropMode, 'original');
  const split = D.splitComponents(s, s.drafts[0].id), child = split.drafts.find(d => d.sourceId === 'scene-002');
  assert.equal(child.cropMode, 'original'); assert.deepEqual(child.bbox, r.items[1].bbox);
  assert.equal(child.thumbnail, ''); assert.equal(split.scenes[0].originalImage, photo);
});

test('旧部件包没有 cropMode 时，有框默认裁切，无框保留整图', () => {
  for (const box of [[50, 500, 550, 750], null]) {
    const s = D.append(D.emptyStore(), batch(groupedResponse())), c = s.drafts[0].components[0];
    delete c.cropMode; c.bbox = box;
    const restored = D.parse(D.serialize(s)), mode = box ? 'bbox' : 'original';
    assert.equal(restored.drafts[0].components[0].cropMode, mode);
    assert.equal(D.splitComponents(restored, restored.drafts[0].id).drafts.find(d => d.sourceId === 'scene-002').cropMode, mode);
  }
});

test('部件 cropMode 不接受未知值或没有框却要求裁切', () => {
  for (const mode of ['invented', null, 1, false]) {
    const s = D.append(D.emptyStore(), batch(groupedResponse())); s.drafts[0].components[0].cropMode = mode;
    assert.throws(() => D.validateStore(s), /部件/);
  }
  const s = D.append(D.emptyStore(), batch(groupedResponse()));
  s.drafts[0].components[0].bbox = null; s.drafts[0].components[0].cropMode = 'bbox';
  assert.throws(() => D.validateStore(s), /部件/);
});

const cloudMetadata = { backend: 'openai', provider: 'OpenAI(云)', localOnly: false, remoteProcessing: true };
const health = overrides => ({ service: 'waicy-resource-commons', modelAvailable: true, model: 'cloud-test-model', ...cloudMetadata, ...overrides });
test('只有身份与处理标记一致的 health 才允许发送；key 已配置不代表 API 已实测', () => {
  const cloud = D.normalizeServiceHealth(health({ apiVerified: false, availabilityCheck: 'configuration-only' }));
  assert.equal(cloud.known, true); assert.equal(cloud.ready, true); assert.equal(cloud.remoteProcessing, true);
  assert.match(D.processingNotice(cloud), /密钥已配置；连通性、额度与余额以实际请求为准/);
  for (const value of [null, {}, health({ service: 'other' }), health({ localOnly: true }), health({ remoteProcessing: false }), health({ backend: 'unknown' })]) {
    const s = D.normalizeServiceHealth(value); assert.equal(s.known, false); assert.equal(s.ready, false);
    assert.equal(s.localOnly, null); assert.match(D.processingNotice(s), /不会发送照片或需求文字/);
  }
});
test('本地新旧后端名称和未配置云密钥都有明确可用状态', () => {
  for (const backend of ['local', 'ollama']) {
    const local = D.normalizeServiceHealth(health({ backend, localOnly: true, remoteProcessing: false }));
    assert.equal(local.ready, true); assert.equal(local.backend, backend);
    assert.match(D.processingNotice(local), /交给本机模型处理/);
    assert.doesNotMatch(D.processingNotice(local), /发送至 OpenAI/);
  }
  const unavailable = D.normalizeServiceHealth(health({ modelAvailable: false }));
  assert.equal(unavailable.known, true); assert.equal(unavailable.ready, false);
  assert.match(D.processingNotice(unavailable), /密钥尚未配置/);
});
test('照片、单件和需求文字入口分别提示发送内容、费用和浏览器存储边界', () => {
  const service = D.normalizeServiceHealth(health());
  for (const [kind, content] of [['scene', '压缩照片及需要时的局部裁切'], ['item', '照片与填写的文字线索'], ['request', '需求文字']]) {
    const notice = D.processingNotice(service, kind); assert.ok(notice.includes(content));
    assert.match(notice, /发送至 OpenAI/); assert.match(notice, /可能产生 API 费用/);
    assert.match(notice, /记录仍保存在当前浏览器/); assert.match(notice, /不是云端共享库存/);
  }
});
test('云响应保留真实处理元数据，保存不依赖调用方传入 local-ai 默认值', () => {
  const result = groupedResponse({ ...cloudMetadata });
  assert.equal(result.source, 'cloud-ai'); assert.equal(result.backend, 'openai'); assert.equal(result.provider, 'OpenAI(云)');
  const b = D.createBatch({ result, originalImage: photo, width: 1200, height: 800 });
  assert.equal(b.scene.source, 'cloud-ai'); assert.equal(b.scene.backend, 'openai');
  assert.equal(b.scene.localOnly, false); assert.equal(b.scene.remoteProcessing, true);
  assert.equal(b.scene.isSynthetic, null); assert.equal(b.drafts[0].isSynthetic, null);
  assert.equal(b.drafts[0].sharePermission, 'unknown'); assert.equal(b.drafts[0].approval, 'not-requested');
  assert.throws(() => D.createBatch({ result, originalImage: photo, width: 1200, height: 800, source: 'local-ai' }), /来源不一致/);
});
test('云来源导出导入和拆部件保留来源、模型与未知真实性，不转成共享许可', () => {
  const result = groupedResponse({ ...cloudMetadata });
  const original = D.append(D.emptyStore(), D.createBatch({ result, originalImage: photo, width: 1200, height: 800 }));
  const restored = D.parse(D.serialize(original)), split = D.splitComponents(restored, restored.drafts[0].id);
  assert.deepEqual(restored, original); assert.equal(split.scenes[0].source, 'cloud-ai');
  assert.equal(split.scenes[0].provider, 'OpenAI(云)'); assert.equal(split.scenes[0].remoteProcessing, true);
  assert.ok(split.drafts.every(d => d.isSynthetic === null && d.sharePermission === 'unknown' && d.approval === 'not-requested'));
  assert.equal(split.drafts.find(d => d.sourceId === 'scene-002').model, result.model);
});
test('旧 local-ai 和 preset-demo 草稿保持可读；缺失推理元数据不会伪造云调用证明', () => {
  const old = D.append(D.emptyStore(), batch());
  assert.equal(D.parse(D.serialize(old)).scenes[0].source, 'local-ai');
  assert.equal(D.parse(D.serialize(old)).scenes[0].backend, undefined);
  const demo = D.append(D.emptyStore(), D.createBatch({ result: response(), originalImage: photo, width: 1200, height: 800, source: 'preset-demo' }));
  assert.equal(D.parse(D.serialize(demo)).scenes[0].isSynthetic, true);
  assert.equal(response().source, null);
});
test('导入矛盾处理来源或批准字段被拒绝；云标签不证明图片实拍', () => {
  const make = () => D.append(D.emptyStore(), D.createBatch({ result: groupedResponse({ ...cloudMetadata }), originalImage: photo, width: 1200, height: 800 }));
  for (const mutate of [s => s.scenes[0].source = 'local-ai', s => s.scenes[0].localOnly = true, s => s.scenes[0].remoteProcessing = false, s => s.scenes[0].backend = 'ollama', s => s.drafts[0].approval = 'approved']) {
    const s = make(); mutate(s); assert.throws(() => D.validateStore(s));
  }
  const s = make(); s.scenes[0].isSynthetic = false; s.drafts[0].isSynthetic = false;
  const restored = D.validateStore(s); assert.equal(restored.scenes[0].isSynthetic, null); assert.equal(restored.drafts[0].isSynthetic, null);
});

const publicPhoto = { author: 'Alan Quirván', pageUrl: 'https://www.pexels.com/photo/laptop-notebooks-and-pens-on-white-desk-14541073/', licenseUrl: 'https://www.pexels.com/license/' };
test('公开照片演示保存独立示意小图、同源原图及署名，往返后仍无共享批准', () => {
  const r = response(), illustration = 'data:image/jpeg;base64,ZGVtbw==';
  const b = D.createBatch({ result: r, originalImage: photo, width: 1200, height: 800, source: 'public-photo-demo', publicPhoto, thumbnails: { [r.items[0].id]: illustration } });
  const restored = D.parse(D.serialize(D.append(D.emptyStore(), b)));
  assert.equal(restored.scenes[0].source, 'public-photo-demo');
  assert.deepEqual(restored.scenes[0].publicPhoto, publicPhoto);
  assert.equal(restored.scenes[0].originalImage, photo);
  assert.equal(restored.drafts[0].thumbnail, illustration);
  assert.equal(restored.scenes[0].isSynthetic, null, '来源标签不作为图像真实性证明');
  assert.equal(restored.drafts[0].approval, 'not-requested');
  assert.equal(restored.drafts[0].sharePermission, 'unknown');
  assert.equal(restored.drafts[0].owner, null);
  assert.equal(restored.drafts[1].visibleQuantity, null);
});
test('公开照片演示拒绝缺失署名、脚本链接和伪造云调用标记', () => {
  const make = data => D.createBatch({ result: response(), originalImage: photo, width: 1200, height: 800, source: 'public-photo-demo', publicPhoto: data });
  for (const data of [undefined, { ...publicPhoto, author: '' }, { ...publicPhoto, pageUrl: 'javascript:alert(1)' }, { ...publicPhoto, licenseUrl: 'https://example.com/\"onclick=bad' }]) assert.throws(() => make(data), /来源链接/);
  const s = D.append(D.emptyStore(), make(publicPhoto));
  Object.assign(s.scenes[0], { backend: 'openai', provider: 'OpenAI', localOnly: false, remoteProcessing: true });
  assert.throws(() => D.validateStore(s), /来源与处理服务标记不一致/);
});
test('新照片演示与旧插画示例来源保持独立，不改写原来的插画事实', () => {
  const b = D.createBatch({ result: response(), originalImage: photo, width: 1200, height: 800, source: 'preset-demo' });
  const s = D.parse(D.serialize(D.append(D.emptyStore(), b)));
  assert.equal(s.scenes[0].source, 'preset-demo'); assert.equal(s.scenes[0].isSynthetic, true);
  assert.equal(s.scenes[0].publicPhoto, undefined); assert.equal(s.drafts[0].isSynthetic, true);
});
