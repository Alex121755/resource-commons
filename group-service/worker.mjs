import {aiHealth, handleAiExtraction} from './ai.mjs';

// Each member holds a random 256-bit access key. Only its digest is stored.
const productionOrigin = 'https://alex121755.github.io';
const idPattern = /^[a-f0-9-]{36}$/;
const keyPattern = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
}

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function field(value, max, name) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new ApiError(400, 'Enter a valid ' + name + '.');
  return value.trim();
}
async function readJson(request, limit) {
  const type = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new ApiError(415, 'Send JSON.');
  if (Number(request.headers.get('Content-Length')) > limit) throw new ApiError(413, 'Request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'Missing request body.');
  const decoder = new TextDecoder();
  let text = '', total = 0;
  while (true) {
    const {value, done} = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); throw new ApiError(413, 'Request is too large.'); }
    text += decoder.decode(value, {stream:true});
  }
  let parsed;
  try { parsed = JSON.parse(text + decoder.decode()); }
  catch { throw new ApiError(400, 'Invalid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ApiError(400, 'Invalid request.');
  return parsed;
}

// One atomic reservation per provider call, including failures with uncertain billing.
// The lifetime ceiling also bounds storage. No prompts, pictures or raw IPs are stored.
async function reserveAiCall(db, request) {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0,10);
  const client = await digest(day + '/' + (request.headers.get('CF-Connecting-IP') || 'shared'));
  const sql = `INSERT INTO ai_calls(day, started_at, client) SELECT ?, ?, ?
    WHERE (SELECT count(*) FROM ai_calls) < 100
      AND (SELECT count(*) FROM ai_calls WHERE day=?) < 30
      AND (SELECT count(*) FROM ai_calls WHERE client=? AND started_at>?) < 6`;
  const result = await db.prepare(sql).bind(day, now, client, day, client, now-3600000).run();
  if (!result.meta.changes) throw new ApiError(429, 'The shared recognition quota has been reached.');
}

async function handleAi(request, env, path) {
  if (path === '/api/health' && request.method === 'GET') return aiHealth(env);
  const route = /^\/api\/extract-(request|item|scene)$/.exec(path);
  if (!route) throw new ApiError(404, 'Unknown recognition endpoint.');
  if (request.method !== 'POST') throw new ApiError(405, 'Use POST for recognition.');
  if (request.headers.get('Origin') !== productionOrigin ||
      request.headers.get('X-Resource-Commons-Consent') !== 'cloud-v1') {
    throw new ApiError(403, 'Confirm cloud processing in the public workspace.');
  }
  const kind = route[1];
  const body = await readJson(request, kind === 'request' ? 24000 : 4600000);
  try {
    return await handleAiExtraction(kind, body, env, fetch, () => reserveAiCall(env.DB, request));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // The adapter exposes vetted statuses; never forward an unexpected exception
    // or an upstream diagnostic (which can contain request details).
    const messages = {400:'Invalid recognition input.',413:'Image is too large.',429:'Recognition is busy.',502:'The provider could not complete recognition.',503:'Recognition service unavailable.',504:'Recognition timed out.'};
    const status = Object.hasOwn(messages, error.status) ? Number(error.status) : 503;
    throw new ApiError(status, messages[status]);
  }
}

async function handle(request, db) {
  const path = new URL(request.url).pathname;
  const method = request.method;
  if (method === 'GET' && path === '/health') return {status:'ready'};
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  if (!keyPattern.test(token) || request.headers.get('Authorization') !== 'Bearer ' + token)
    throw new ApiError(401, 'Open a member profile to continue.');
  const identity = await digest(token);
  const body = method === 'POST' ? await readJson(request, 4096) : {};
  const query = (sql,...args) => db.prepare(sql).bind(...args);
  if (path === '/groups' && method === 'GET') {
    const {results} = await query('SELECT g.id,g.name,g.owner=m.identity AS is_owner FROM members m JOIN groups g ON g.id=m.group_id WHERE m.identity=? ORDER BY g.name,g.id',identity).all();
    return {groups:results};
  }
  if (path === '/groups' && method === 'POST') {
    const name = field(body.name,80,'group name'), member = field(body.member,48,'display name');
    const id = crypto.randomUUID();
    await db.batch([
      query('INSERT INTO groups(id,name,owner) VALUES(?,?,?)',id,name,identity),
      query('INSERT INTO members(group_id,identity,name) VALUES(?,?,?)',id,identity,member)
    ]);
    return {id};
  }
  if (path === '/join' && method === 'POST') {
    const name = field(body.member,48,'display name');
    if (!keyPattern.test(body.code ?? '')) throw new ApiError(400, 'Enter the complete invitation code.');
    const hash = await digest(body.code);
    // The first successful transaction consumes the single-use invitation.
    const result = await db.batch([
      query('INSERT OR IGNORE INTO members(group_id,identity,name) SELECT id,?,? FROM groups WHERE invite_hash=? AND invite_expires>?',identity,name,hash,Date.now()),
      query('UPDATE groups SET invite_hash=NULL,invite_expires=NULL WHERE invite_hash=? AND changes()>0 RETURNING id',hash)
    ]);
    if (!result[1].results.length) throw new ApiError(409, 'Invitation expired, already used, or you are already a member.');
    return {id:result[1].results[0].id};
  }
  const parts = path.split('/');
  if (parts[1] !== 'groups' || !idPattern.test(parts[2] || '')) throw new ApiError(404,'Page not found.');
  const id = parts[2], action = parts.slice(3).join('/');
  const group = await query('SELECT g.name,g.owner=m.identity AS is_owner FROM groups g JOIN members m ON m.group_id=g.id WHERE g.id=? AND m.identity=?',id,identity).first();
  if (!group) throw new ApiError(404, 'Group unavailable for this profile.');
  if (method === 'GET' && !action) {
    const {results} = await query(`SELECT r.id,r.title,r.quantity,r.note,r.created_at,m.name AS author,r.author=? AS mine
      FROM resources r JOIN members m ON m.group_id=r.group_id AND m.identity=r.author
      WHERE r.group_id=? AND EXISTS(SELECT 1 FROM members WHERE group_id=? AND identity=?) ORDER BY r.created_at DESC,r.id`,identity,id,id,identity).all();
    const count = await query('SELECT count(*) AS n FROM members WHERE group_id=?',id).first();
    return {id,...group,memberCount:count.n,resources:results};
  }
  if (method === 'POST' && action === 'invite' && group.is_owner) {
    const code = randomKey();
    await query('UPDATE groups SET invite_hash=?,invite_expires=? WHERE id=? AND owner=?',await digest(code),Date.now()+86400000,id,identity).run();
    return {code};
  }
  if (method === 'POST' && action === 'resources') {
    const title = field(body.title,120,'resource name'), quantity=body.quantity;
    if (!Number.isInteger(quantity) || quantity<1 || quantity>9999) throw new ApiError(400,'Choose a quantity from 1 to 9999.');
    const note = body.note ? field(body.note,400,'note') : '';
    const inserted = await query(`INSERT INTO resources(id,group_id,author,title,quantity,note,created_at)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM members WHERE group_id=? AND identity=?)`,
      crypto.randomUUID(),id,identity,title,quantity,note,new Date().toISOString(),id,identity).run();
    if (!inserted.meta.changes) throw new ApiError(404,'Group unavailable for this profile.');
    return {shared:true};
  }
  if (method === 'DELETE' && parts.length === 5 && parts[3] === 'resources' && idPattern.test(parts[4])) {
    const removed = await query('DELETE FROM resources WHERE group_id=? AND id=? AND author=?',id,parts[4],identity).run();
    if (!removed.meta.changes) throw new ApiError(404,'Listing unavailable.');
    return {removed:true};
  }
  if (method === 'DELETE' && !action && group.is_owner) {
    await query('DELETE FROM groups WHERE id=? AND owner=?',id,identity).run();
    return {deleted:true};
  }
  if (method === 'DELETE' && action==='membership' && !group.is_owner) {
    await db.batch([query('DELETE FROM resources WHERE group_id=? AND author=?',id,identity),
      query('DELETE FROM members WHERE group_id=? AND identity=?',id,identity)]);
    return {left:true};
  }
  throw new ApiError(403,'This action is unavailable for this profile.');
}
export default {
  async fetch(request,env) {
    const origin = request.headers.get('Origin');
    const allowed = !origin || origin === productionOrigin || origin === new URL(request.url).origin ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const headers = {'Cache-Control':'no-store','Content-Type':'application/json','Vary':'Origin','X-Content-Type-Options':'nosniff'};
    if (allowed && origin) headers['Access-Control-Allow-Origin'] = origin;
    if (!allowed) return Response.json({error:'Origin unavailable.'},{status:403,headers});
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:{...headers,
      'Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, X-Resource-Commons-Consent','Access-Control-Max-Age':'600'}});
    try {
      const path = new URL(request.url).pathname;
      const data = path.startsWith('/api/') ? await handleAi(request, env, path) : await handle(request, env.DB);
      return Response.json(data, {headers});
    }
    catch (error) { return Response.json({error:error instanceof ApiError ? error.message : 'Group service unavailable.'},{headers,status:error instanceof ApiError?error.status:503}); }
  }
};
