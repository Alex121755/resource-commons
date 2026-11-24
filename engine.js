(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ResourceEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 1;
  const categories = { support: '手机支架', tripod: '三脚架', clamp: '手机夹', board: '展示板', easel: '画架', chair: '座椅', cable: '延长线', electronics: '电子设备（通用）', tools: '工具（通用）', stationery: '文具', furniture: '家具（通用）', containers: '容器与收纳', other: '其他物品', unknown: '待分类物品' };
  const recipeDefinitions = {
    phone: [{ id: 'support', label: '手机支架', parts: ['support'] }, { id: 'tripod-clamp', label: '三脚架＋手机夹', parts: ['tripod', 'clamp'], alternative: true }],
    display: [{ id: 'board-easel', label: '展示板＋画架', parts: ['board', 'easel'] }],
    chair: [{ id: 'chair', label: '座椅', parts: ['chair'] }]
  };
  const presets = [
    { id: 'film', title: '手机拍摄工作坊', purpose: '三组同学同时拍摄桌面短片，每组需要一套稳定的手机支撑。', start: '2026-11-05T14:00', end: '2026-11-05T17:00', allowAlternatives: true, needs: [{ id: 'phone', label: '手机支撑套装', quantity: 3, phoneWidthMm: 80, phoneWeightG: 250 }] },
    { id: 'exhibit', title: '社团展示日', purpose: '布置两个展示点，同时为六位参与者提供座位。', start: '2026-11-06T13:00', end: '2026-11-06T18:00', allowAlternatives: true, needs: [{ id: 'display', label: '展示套装', quantity: 2 }, { id: 'chair', label: '座椅', quantity: 6 }] },
    { id: 'meet', title: '小组讲解活动', purpose: '一块展示板配四个座位，用于放学后的小组讲解。', start: '2026-11-05T16:00', end: '2026-11-05T18:00', allowAlternatives: true, needs: [{ id: 'display', label: '展示套装', quantity: 1 }, { id: 'chair', label: '座椅', quantity: 4 }] }
  ];
  const clone = x => JSON.parse(JSON.stringify(x));
  const overlap = (a, b) => a.start < b.end && b.start < a.end;
  function seed() {
    const request = clone(presets[0]);
    const item = (id, name, category, quantity, owner, place, extra = {}) => ({ id, isSynthetic: true, name, category, quantity, owner, condition: 'good', share: 'request', specs: {}, lastConfirmed: { place, at: '2026-11-02T09:00', by: owner }, positionStatus: 'confirmed', history: [{ place, kind: 'confirmed', at: '2026-11-02T09:00' }], checkedPlaces: [], reservations: [], deniedFor: [], photo: '', note: '', ...extra });
    const reservation = q => ({ requestId: 'film', start: request.start, end: request.end, quantity: q, approved: true, source: 'simulation', purpose: request.purpose, approvedBy: '摄影社 · 林同学' });
    return { version: VERSION, isSynthetic: true, request, events: [], items: [
      item('s1', '桌面手机支架', 'support', 2, '摄影社 · 林同学', '器材柜 A / 第二层', { specs: { maxWidthMm: 90, maxWeightG: 500 }, reservations: [reservation(2)], note: '示例已模拟负责人批准，并为本次工作坊预留。' }),
      item('t1', '轻便三脚架', 'tripod', 1, '摄影社 · 林同学', '器材柜 A / 下层', { specs: { connector: 'quarter-inch', maxWeightG: 1000 }, reservations: [reservation(1)] }),
      item('c1', '通用手机夹', 'clamp', 1, '摄影社 · 林同学', '器材柜 A / 配件盒', { specs: { connector: 'quarter-inch', maxWidthMm: null, maxWeightG: 300 }, reservations: [reservation(1)], note: '包装已丢失，需要补拍标尺与夹口，核实最大夹持宽度。' }),
      item('s2', '折叠手机支架', 'support', 1, '宣传部 · 周同学', '综合活动室 / 蓝色收纳箱', { specs: { maxWidthMm: 100, maxWeightG: 400 }, positionStatus: 'uncertain', lastConfirmed: { place: '综合活动室 / 蓝色收纳箱', at: '2026-10-22T16:00', by: '周同学' }, history: [{ place: '综合活动室 / 蓝色收纳箱', kind: 'confirmed', at: '2026-10-22T16:00' }, { place: '美术教室 / 工作台', kind: 'activity', at: '2026-10-30T16:00' }, { place: '综合活动室 / 蓝色收纳箱', kind: 'returned', at: '2026-10-24T16:00' }], note: '活动使用后尚未确认归位；预测不会覆盖最后确认位置。' }),
      item('s3', '私人桌面支架', 'support', 1, '陈同学', '个人书包', { share: 'private', specs: { maxWidthMm: 100, maxWeightG: 500 }, note: '仅作为“存在但不能共享”的测试记录；真实系统中是否可见应另设权限。' }),
      item('s4', '直播手机支架', 'support', 1, '广播站 · 许同学', '广播站 / 设备架', { specs: { maxWidthMm: 100, maxWeightG: 1000 }, reservations: [{ requestId: 'other-event', start: '2026-11-05T13:00', end: '2026-11-05T18:00', quantity: 1, approved: true, source: 'simulation', purpose: '广播站活动', approvedBy: '广播站 · 许同学' }] }),
      item('b1', 'A2 空白展示板', 'board', 2, '美术社 · 王同学', '美术教室 / 材料柜', { specs: { widthMm: 420, heightMm: 594 }, note: '须与画架组合才能独立展示。' }),
      item('e1', '折叠画架', 'easel', 2, '美术社 · 王同学', '美术教室 / 角落', { specs: { maxBoardWidthMm: 600, maxBoardHeightMm: 900 } }),
      item('h1', '折叠椅', 'chair', 6, '学生会 · 李同学', '多功能厅 / 后储物间'),
      item('p1', '三米延长线', 'cable', 2, '学生会 · 李同学', '多功能厅 / 工具箱', { note: '本版需求模板暂不支持电气安全与功率匹配，不参与自动组合。' })
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
    if (item.share === 'private') return '不允许共享';
    if (item.deniedFor.includes(request.id)) return '本次借用被拒绝';
    if (item.condition !== 'good') return '状态不适合使用';
    if (!freeQuantity(item, request)) return '所需时段已被其他活动预留';
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
    return [...scored].filter(([p]) => !item.checkedPlaces.includes(p)).map(([place, score]) => ({ place, score })).sort((a, b) => b.score - a.score || a.place.localeCompare(b.place, 'zh-CN'));
  }
  function specCheck(parts, need) {
    const unknown = [];
    if (need.id === 'phone') {
      const holder = parts.find(p => p.category === 'support' || p.category === 'clamp');
      if (holder.specs.maxWidthMm == null) unknown.push({ itemId: holder.id, field: 'maxWidthMm', label: '最大夹持宽度（毫米）', min: need.phoneWidthMm });
      else if (holder.specs.maxWidthMm < need.phoneWidthMm) return { valid: false, reason: '夹持宽度不足', unknown };
      for (const part of parts) {
        if (part.specs.maxWeightG == null) unknown.push({ itemId: part.id, field: 'maxWeightG', label: '最大承重（克）', min: need.phoneWeightG });
        else if (part.specs.maxWeightG < need.phoneWeightG) return { valid: false, reason: '承重不足', unknown };
      }
      if (parts.length === 2) {
        for (const part of parts) if (!part.specs.connector) unknown.push({ itemId: part.id, field: 'connector', label: '连接接口', min: 'quarter-inch' });
        if (parts.every(p => p.specs.connector) && parts[0].specs.connector !== parts[1].specs.connector) return { valid: false, reason: '连接接口不兼容', unknown };
      }
    }
    if (need.id === 'display') {
      const board = parts.find(p => p.category === 'board'), easel = parts.find(p => p.category === 'easel');
      for (const [part, field, label] of [[board, 'widthMm', '板宽（毫米）'], [board, 'heightMm', '板高（毫米）'], [easel, 'maxBoardWidthMm', '支持的最大板宽（毫米）'], [easel, 'maxBoardHeightMm', '支持的最大板高（毫米）']]) {
        if (part.specs[field] == null) unknown.push({ itemId: part.id, field, label, min: 1 });
      }
      if (!unknown.length && (board.specs.widthMm > easel.specs.maxBoardWidthMm || board.specs.heightMm > easel.specs.maxBoardHeightMm)) return { valid: false, reason: '展示板尺寸超出画架范围', unknown };
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
        add({ key: 'spec:' + u.itemId + ':' + u.field, type: 'spec', itemId: item.id, itemName: item.name, field: u.field, fieldLabel: u.label, min: u.min, title: '核实' + item.name + '的' + u.label, detail: '补拍标签或测量记录；当前没有这一规格证据。', cost: 2 }, units, selected);
      }
      for (const item of c.positionUnknown) {
        const next = predictions(item)[0];
        add({ key: 'locate:' + item.id, type: 'locate', itemId: item.id, itemName: item.name, place: next?.place || '', title: next ? '去' + next.place + '检查' : '向' + item.owner + '确认位置', detail: next ? '历史加权排序，未确认物品现在就在这里。' : '已列出的地点均未找到，需要新的位置线索。', cost: next ? 5 : 8 }, units, selected);
      }
      for (const item of c.parts) {
        const totalNeeded = allocations.filter(a => a.candidate.parts.some(p => p.id === item.id)).reduce((n, a) => n + a.quantity, 0);
        const qty = selected ? totalNeeded : Math.min(c.max, job.need.quantity);
        if (approvedQuantity(item, state.request) >= qty) continue;
        add({ key: 'approve:' + item.id, type: 'approve', itemId: item.id, itemName: item.name, quantity: qty, title: '向' + item.owner + '确认借用', detail: item.name + ' × ' + qty + '，需要本次时段批准并预留。', cost: 4 }, units, selected);
      }
    }
    const totalUnsecured = needs.reduce((n, i) => n + i.unsecured, 0);
    const actions = totalUnsecured ? [...actionMap.values()] : [];
    for (const a of actions) a.score = (a.selected ? 10 : 1) * Math.max(1, a.units) / a.cost;
    actions.sort(strategy === 'inventory' ? (a, b) => a.itemName.localeCompare(b.itemName, 'zh-CN') || a.key.localeCompare(b.key) : (a, b) => b.score - a.score || a.cost - b.cost || a.key.localeCompare(b.key));
    return { needs, allocations, actions, total: needs.reduce((n, i) => n + i.quantity, 0), secured: needs.reduce((n, i) => n + i.secured, 0), unsecured: totalUnsecured, blocked: state.items.filter(i => blockReason(i, state.request)).map(i => ({ id: i.id, name: i.name, reason: blockReason(i, state.request) })) };
  }
  function applyAction(state, action, outcome, value, timestamp = new Date().toISOString().slice(0, 16)) {
    const next = clone(state), item = next.items.find(i => i.id === action.itemId);
    if (!item) throw new Error('物品不存在');
    const currentAction = buildPlan(next).actions.find(a => a.key === action.key);
    if (!currentAction) throw new Error('该动作已过期，请使用重新计算后的建议');
    action = currentAction;
    if (action.type === 'spec') {
      if (action.field === 'connector') {
        if (!['quarter-inch', 'other'].includes(value)) throw new Error('请选择接口');
        item.specs[action.field] = value;
      } else {
        const number = Number(value);
        if (!Number.isFinite(number) || number <= 0 || number > 100000) throw new Error('请输入有效的正数规格');
        item.specs[action.field] = number;
      }
    } else if (action.type === 'locate') {
      if (outcome === 'not-found') {
        if (!action.place) throw new Error('没有可检查的地点');
        if (!item.checkedPlaces.includes(action.place)) item.checkedPlaces.push(action.place);
        item.positionStatus = 'uncertain';
      } else {
        const place = String(value || action.place).trim();
        if (!place || place.length > 120) throw new Error('请输入确认地点');
        item.lastConfirmed = { place, at: timestamp, by: '演示核实者' };
        item.positionStatus = 'confirmed'; item.checkedPlaces = [];
        item.history.push({ place, at: timestamp, kind: 'confirmed' }); item.history = item.history.slice(-100);
      }
    } else if (action.type === 'approve') {
      if (outcome === 'denied') item.deniedFor.push(next.request.id);
      else {
        if (blockReason(item, next.request)) throw new Error('该物品不能在本次时段预留');
        const q = currentAction.quantity;
        if (!Number.isInteger(q) || q < 1 || q > freeQuantity(item, next.request)) throw new Error('可用数量不足');
        item.reservations = item.reservations.filter(r => r.requestId !== next.request.id);
        item.reservations.push({ requestId: next.request.id, start: next.request.start, end: next.request.end, quantity: q, approved: true, source: 'simulation', purpose: next.request.purpose, approvedBy: item.owner });
      }
    } else throw new Error('未知动作');
    next.events.unshift({ at: timestamp, requestId: next.request.id, action: action.title, outcome, value: value == null ? '' : String(value), isSynthetic: true });
    next.events = next.events.slice(0, 200);
    return next;
  }
  const str = (v, max, name, empty = false) => { if (typeof v !== 'string' || v.length > max || (!empty && !v.trim())) throw new Error(name + '格式不正确'); return v; };
  const num = (v, max, name, min = 0) => { if (!Number.isFinite(v) || v < min || v > max) throw new Error(name + '超出范围'); return v; };
  const date = (v, name) => {
    str(v, 32, name);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) throw new Error(name + '应为 YYYY-MM-DDTHH:mm 本地时间');
    const [year, month, day, hour, minute] = v.split(/[-T:]/).map(Number);
    const check = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (year < 2000 || year > 2100 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59) throw new Error(name + '不是有效日历时间');
    return v;
  };
  function validateState(input) {
    if (!input || input.version !== VERSION || input.isSynthetic !== true || !Array.isArray(input.items) || input.items.length > 30) throw new Error('仅支持版本 1、最多 30 条物品的模拟数据包');
    const r = input.request;
    if (!r || !Array.isArray(r.needs) || r.needs.length < 1 || r.needs.length > 3) throw new Error('需求结构不正确');
    const request = { id: str(r.id, 80, '需求编号'), title: str(r.title, 100, '需求标题'), purpose: str(r.purpose, 1000, '用途', true), start: date(r.start, '开始时间'), end: date(r.end, '结束时间'), allowAlternatives: r.allowAlternatives === true, needs: r.needs.map(n => { if (!n || !Object.hasOwn(recipeDefinitions, n.id) || !Number.isInteger(n.quantity)) throw new Error('需求类型或数量不正确'); return { id: n.id, label: str(n.label, 100, '需求名称'), quantity: num(n.quantity, 12, '需求数量', 1), ...(n.id === 'phone' ? { phoneWidthMm: num(n.phoneWidthMm, 300, '手机宽度', 1), phoneWeightG: num(n.phoneWeightG, 2000, '手机重量', 1) } : {}) }; }) };
    if (request.start >= request.end || new Set(request.needs.map(n => n.id)).size !== request.needs.length) throw new Error('需求时间或重复类型不正确');
    const allowedFields = ['maxWidthMm', 'maxWeightG', 'widthMm', 'heightMm', 'maxBoardWidthMm', 'maxBoardHeightMm', 'connector'];
    const items = input.items.map(i => {
      if (!i || i.isSynthetic !== true || !Object.hasOwn(categories, i.category) || !['good', 'repair'].includes(i.condition) || !['request', 'private'].includes(i.share) || !['confirmed', 'uncertain'].includes(i.positionStatus) || !Number.isInteger(i.quantity)) throw new Error('物品结构不正确');
      const specs = {};
      for (const key of allowedFields) if (i.specs && Object.hasOwn(i.specs, key)) specs[key] = i.specs[key] == null ? null : key === 'connector' ? str(i.specs[key], 50, '接口') : num(i.specs[key], 100000, '规格', 0.01);
      if (!Array.isArray(i.history) || i.history.length > 100 || !Array.isArray(i.reservations) || i.reservations.length > 100 || !Array.isArray(i.checkedPlaces) || !Array.isArray(i.deniedFor)) throw new Error('历史记录结构不正确');
      const photo = i.photo || '';
      if (typeof photo !== 'string' || photo.length > 1500000 || (photo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(photo))) throw new Error('照片必须是大小受限的本地图片');
      const optionalMedia = {};
      if (i.thumbnail !== undefined) {
        if (typeof i.thumbnail !== 'string' || i.thumbnail.length > 250000 || (i.thumbnail && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(i.thumbnail))) throw new Error('缩略图必须是大小受限的本地图片');
        optionalMedia.thumbnail = i.thumbnail;
      }
      if (i.publicPhoto !== undefined) {
        const p = i.publicPhoto;
        if (!p || typeof p.author !== 'string' || !p.author.trim() || p.author.length > 120 || !['pageUrl', 'licenseUrl'].every(key => typeof p[key] === 'string' && p[key].length <= 500 && /^https:\/\/[^\s<>"']+$/.test(p[key]))) throw new Error('公开照片署名或来源链接无效');
        optionalMedia.publicPhoto = { author: p.author, pageUrl: p.pageUrl, licenseUrl: p.licenseUrl };
      }
      return { id: str(i.id, 80, '物品编号'), isSynthetic: true, name: str(i.name, 100, '名称'), category: i.category, quantity: num(i.quantity, 30, '物品数量', 1), owner: str(i.owner, 100, '负责人'), condition: i.condition, share: i.share, specs, positionStatus: i.positionStatus, lastConfirmed: { place: str(i.lastConfirmed?.place, 120, '确认地点'), at: date(i.lastConfirmed?.at, '确认时间'), by: str(i.lastConfirmed?.by, 100, '确认者') }, history: i.history.map(h => ({ place: str(h.place, 120, '历史地点'), at: date(h.at, '历史时间'), kind: ['confirmed', 'returned', 'activity', 'borrowed'].includes(h.kind) ? h.kind : 'activity' })), checkedPlaces: i.checkedPlaces.slice(0, 100).map(p => str(p, 120, '检查地点')), deniedFor: i.deniedFor.slice(0, 100).map(p => str(p, 80, '拒借需求')), reservations: i.reservations.map(v => { const rr = { requestId: str(v.requestId, 80, '预留编号'), start: date(v.start, '预留开始'), end: date(v.end, '预留结束'), quantity: num(v.quantity, i.quantity, '预留数量', 1), approved: v.approved === true, source: 'simulation', purpose: str(v.purpose || '', 1000, '批准用途', true), approvedBy: str(v.approvedBy || '', 100, '批准者', true) }; if (rr.start >= rr.end || !Number.isInteger(rr.quantity)) throw new Error('预留时间或数量不正确'); return rr; }), photo, ...optionalMedia, note: str(i.note || '', 1000, '备注', true) };
    });
    if (new Set(items.map(i => i.id)).size !== items.length) throw new Error('物品编号重复');
    // Reject overbooked imported data rather than silently accepting impossible reservations.
    for (const i of items) for (const r of i.reservations.filter(x => x.approved)) {
      const simultaneous = i.reservations.filter(x => x.approved && x.start <= r.start && x.end > r.start).reduce((n, x) => n + x.quantity, 0);
      if (simultaneous > i.quantity) throw new Error(i.name + '存在超量预约');
    }
    const events = Array.isArray(input.events) ? input.events.slice(0, 200).map(e => ({ at: date(e.at, '事件时间'), requestId: str(e.requestId, 80, '事件需求'), action: str(e.action, 300, '事件动作'), outcome: str(e.outcome, 80, '事件结果'), value: str(e.value || '', 300, '事件值', true), isSynthetic: true })) : [];
    return { version: VERSION, isSynthetic: true, request, items, events };
  }
  return { VERSION, categories, presets, seed, clone, overlap, freeQuantity, approvedQuantity, blockReason, predictions, specCheck, candidates, buildPlan, applyAction, validateState };
});
