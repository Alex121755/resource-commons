'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./engine.js');
const item = (s, id) => s.items.find(i => i.id === id);
const action = (s, key) => E.buildPlan(s).actions.find(a => a.key === key);

test('Initial request has two secured sets and one candidate with unknown specifications', () => {
  const p = E.buildPlan(E.seed());
  assert.equal(p.total, 3); assert.equal(p.secured, 2); assert.equal(p.unsecured, 1);
  assert.equal(p.needs[0].pending, 1); assert.equal(p.actions[0].key, 'spec:c1:maxWidthMm');
});
test('A compatible measurement secures the already approved and reserved combination', () => {
  let s = E.seed(); s = E.applyAction(s, action(s, 'spec:c1:maxWidthMm'), 'verified', 90);
  assert.equal(E.buildPlan(s).secured, 3); assert.equal(E.buildPlan(s).actions.length, 0);
});
test('An incompatible measurement excludes a combination and selects another candidate', () => {
  let s = E.seed(); s = E.applyAction(s, action(s, 'spec:c1:maxWidthMm'), 'verified', 60);
  const p = E.buildPlan(s); assert.equal(p.secured, 2);
  assert.ok(p.allocations.some(a => a.candidate.parts.some(i => i.id === 's2')));
  assert.ok(!p.allocations.some(a => a.candidate.parts.some(i => i.id === 'c1')));
});
test('Requestable items need approval even with confirmed location and specifications', () => {
  const s = E.seed(); s.items = [item(s, 's2')]; s.items[0].positionStatus = 'confirmed';
  assert.equal(E.buildPlan(s).secured, 0); assert.equal(E.buildPlan(s).needs[0].pending, 1);
});
test('Private items produce neither matches nor approval actions', () => {
  const s = E.seed(); s.items = [item(s, 's3')]; const p = E.buildPlan(s);
  assert.equal(p.allocations.length, 0); assert.equal(p.actions.length, 0); assert.equal(p.unsecured, 3);
});
test('Overlapping reservations exclude unavailable stock while adjacent bookings do not', () => {
  const s = E.seed(), i = item(s, 's4'); assert.equal(E.freeQuantity(i, s.request), 0);
  s.request.start = '2026-11-05T18:00'; s.request.end = '2026-11-05T19:00';
  assert.equal(E.freeQuantity(i, s.request), 1);
});
test('Partial reservations reduce only the booked quantity', () => {
  const s = E.seed(), i = item(s, 's4'); i.quantity = 3;
  assert.equal(E.freeQuantity(i, s.request), 2);
});
test('Chair availability uses peak concurrent bookings and allows adjacent handoffs', () => {
  const s = E.seed(), i = item(s, 'h1');
  s.request.start = '2026-11-07T10:00'; s.request.end = '2026-11-07T12:00';
  i.reservations = [
    { requestId: 'morning', approved: true, quantity: 2, start: '2026-11-07T10:00', end: '2026-11-07T11:00' },
    { requestId: 'noon', approved: true, quantity: 3, start: '2026-11-07T11:00', end: '2026-11-07T12:00' }
  ];
  assert.equal(E.freeQuantity(i, s.request), 3);
  i.reservations.reverse(); assert.equal(E.freeQuantity(i, s.request), 3);
});
test('Only overlapping approved bookings reduce capacity', () => {
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
test('Approval must cover the entire revised period', () => {
  const s = E.seed(); s.request.end = '2026-11-05T18:00';
  assert.equal(E.approvedQuantity(item(s, 's1'), s.request), 0); assert.equal(E.buildPlan(s).secured, 0);
});
test('Approval alone does not secure an item with an unknown location', () => {
  let s = E.seed(); s.items = [item(s, 's2')];
  s = E.applyAction(s, action(s, 'approve:s2'), 'approved');
  assert.equal(E.buildPlan(s).secured, 0);
  s = E.applyAction(s, action(s, 'locate:s2'), 'found', 'Checked activity room');
  assert.equal(E.buildPlan(s).secured, 1);
});
test('An unsuccessful search preserves the last confirmed location', () => {
  let s = E.seed(); const original = E.clone(item(s, 's2').lastConfirmed), first = action(s, 'locate:s2');
  s = E.applyAction(s, first, 'not-found');
  assert.deepEqual(item(s, 's2').lastConfirmed, original);
  assert.notEqual(action(s, 'locate:s2').place, first.place);
});
test('After all locations have been checked the next action asks for a new lead', () => {
  let s = E.seed();
  while (action(s, 'locate:s2').place) s = E.applyAction(s, action(s, 'locate:s2'), 'not-found');
  assert.equal(action(s, 'locate:s2').place, ''); assert.equal(action(s, 'locate:s2').cost, 8);
});
test('A refusal removes candidates only from the current request', () => {
  let s = E.seed(); s.items = [item(s, 's2')]; s = E.applyAction(s, action(s, 'approve:s2'), 'denied');
  assert.equal(E.buildPlan(s).allocations.length, 0);
  s.request.id = 'new-request'; assert.equal(E.blockReason(item(s, 's2'), s.request), '');
});
test('Combinations with incompatible connectors are excluded', () => {
  const s = E.seed(); item(s, 'c1').specs.connector = 'other';
  assert.ok(!E.candidates(s, s.request.needs[0]).some(c => c.parts.some(i => i.id === 'c1')));
});
test('Disabling alternatives excludes tripod and clamp pairs', () => {
  const s = E.seed(); s.request.allowAlternatives = false;
  assert.ok(E.candidates(s, s.request.needs[0]).every(c => c.parts.length === 1));
});
test('Allocated stock and approvals cannot be counted twice', () => {
  const s = E.seed(); s.request.needs[0].quantity = 4;
  item(s, 't1').quantity = 2; item(s, 'c1').specs.maxWidthMm = 90;
  const second = E.clone(item(s, 'c1')); second.id = 'c2'; second.name = 'Second clamp'; s.items.push(second);
  const p = E.buildPlan(s), totals = {}, secured = {};
  for (const a of p.allocations) for (const i of a.candidate.parts) { totals[i.id] = (totals[i.id] || 0) + a.quantity; secured[i.id] = (secured[i.id] || 0) + a.secured; }
  for (const i of s.items) { assert.ok((totals[i.id] || 0) <= E.freeQuantity(i, s.request)); assert.ok((secured[i.id] || 0) <= E.approvedQuantity(i, s.request)); }
  assert.equal(p.secured, 3); assert.equal(p.needs[0].pending, 1);
});
test('Both action orderings use the same candidates, quantities, and constraints', () => {
  const s = E.seed(), a = E.buildPlan(s, 'task'), b = E.buildPlan(s, 'inventory');
  assert.deepEqual(a.needs, b.needs); assert.deepEqual(a.blocked, b.blocked);
  assert.deepEqual(a.actions.map(x => x.key).sort(), b.actions.map(x => x.key).sort());
});
test('Both a board and its easel must satisfy dimension requirements', () => {
  const s = E.seed(); s.request = E.clone(E.presets[1]); item(s, 'e1').specs.maxBoardWidthMm = 300;
  const p = E.buildPlan(s); assert.equal(p.needs.find(n => n.id === 'display').noCandidate, 2);
  assert.equal(p.needs.find(n => n.id === 'chair').pending, 6);
});
test('Multiple needs can be secured and physical parts are counted separately', () => {
  let s = E.seed(); s.request = E.clone(E.presets[1]);
  while (E.buildPlan(s).actions.length) { const a = E.buildPlan(s).actions[0]; assert.equal(a.type, 'approve'); s = E.applyAction(s, a, 'approved'); }
  const p = E.buildPlan(s); assert.equal(p.total, 8); assert.equal(p.secured, 8);
  assert.equal(p.allocations.reduce((sum, a) => sum + a.quantity * a.candidate.parts.length, 0), 10);
});
test('JSON Round trips preserve behavior and require demo records', () => {
  const s = E.seed(); assert.deepEqual(E.validateState(JSON.parse(JSON.stringify(s))), s);
  s.items[0].isSynthetic = false; assert.throws(() => E.validateState(s));
});
test('Imports reject duplicate  ID, invalid categories, fractional stock, overbookings, and executable photo URLs', () => {
  for (const mutate of [s => s.items.push(E.clone(s.items[0])), s => s.items[0].category = '__proto__', s => s.items[0].quantity = 1.5, s => s.items[0].reservations.push(E.clone(s.items[0].reservations[0])), s => s.items[0].photo = 'javascript:alert(1)', s => s.request.start = 'November 1 2026']) {
    const s = E.seed(); mutate(s); assert.throws(() => E.validateState(s));
  }
});
test('Stale or forged actions cannot bypass current checks', () => {
  let s = E.seed(); const a = action(s, 'spec:c1:maxWidthMm');
  s = E.applyAction(s, { ...a, field: 'arbitrary' }, 'verified', 90);
  assert.equal(item(s, 'c1').specs.arbitrary, undefined); assert.equal(item(s, 'c1').specs.maxWidthMm, 90);
  assert.throws(() => E.applyAction(s, a, 'verified', 95));
});
test('Empty inventories report every need as outstanding', () => {
  const s = E.seed(); s.items = [];
  const p = E.buildPlan(s); assert.equal(p.secured, 0); assert.equal(p.unsecured, 3); assert.equal(p.actions.length, 0);
});
test('New location confirmation makes previously checked locations searchable again', () => {
  let s = E.seed(); const first = action(s, 'locate:s2');
  s = E.applyAction(s, first, 'not-found'); assert.ok(item(s, 's2').checkedPlaces.length);
  s = E.applyAction(s, action(s, 'locate:s2'), 'found', first.place);
  assert.deepEqual(item(s, 's2').checkedPlaces, []);
  assert.equal(item(s, 's2').lastConfirmed.place, first.place);
});
test('Imports reject invalid dates, time zones, hours, and minutes', () => {
  for (const invalid of ['2026-02-30T14:00', '2026-13-01T14:00', '2026-11-05T24:00', '2026-11-05T14:60', '2026-11-05T14:00Z', '2026-11-05T14:00+08:00']) {
    const s = E.seed(); s.request.start = invalid; assert.throws(() => E.validateState(s));
  }
});
test('Changing the purpose or owner invalidates previous approval', () => {
  const s = E.seed(); s.request.purpose = 'Changed event purpose';
  assert.equal(E.buildPlan(s).secured, 0);
  const t = E.seed(); item(t, 's1').owner = 'New contact';
  assert.equal(E.approvedQuantity(item(t, 's1'), t.request), 0);
  const u = E.seed(); delete item(u, 's1').reservations[0].purpose;
  assert.equal(E.approvedQuantity(item(u, 's1'), u.request), 0);
});

test('Inventory round trips preserve thumbnails, original photos, and credits', () => {
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
test('Inventory rejects oversized or remote thumbnails and unsafe credit URLs', () => {
  for (const bad of ['javascript:alert(1)', 'https://example.com/photo.jpg', 'data:image/svg+xml;base64,YWJj', 'data:image/jpeg;base64,' + 'A'.repeat(250000), null]) {
    const s = E.seed(); s.items[0].thumbnail = bad;
    assert.throws(() => E.validateState(s), /Thumbnail/);
  }
  const valid = { author: 'Photographer', pageUrl: 'https://example.com/photo', licenseUrl: 'https://example.com/license' };
  for (const bad of [null, {}, { ...valid, author: '' }, { ...valid, pageUrl: 'javascript:alert(1)' }, { ...valid, licenseUrl: 'https://example.com/\"onclick=bad' }]) {
    const s = E.seed(); s.items[0].publicPhoto = bad;
    assert.throws(() => E.validateState(s), /credit or source link/);
  }
});
