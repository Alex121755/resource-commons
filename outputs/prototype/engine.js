(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ResourceEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 1;
  const categories = { support: 'Phone stand', tripod: 'Tripod', clamp: 'Phone clamp', board: 'Display board', easel: 'Easel', chair: 'Chair', cable: 'Extension cord', electronics: 'Electronics', tools: 'Tools', stationery: 'Stationery', furniture: 'Furniture', containers: 'Containers and storage', other: 'Other items', unknown: 'Uncategorized item' };
  const recipeDefinitions = {
    phone: [{ id: 'support', label: 'Phone stand', parts: ['support'] }, { id: 'tripod-clamp', label: 'Tripod and phone clamp', parts: ['tripod', 'clamp'], alternative: true }],
    display: [{ id: 'board-easel', label: 'Display board and easel', parts: ['board', 'easel'] }],
    chair: [{ id: 'chair', label: 'Chair', parts: ['chair'] }]
  };
  const presets = [
    { id: 'film', title: 'Phone filming workshop', purpose: 'Three student groups are filming tabletop videos. Each group needs a stable phone support.', start: '2026-11-05T14:00', end: '2026-11-05T17:00', allowAlternatives: true, needs: [{ id: 'phone', label: 'Phone support kit', quantity: 3, phoneWidthMm: 80, phoneWeightG: 250 }] },
    { id: 'exhibit', title: 'Club exhibition', purpose: 'Set up two display stations and provide seats for six participants.', start: '2026-11-06T13:00', end: '2026-11-06T18:00', allowAlternatives: true, needs: [{ id: 'display', label: 'Display kit', quantity: 2 }, { id: 'chair', label: 'Chair', quantity: 6 }] },
    { id: 'meet', title: 'After-school presentation', purpose: 'A small group needs one display board and four chairs after school.', start: '2026-11-05T16:00', end: '2026-11-05T18:00', allowAlternatives: true, needs: [{ id: 'display', label: 'Display kit', quantity: 1 }, { id: 'chair', label: 'Chair', quantity: 4 }] }
  ];
  const clone = x => JSON.parse(JSON.stringify(x));
  const overlap = (a, b) => a.start < b.end && b.start < a.end;
  function seed() {
    const request = clone(presets[0]);
    const item = (id, name, category, quantity, owner, place, extra = {}) => ({ id, isSynthetic: true, name, category, quantity, owner, condition: 'good', share: 'request', specs: {}, lastConfirmed: { place, at: '2026-11-02T09:00', by: owner }, positionStatus: 'confirmed', history: [{ place, kind: 'confirmed', at: '2026-11-02T09:00' }], checkedPlaces: [], reservations: [], deniedFor: [], photo: '', note: '', ...extra });
    const reservation = q => ({ requestId: 'film', start: request.start, end: request.end, quantity: q, approved: true, source: 'simulation', purpose: request.purpose, approvedBy: 'Photography club · Lin' });
    return { version: VERSION, isSynthetic: true, request, events: [], items: [
      item('s1', 'Desktop phone stand', 'support', 2, 'Photography club · Lin', 'Equipment cabinet A / Middle shelf', { specs: { maxWidthMm: 90, maxWeightG: 500 }, reservations: [reservation(2)], note: 'The demo owner has approved and reserved this item for the workshop.' }),
      item('t1', 'Lightweight tripod', 'tripod', 1, 'Photography club · Lin', 'Equipment cabinet A / Lower shelf', { specs: { connector: 'quarter-inch', maxWeightG: 1000 }, reservations: [reservation(1)] }),
      item('c1', 'Universal phone clamp', 'clamp', 1, 'Photography club · Lin', 'Equipment cabinet A / Accessory box', { specs: { connector: 'quarter-inch', maxWidthMm: null, maxWeightG: 300 }, reservations: [reservation(1)], note: 'The packaging is missing. Measure the jaws to verify the maximum width.' }),
      item('s2', 'Folding phone stand', 'support', 1, 'Publicity team · Zhou', 'Activity room / Blue storage bin', { specs: { maxWidthMm: 100, maxWeightG: 400 }, positionStatus: 'uncertain', lastConfirmed: { place: 'Activity room / Blue storage bin', at: '2026-10-22T16:00', by: 'Zhou' }, history: [{ place: 'Activity room / Blue storage bin', kind: 'confirmed', at: '2026-10-22T16:00' }, { place: 'Art room / Workbench', kind: 'activity', at: '2026-10-30T16:00' }, { place: 'Activity room / Blue storage bin', kind: 'returned', at: '2026-10-24T16:00' }], note: 'The stand was used at an event. Its return location still needs checking.' }),
      item('s3', 'Personal desk stand', 'support', 1, 'Chen', 'Personal backpack', { share: 'private', specs: { maxWidthMm: 100, maxWeightG: 500 }, note: 'A privately held item in the demo inventory.' }),
      item('s4', 'Livestream phone stand', 'support', 1, 'Broadcast club · Xu', 'Broadcast club / Equipment shelf', { specs: { maxWidthMm: 100, maxWeightG: 1000 }, reservations: [{ requestId: 'other-event', start: '2026-11-05T13:00', end: '2026-11-05T18:00', quantity: 1, approved: true, source: 'simulation', purpose: 'Broadcast event', approvedBy: 'Broadcast club · Xu' }] }),
      item('b1', 'A2 blank display board', 'board', 2, 'Art club · Wang', 'Art room / Supply cabinet', { specs: { widthMm: 420, heightMm: 594 }, note: 'Pair with an easel for freestanding display.' }),
      item('e1', 'Folding easel', 'easel', 2, 'Art club · Wang', 'Art room / Corner', { specs: { maxBoardWidthMm: 600, maxBoardHeightMm: 900 } }),
      item('h1', 'Folding chairs', 'chair', 6, 'Student council · Li', 'Assembly hall / Back storeroom'),
      item('p1', 'Three-meter extension cord', 'cable', 2, 'Student council · Li', 'Assembly hall / Toolbox', { note: 'Electrical safety and power ratings need a separate check.' })
    ] };
  }
  function freeQuantity(item, request) {
    // Stock must remain available for the whole requested interval. Separate
    // bookings at different times consume their peak concurrency, not their sum.
    const events = item.reservations.filter(r => r.approved && r.requestId !== request.id && overlap(r, request))
      .flatMap(r => [{ at: r.start < request.start ? request.start : r.start, delta: r.quantity },
        { at: r.end > request.end ? request.end : r.end, delta: -r.quantity }]);
    events.sort((a, b) => a.at.localeCompare(b.at) || a.delta - b.delta);
    let occupied = 0, peak = 0;
    for (const event of events) { occupied += event.delta; peak = Math.max(peak, occupied); }
    return Math.max(0, item.quantity - peak);
  }
  function approvedQuantity(item, request) {
    return Math.min(freeQuantity(item, request), item.reservations.filter(r => r.approved && r.requestId === request.id && r.purpose === request.purpose && r.approvedBy === item.owner && r.start <= request.start && r.end >= request.end).reduce((n, r) => n + r.quantity, 0));
  }
  function blockReason(item, request) {
    if (item.share === 'private') return 'Sharing disabled';
    if (item.deniedFor.includes(request.id)) return 'Loan declined for this request';
    if (item.condition !== 'good') return 'Item is out of service';
    if (!freeQuantity(item, request)) return 'Fully booked during this period';
    return '';
  }
  function predictions(item) {
    const weights = { confirmed: 3, returned: 3.5, activity: 2.5, borrowed: 1.5 };
    const mostRecent = Math.max(...item.history.map(h => Date.parse(h.at)).filter(Number.isFinite), Date.parse(item.lastConfirmed.at));
    const scored = new Map();
    for (const h of item.history) {
      const ageDays = Math.max(0, (mostRecent - Date.parse(h.at)) / 86400000);
      const val = (weights[h.kind] || 1) * Math.exp(-ageDays / 7);
      scored.set(h.place, (scored.get(h.place) || 0) + val);
    }
    if (!scored.size) scored.set(item.lastConfirmed.place, 1);
    return [...scored].filter(([p]) => !item.checkedPlaces.includes(p)).map(([place, score]) => ({ place, score })).sort((a, b) => b.score - a.score || a.place.localeCompare(b.place, 'en-US'));
  }
  function specCheck(parts, need) {
    const unknown = [];
    if (need.id === 'phone') {
      const holder = parts.find(p => p.category === 'support' || p.category === 'clamp');
      if (holder.specs.maxWidthMm == null) unknown.push({ itemId: holder.id, field: 'maxWidthMm', label: 'Maximum clamp width (mm)', min: need.phoneWidthMm });
      else if (holder.specs.maxWidthMm < need.phoneWidthMm) return { valid: false, reason: 'Clamp too narrow', unknown };
      for (const part of parts) {
        if (part.specs.maxWeightG == null) unknown.push({ itemId: part.id, field: 'maxWeightG', label: 'Maximum load (g)', min: need.phoneWeightG });
        else if (part.specs.maxWeightG < need.phoneWeightG) return { valid: false, reason: 'Load rating too low', unknown };
      }
      if (parts.length === 2) {
        for (const part of parts) if (!part.specs.connector) unknown.push({ itemId: part.id, field: 'connector', label: 'Connector', min: 'quarter-inch' });
        if (parts.every(p => p.specs.connector) && parts[0].specs.connector !== parts[1].specs.connector) return { valid: false, reason: 'Incompatible connectors', unknown };
      }
    }
    if (need.id === 'display') {
      const board = parts.find(p => p.category === 'board'), easel = parts.find(p => p.category === 'easel');
      for (const [part, field, label] of [[board, 'widthMm', 'Board width (mm)'], [board, 'heightMm', 'Board height (mm)'], [easel, 'maxBoardWidthMm', 'Maximum board width (mm)'], [easel, 'maxBoardHeightMm', 'Maximum board height (mm)']]) {
        if (part.specs[field] == null) unknown.push({ itemId: part.id, field, label, min: 1 });
      }
      if (!unknown.length && (board.specs.widthMm > easel.specs.maxBoardWidthMm || board.specs.heightMm > easel.specs.maxBoardHeightMm)) return { valid: false, reason: 'Board exceeds easel dimensions', unknown };
    }
    return { valid: true, unknown };
  }
  function cartesian(lists) { return lists.reduce((acc, list) => acc.flatMap(a => list.map(b => [...a, b])), [[]]); }
  function candidates(state, need) {
    const list = [];
    for (const recipe of recipeDefinitions[need.id] || []) {
      if (recipe.alternative && !state.request.allowAlternatives) continue;
      const sets = recipe.parts.map(category => state.items.filter(i => i.category === category && !blockReason(i, state.request)));
      for (const parts of cartesian(sets)) {
        const check = specCheck(parts, need);
        if (!check.valid) continue;
        const unknown = check.unknown;
        const positionUnknown = parts.filter(i => i.positionStatus !== 'confirmed');
        const max = Math.min(...parts.map(i => freeQuantity(i, state.request)));
        const securedMax = unknown.length || positionUnknown.length ? 0 : Math.min(...parts.map(i => approvedQuantity(i, state.request)));
        const missingApproval = parts.filter(i => approvedQuantity(i, state.request) < max);
        list.push({ key: recipe.id + ':' + parts.map(p => p.id).join('+'), label: recipe.label, parts, max, securedMax, unknown, positionUnknown, missingApproval, effort: unknown.length * 1 + positionUnknown.length * 3 + missingApproval.length * 2 });
      }
    }
    return list.sort((a, b) => b.securedMax - a.securedMax || a.effort - b.effort || a.key.localeCompare(b.key));
  }
  // Bounded beam search, not a claim of a globally optimal solver. All retained states
  // obey shared stock and approved-quantity capacities. Beam width limits import cost.
  function allocate(state) {
    const jobs = state.request.needs.map(need => ({ need, candidates: candidates(state, need) }));
    const initialCaps = Object.fromEntries(state.items.map(i => [i.id, freeQuantity(i, state.request)]));
    const entries = jobs.flatMap((j, index) => j.candidates.map(c => ({ ...c, needIndex: index })));
    let beam = [{ caps: initialCaps, approvedCaps: Object.fromEntries(state.items.map(i => [i.id, approvedQuantity(i, state.request)])), remaining: jobs.map(j => j.need.quantity), allocations: [], secured: 0, covered: 0, effort: 0, score: 0 }];
    for (const c of entries) {
      const expanded = [];
      for (const state of beam) {
        const max = Math.min(state.remaining[c.needIndex], c.max, ...c.parts.map(i => state.caps[i.id]));
        for (let q = max; q >= 0; q--) {
          const securedQ = Math.min(q, c.securedMax, ...c.parts.map(i => state.approvedCaps[i.id]));
          const caps = { ...state.caps }, approvedCaps = { ...state.approvedCaps }, remaining = [...state.remaining];
          for (const part of c.parts) { caps[part.id] -= q; approvedCaps[part.id] -= securedQ; }
          remaining[c.needIndex] -= q;
          const secured = state.secured + securedQ, covered = state.covered + q, effort = state.effort + (q ? c.effort + c.parts.length * 0.01 : 0);
          expanded.push({ caps, approvedCaps, remaining, allocations: q ? [...state.allocations, { candidate: c, quantity: q, secured: securedQ, pending: q - securedQ }] : state.allocations, secured, covered, effort, score: secured * 1000000 + covered * 10000 - effort });
        }
      }
      expanded.sort((a, b) => b.score - a.score);
      beam = expanded.slice(0, 96);
    }
    return { jobs, allocations: beam[0]?.allocations || [] };
  }
  function buildPlan(state, strategy = 'task') {
    const { jobs, allocations } = allocate(state);
    const needs = jobs.map((job, index) => {
      const rows = allocations.filter(a => a.candidate.needIndex === index);
      const secured = rows.reduce((n, a) => n + a.secured, 0), pending = rows.reduce((n, a) => n + a.pending, 0);
      return { ...job.need, secured, pending, unsecured: job.need.quantity - secured, noCandidate: job.need.quantity - secured - pending, allocations: rows };
    });
    const actionMap = new Map();
    function add(action, units, selected) {
      const prior = actionMap.get(action.key);
      if (prior) { prior.units = Math.max(prior.units, units); prior.selected ||= selected; return; }
      actionMap.set(action.key, { ...action, units, selected });
    }
    const chosen = new Map(allocations.map(a => [a.candidate.key, a]));
    for (const job of jobs) for (const c of job.candidates) {
      const selectedAllocation = chosen.get(c.key);
      const units = selectedAllocation ? selectedAllocation.pending : Math.min(c.max, job.need.quantity);
      if (!units && selectedAllocation) continue;
      const selected = !!selectedAllocation;
      for (const u of c.unknown) {
        const item = c.parts.find(p => p.id === u.itemId);
        add({ key: 'spec:' + u.itemId + ':' + u.field, type: 'spec', itemId: item.id, itemName: item.name, field: u.field, fieldLabel: u.label, min: u.min, title: item.name + ': verify ' + u.label.toLowerCase(), detail: 'Record a label or measurement for this specification.', cost: 2 }, units, selected);
      }
      for (const item of c.positionUnknown) {
        const next = predictions(item)[0];
        add({ key: 'locate:' + item.id, type: 'locate', itemId: item.id, itemName: item.name, place: next?.place || '', title: next ? 'Check ' + next.place + ' for the item' : 'Ask ' + item.owner + ' to confirm the location', detail: next ? 'Suggested from previous sightings. Verify in person.' : 'All known locations have been checked. Ask for a new lead.', cost: next ? 5 : 8 }, units, selected);
      }
      for (const item of c.parts) {
        const totalNeeded = allocations.filter(a => a.candidate.parts.some(p => p.id === item.id)).reduce((n, a) => n + a.quantity, 0);
        const qty = selected ? totalNeeded : Math.min(c.max, job.need.quantity);
        if (approvedQuantity(item, state.request) >= qty) continue;
        add({ key: 'approve:' + item.id, type: 'approve', itemId: item.id, itemName: item.name, quantity: qty, title: 'Ask ' + item.owner + ' to approve the loan', detail: item.name + ' × ' + qty + ' needs approval and a booking for these dates.', cost: 4 }, units, selected);
      }
    }
    const totalUnsecured = needs.reduce((n, i) => n + i.unsecured, 0);
    const actions = totalUnsecured ? [...actionMap.values()] : [];
    for (const a of actions) a.score = (a.selected ? 10 : 1) * Math.max(1, a.units) / a.cost;
    actions.sort(strategy === 'inventory' ? (a, b) => a.itemName.localeCompare(b.itemName, 'en-US') || a.key.localeCompare(b.key) : (a, b) => b.score - a.score || a.cost - b.cost || a.key.localeCompare(b.key));
    return { needs, allocations, actions, total: needs.reduce((n, i) => n + i.quantity, 0), secured: needs.reduce((n, i) => n + i.secured, 0), unsecured: totalUnsecured, blocked: state.items.filter(i => blockReason(i, state.request)).map(i => ({ id: i.id, name: i.name, reason: blockReason(i, state.request) })) };
  }
  function applyAction(state, action, outcome, value, timestamp = new Date().toISOString().slice(0, 16)) {
    const next = clone(state), item = next.items.find(i => i.id === action.itemId);
    if (!item) throw new Error('Item not found');
    const currentAction = buildPlan(next).actions.find(a => a.key === action.key);
    if (!currentAction) throw new Error('The plan has changed. Use a current check.');
    action = currentAction;
    if (action.type === 'spec') {
      if (action.field === 'connector') {
        if (!['quarter-inch', 'other'].includes(value)) throw new Error('Choose a connector');
        item.specs[action.field] = value;
      } else {
        const number = Number(value);
        if (!Number.isFinite(number) || number <= 0 || number > 100000) throw new Error('Enter a positive measurement');
        item.specs[action.field] = number;
      }
    } else if (action.type === 'locate') {
      if (outcome === 'not-found') {
        if (!action.place) throw new Error('No location to check');
        if (!item.checkedPlaces.includes(action.place)) item.checkedPlaces.push(action.place);
        item.positionStatus = 'uncertain';
      } else {
        const place = String(value || action.place).trim();
        if (!place || place.length > 120) throw new Error('Enter a confirmed location');
        item.lastConfirmed = { place, at: timestamp, by: 'Demo verifier' };
        item.positionStatus = 'confirmed'; item.checkedPlaces = [];
        item.history.push({ place, at: timestamp, kind: 'confirmed' }); item.history = item.history.slice(-100);
      }
    } else if (action.type === 'approve') {
      if (outcome === 'denied') item.deniedFor.push(next.request.id);
      else {
        if (blockReason(item, next.request)) throw new Error('This item cannot be reserved for these dates');
        const q = currentAction.quantity;
        if (!Number.isInteger(q) || q < 1 || q > freeQuantity(item, next.request)) throw new Error('Insufficient quantity');
        item.reservations = item.reservations.filter(r => r.requestId !== next.request.id);
        item.reservations.push({ requestId: next.request.id, start: next.request.start, end: next.request.end, quantity: q, approved: true, source: 'simulation', purpose: next.request.purpose, approvedBy: item.owner });
      }
    } else throw new Error('Unknown action');
    next.events.unshift({ at: timestamp, requestId: next.request.id, action: action.title, outcome, value: value == null ? '' : String(value), isSynthetic: true });
    next.events = next.events.slice(0, 200);
    return next;
  }
  const str = (v, max, name, empty = false) => { if (typeof v !== 'string' || v.length > max || (!empty && !v.trim())) throw new Error(name + ' has an invalid format'); return v; };
  const num = (v, max, name, min = 0) => { if (!Number.isFinite(v) || v < min || v > max) throw new Error(name + ' is out of range'); return v; };
  const date = (v, name) => {
    str(v, 32, name);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) throw new Error(name + ' must use YYYY-MM-DDTHH:mm local time');
    const [year, month, day, hour, minute] = v.split(/[-T:]/).map(Number);
    const check = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (year < 2000 || year > 2100 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59) throw new Error(name + ' is not a valid date or time');
    return v;
  };
  function validateState(input) {
    if (!input || input.version !== VERSION || input.isSynthetic !== true || !Array.isArray(input.items) || input.items.length > 30) throw new Error('Supported demo version: 1, up to 30 inventory items');
    const r = input.request;
    if (!r || !Array.isArray(r.needs) || r.needs.length < 1 || r.needs.length > 3) throw new Error('Invalid request structure');
    const request = { id: str(r.id, 80, 'Request ID'), title: str(r.title, 100, 'Request title'), purpose: str(r.purpose, 1000, 'Purpose', true), start: date(r.start, 'Start time'), end: date(r.end, 'End time'), allowAlternatives: r.allowAlternatives === true, needs: r.needs.map(n => { if (!n || !Object.hasOwn(recipeDefinitions, n.id) || !Number.isInteger(n.quantity)) throw new Error('Invalid request type or quantity'); return { id: n.id, label: str(n.label, 100, 'Request name'), quantity: num(n.quantity, 12, 'Requested quantity', 1), ...(n.id === 'phone' ? { phoneWidthMm: num(n.phoneWidthMm, 300, 'Phone width', 1), phoneWeightG: num(n.phoneWeightG, 2000, 'Phone weight', 1) } : {}) }; }) };
    if (request.start >= request.end || new Set(request.needs.map(n => n.id)).size !== request.needs.length) throw new Error('Invalid time range or duplicate request type');
    const allowedFields = ['maxWidthMm', 'maxWeightG', 'widthMm', 'heightMm', 'maxBoardWidthMm', 'maxBoardHeightMm', 'connector'];
    const items = input.items.map(i => {
      if (!i || i.isSynthetic !== true || !Object.hasOwn(categories, i.category) || !['good', 'repair'].includes(i.condition) || !['request', 'private'].includes(i.share) || !['confirmed', 'uncertain'].includes(i.positionStatus) || !Number.isInteger(i.quantity)) throw new Error('Invalid item structure');
      const specs = {};
      for (const key of allowedFields) if (i.specs && Object.hasOwn(i.specs, key)) specs[key] = i.specs[key] == null ? null : key === 'connector' ? str(i.specs[key], 50, 'Connector') : num(i.specs[key], 100000, 'Specifications', 0.01);
      if (!Array.isArray(i.history) || i.history.length > 100 || !Array.isArray(i.reservations) || i.reservations.length > 100 || !Array.isArray(i.checkedPlaces) || !Array.isArray(i.deniedFor)) throw new Error('Invalid item history');
      const photo = i.photo || '';
      if (typeof photo !== 'string' || photo.length > 1500000 || (photo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(photo))) throw new Error('Photo must be a local image within the size limit');
      const optionalMedia = {};
      if (i.thumbnail !== undefined) {
        if (typeof i.thumbnail !== 'string' || i.thumbnail.length > 250000 || (i.thumbnail && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(i.thumbnail))) throw new Error('Thumbnail must be a local image within the size limit');
        optionalMedia.thumbnail = i.thumbnail;
      }
      if (i.publicPhoto !== undefined) {
        const p = i.publicPhoto;
        if (!p || typeof p.author !== 'string' || !p.author.trim() || p.author.length > 120 || !['pageUrl', 'licenseUrl'].every(key => typeof p[key] === 'string' && p[key].length <= 500 && /^https:\/\/[^\s<>"']+$/.test(p[key]))) throw new Error('Invalid public photo credit or source link');
        optionalMedia.publicPhoto = { author: p.author, pageUrl: p.pageUrl, licenseUrl: p.licenseUrl };
      }
      return { id: str(i.id, 80, 'Item ID'), isSynthetic: true, name: str(i.name, 100, 'Name'), category: i.category, quantity: num(i.quantity, 30, 'Item quantity', 1), owner: str(i.owner, 100, 'Contact'), condition: i.condition, share: i.share, specs, positionStatus: i.positionStatus, lastConfirmed: { place: str(i.lastConfirmed?.place, 120, 'Confirmed location'), at: date(i.lastConfirmed?.at, 'Confirmed at'), by: str(i.lastConfirmed?.by, 100, 'Confirmed by') }, history: i.history.map(h => ({ place: str(h.place, 120, 'Previous location'), at: date(h.at, 'History timestamp'), kind: ['confirmed', 'returned', 'activity', 'borrowed'].includes(h.kind) ? h.kind : 'activity' })), checkedPlaces: i.checkedPlaces.slice(0, 100).map(p => str(p, 120, 'Checked location')), deniedFor: i.deniedFor.slice(0, 100).map(p => str(p, 80, 'Declined request')), reservations: i.reservations.map(v => { const rr = { requestId: str(v.requestId, 80, 'Reservation ID'), start: date(v.start, 'Reservation start'), end: date(v.end, 'Reservation end'), quantity: num(v.quantity, i.quantity, 'Reserved quantity', 1), approved: v.approved === true, source: 'simulation', purpose: str(v.purpose || '', 1000, 'Approved purpose', true), approvedBy: str(v.approvedBy || '', 100, 'Approved by', true) }; if (rr.start >= rr.end || !Number.isInteger(rr.quantity)) throw new Error('Invalid reservation dates or quantity'); return rr; }), photo, ...optionalMedia, note: str(i.note || '', 1000, 'Notes', true) };
    });
    if (new Set(items.map(i => i.id)).size !== items.length) throw new Error('Duplicate item ID');
    // Reject overbooked imported data rather than silently accepting impossible reservations.
    for (const i of items) for (const r of i.reservations.filter(x => x.approved)) {
      const simultaneous = i.reservations.filter(x => x.approved && x.start <= r.start && x.end > r.start).reduce((n, x) => n + x.quantity, 0);
      if (simultaneous > i.quantity) throw new Error(i.name + ' is overbooked');
    }
    const events = Array.isArray(input.events) ? input.events.slice(0, 200).map(e => ({ at: date(e.at, 'Event time'), requestId: str(e.requestId, 80, 'Event request'), action: str(e.action, 300, 'Event action'), outcome: str(e.outcome, 80, 'Event outcome'), value: str(e.value || '', 300, 'Event value', true), isSynthetic: true })) : [];
    return { version: VERSION, isSynthetic: true, request, items, events };
  }
  return { VERSION, categories, presets, seed, clone, overlap, freeQuantity, approvedQuantity, blockReason, predictions, specCheck, candidates, buildPlan, applyAction, validateState };
});
