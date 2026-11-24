'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./engine.js');
const item = (s, id) => s.items.find(i => i.id === id);
const action = (s, key) => E.buildPlan(s).actions.find(a => a.key === key);

test('初始需求：两套已保障，一套为规格未知的组合候选', () => {
  const p = E.buildPlan(E.seed());
  assert.equal(p.total, 3); assert.equal(p.secured, 2); assert.equal(p.unsecured, 1);
  assert.equal(p.needs[0].pending, 1); assert.equal(p.actions[0].key, 'spec:c1:maxWidthMm');
});
test('补充合格规格后，已有批准与预约的组合成为已保障', () => {
  let s = E.seed(); s = E.applyAction(s, action(s, 'spec:c1:maxWidthMm'), 'verified', 90);
  assert.equal(E.buildPlan(s).secured, 3); assert.equal(E.buildPlan(s).actions.length, 0);
});
test('不合格规格排除组合，改用其他待核实候选', () => {
  let s = E.seed(); s = E.applyAction(s, action(s, 'spec:c1:maxWidthMm'), 'verified', 60);
  const p = E.buildPlan(s); assert.equal(p.secured, 2);
  assert.ok(p.allocations.some(a => a.candidate.parts.some(i => i.id === 's2')));
  assert.ok(!p.allocations.some(a => a.candidate.parts.some(i => i.id === 'c1')));
});
test('允许申请不是批准：位置与规格齐全的未批物品仍未保障', () => {
  const s = E.seed(); s.items = [item(s, 's2')]; s.items[0].positionStatus = 'confirmed';
  assert.equal(E.buildPlan(s).secured, 0); assert.equal(E.buildPlan(s).needs[0].pending, 1);
});
test('禁止共享物品不能参与匹配或产生批准动作', () => {
  const s = E.seed(); s.items = [item(s, 's3')]; const p = E.buildPlan(s);
  assert.equal(p.allocations.length, 0); assert.equal(p.actions.length, 0); assert.equal(p.unsecured, 3);
});
test('所需时段的冲突库存被排除；相邻时段不算重叠', () => {
  const s = E.seed(), i = item(s, 's4'); assert.equal(E.freeQuantity(i, s.request), 0);
  s.request.start = '2026-11-05T18:00'; s.request.end = '2026-11-05T19:00';
  assert.equal(E.freeQuantity(i, s.request), 1);
});
test('部分预约只占对应数量，不把整条库存全部隐藏', () => {
  const s = E.seed(), i = item(s, 's4'); i.quantity = 3;
  assert.equal(E.freeQuantity(i, s.request), 2);
});
test('生活案例：分时借出的椅子按同时占用峰值扣除，交接端点不叠加', () => {
  const s = E.seed(), i = item(s, 'h1');
  s.request.start = '2026-11-07T10:00'; s.request.end = '2026-11-07T12:00';
  i.reservations = [
    { requestId: 'morning', approved: true, quantity: 2, start: '2026-11-07T10:00', end: '2026-11-07T11:00' },
    { requestId: 'noon', approved: true, quantity: 3, start: '2026-11-07T11:00', end: '2026-11-07T12:00' }
  ];
  assert.equal(E.freeQuantity(i, s.request), 3);
  i.reservations.reverse(); assert.equal(E.freeQuantity(i, s.request), 3);
});
test('生活案例：真实重叠仍累计占用，区间外与未批准预约不占用', () => {
  const s = E.seed(), i = item(s, 'h1');
  s.request.start = '2026-11-07T10:00'; s.request.end = '2026-11-07T12:00';
  i.reservations = [
    { requestId: 'a', approved: true, quantity: 2, start: '2026-11-07T09:00', end: '2026-11-07T11:30' },
    { requestId: 'b', approved: true, quantity: 3, start: '2026-11-07T11:00', end: '2026-11-07T13:00' },
    { requestId: 'c', approved: false, quantity: 6, start: '2026-11-07T10:00', end: '2026-11-07T12:00' },
    { requestId: 'd', approved: true, quantity: 6, start: '2026-11-07T12:00', end: '2026-11-07T14:00' }
  ];
  assert.equal(E.freeQuantity(i, s.request), 1);
  assert.equal(E.freeQuantity(i, { ...s.request, end: '2026-11-07T11:00' }), 4);
});
test('已有批准若不覆盖变更后的完整时段，不计入已保障', () => {
  const s = E.seed(); s.request.end = '2026-11-05T18:00';
  assert.equal(E.approvedQuantity(item(s, 's1'), s.request), 0); assert.equal(E.buildPlan(s).secured, 0);
});
test('先模拟批准，位置未核实仍不能算保障', () => {
  let s = E.seed(); s.items = [item(s, 's2')];
  s = E.applyAction(s, action(s, 'approve:s2'), 'approved');
  assert.equal(E.buildPlan(s).secured, 0);
  s = E.applyAction(s, action(s, 'locate:s2'), 'found', '已检查的活动室');
  assert.equal(E.buildPlan(s).secured, 1);
});
test('检查未找到只排除该线索，不篡改最后确认位置', () => {
  let s = E.seed(); const original = E.clone(item(s, 's2').lastConfirmed), first = action(s, 'locate:s2');
  s = E.applyAction(s, first, 'not-found');
  assert.deepEqual(item(s, 's2').lastConfirmed, original);
  assert.notEqual(action(s, 'locate:s2').place, first.place);
});
test('所有已有地点未找到后，动作改为询问位置', () => {
  let s = E.seed();
  while (action(s, 'locate:s2').place) s = E.applyAction(s, action(s, 'locate:s2'), 'not-found');
  assert.equal(action(s, 'locate:s2').place, ''); assert.equal(action(s, 'locate:s2').cost, 8);
});
test('拒借只针对本次需求，候选立即退出', () => {
  let s = E.seed(); s.items = [item(s, 's2')]; s = E.applyAction(s, action(s, 'approve:s2'), 'denied');
  assert.equal(E.buildPlan(s).allocations.length, 0);
  s.request.id = 'new-request'; assert.equal(E.blockReason(item(s, 's2'), s.request), '');
});
test('组合接口不兼容不能作为候选', () => {
  const s = E.seed(); item(s, 'c1').specs.connector = 'other';
  assert.ok(!E.candidates(s, s.request.needs[0]).some(c => c.parts.some(i => i.id === 'c1')));
});
test('禁止替代后，三脚架与夹头组合不会出现', () => {
  const s = E.seed(); s.request.allowAlternatives = false;
  assert.ok(E.candidates(s, s.request.needs[0]).every(c => c.parts.length === 1));
});
test('同一物品的总分配不超过可用数量，批准数量不会重复使用', () => {
  const s = E.seed(); s.request.needs[0].quantity = 4;
  item(s, 't1').quantity = 2; item(s, 'c1').specs.maxWidthMm = 90;
  const second = E.clone(item(s, 'c1')); second.id = 'c2'; second.name = '第二个夹头'; s.items.push(second);
  const p = E.buildPlan(s), totals = {}, secured = {};
  for (const a of p.allocations) for (const i of a.candidate.parts) { totals[i.id] = (totals[i.id] || 0) + a.quantity; secured[i.id] = (secured[i.id] || 0) + a.secured; }
  for (const i of s.items) { assert.ok((totals[i.id] || 0) <= E.freeQuantity(i, s.request)); assert.ok((secured[i.id] || 0) <= E.approvedQuantity(i, s.request)); }
  assert.equal(p.secured, 3); assert.equal(p.needs[0].pending, 1);
});
test('两种行动排序共享候选、数量与约束，不伪造效益', () => {
  const s = E.seed(), a = E.buildPlan(s, 'task'), b = E.buildPlan(s, 'inventory');
  assert.deepEqual(a.needs, b.needs); assert.deepEqual(a.blocked, b.blocked);
  assert.deepEqual(a.actions.map(x => x.key).sort(), b.actions.map(x => x.key).sort());
});
test('展示任务的板与架必须同时满足尺寸要求', () => {
  const s = E.seed(); s.request = E.clone(E.presets[1]); item(s, 'e1').specs.maxBoardWidthMm = 300;
  const p = E.buildPlan(s); assert.equal(p.needs.find(n => n.id === 'display').noCandidate, 2);
  assert.equal(p.needs.find(n => n.id === 'chair').pending, 6);
});
test('多需求逐步批准后可完整保障，组合物理件数与需求单位分开', () => {
  let s = E.seed(); s.request = E.clone(E.presets[1]);
  while (E.buildPlan(s).actions.length) { const a = E.buildPlan(s).actions[0]; assert.equal(a.type, 'approve'); s = E.applyAction(s, a, 'approved'); }
  const p = E.buildPlan(s); assert.equal(p.total, 8); assert.equal(p.secured, 8);
  assert.equal(p.allocations.reduce((sum, a) => sum + a.quantity * a.candidate.parts.length, 0), 10);
});
test('JSON 往返保留行为，所有记录必须为模拟数据', () => {
  const s = E.seed(); assert.deepEqual(E.validateState(JSON.parse(JSON.stringify(s))), s);
  s.items[0].isSynthetic = false; assert.throws(() => E.validateState(s));
});
test('导入拒绝重复 ID、非法类别、浮点库存、超量预约和脚本照片', () => {
  for (const mutate of [s => s.items.push(E.clone(s.items[0])), s => s.items[0].category = '__proto__', s => s.items[0].quantity = 1.5, s => s.items[0].reservations.push(E.clone(s.items[0].reservations[0])), s => s.items[0].photo = 'javascript:alert(1)', s => s.request.start = 'November 1 2026']) {
    const s = E.seed(); mutate(s); assert.throws(() => E.validateState(s));
  }
});
test('过期动作被拒绝，外部伪造字段不能绕过当前动作', () => {
  let s = E.seed(); const a = action(s, 'spec:c1:maxWidthMm');
  s = E.applyAction(s, { ...a, field: 'arbitrary' }, 'verified', 90);
  assert.equal(item(s, 'c1').specs.arbitrary, undefined); assert.equal(item(s, 'c1').specs.maxWidthMm, 90);
  assert.throws(() => E.applyAction(s, a, 'verified', 95));
});
test('空库存仍给出完整未保障需求而非误报成功', () => {
  const s = E.seed(); s.items = [];
  const p = E.buildPlan(s); assert.equal(p.secured, 0); assert.equal(p.unsecured, 3); assert.equal(p.actions.length, 0);
});
test('新增位置确认开启新搜索轮次，解除先前未找到地点的排除', () => {
  let s = E.seed(); const first = action(s, 'locate:s2');
  s = E.applyAction(s, first, 'not-found'); assert.ok(item(s, 's2').checkedPlaces.length);
  s = E.applyAction(s, action(s, 'locate:s2'), 'found', first.place);
  assert.deepEqual(item(s, 's2').checkedPlaces, []);
  assert.equal(item(s, 's2').lastConfirmed.place, first.place);
});
test('导入拒绝不存在的日期、时区后缀和不合法时分', () => {
  for (const invalid of ['2026-02-30T14:00', '2026-13-01T14:00', '2026-11-05T24:00', '2026-11-05T14:60', '2026-11-05T14:00Z', '2026-11-05T14:00+08:00']) {
    const s = E.seed(); s.request.start = invalid; assert.throws(() => E.validateState(s));
  }
});
test('用途或负责人变化后，旧批准不被冒用为本次保障', () => {
  const s = E.seed(); s.request.purpose = '改成另一项活动';
  assert.equal(E.buildPlan(s).secured, 0);
  const t = E.seed(); item(t, 's1').owner = '新的负责人';
  assert.equal(E.approvedQuantity(item(t, 's1'), t.request), 0);
  const u = E.seed(); delete item(u, 's1').reservations[0].purpose;
  assert.equal(E.approvedQuantity(item(u, 's1'), u.request), 0);
});

test('库存导出导入保留独立示意小图、真实原图与署名，旧示例形状不变', () => {
  const original = E.seed();
  assert.deepEqual(E.validateState(original), original);
  assert.equal(Object.hasOwn(E.validateState(original).items[0], 'thumbnail'), false);
  assert.equal(Object.hasOwn(E.validateState(original).items[0], 'publicPhoto'), false);
  const s = E.seed();
  s.items[0].photo = 'data:image/jpeg;base64,b3JpZ2luYWw=';
  s.items[0].thumbnail = 'data:image/jpeg;base64,c2NoZW1hdGlj';
  s.items[0].publicPhoto = { author: 'Alan Quirván', pageUrl: 'https://www.pexels.com/photo/laptop-notebooks-and-pens-on-white-desk-14541073/', licenseUrl: 'https://www.pexels.com/license/' };
  const restored = E.validateState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(restored, s);
  const plan = E.buildPlan(restored), baseline = E.buildPlan(original);
  assert.equal(plan.secured, baseline.secured);
  assert.equal(plan.unsecured, baseline.unsecured);
  assert.deepEqual(plan.actions.map(a => a.key), baseline.actions.map(a => a.key));
  assert.equal(restored.items[0].photo, s.items[0].photo);
  assert.notEqual(restored.items[0].photo, restored.items[0].thumbnail);
});
test('库存拒绝超大或非本地缩略图以及脚本署名链接', () => {
  for (const bad of ['javascript:alert(1)', 'https://example.com/photo.jpg', 'data:image/svg+xml;base64,YWJj', 'data:image/jpeg;base64,' + 'A'.repeat(250000), null]) {
    const s = E.seed(); s.items[0].thumbnail = bad;
    assert.throws(() => E.validateState(s), /缩略图/);
  }
  const valid = { author: '摄影师', pageUrl: 'https://example.com/photo', licenseUrl: 'https://example.com/license' };
  for (const bad of [null, {}, { ...valid, author: '' }, { ...valid, pageUrl: 'javascript:alert(1)' }, { ...valid, licenseUrl: 'https://example.com/\"onclick=bad' }]) {
    const s = E.seed(); s.items[0].publicPhoto = bad;
    assert.throws(() => E.validateState(s), /署名或来源链接/);
  }
});
