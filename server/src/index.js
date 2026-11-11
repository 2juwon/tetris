/* 한판 블록 서버 (Cloudflare Workers + Durable Objects)
 * - Rank: 스테이지 랭킹 (입력 기록을 다시 두어 확인)
 * - Room / Lobby: 2~4명 온라인 대결, 빠른 참가
 * - Inbox: 의견·고장 신고함, 관리 페이지 /admin
 */
import { Inbox, ADMIN_HTML } from './inbox.js';
import { Rank } from './rank.js';
import { Room, Lobby, randomCode, lobbyStub, roomStub } from './room.js';
export { Inbox, Rank, Room, Lobby };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
});
const inboxStub = (env) => env.INBOX.get(env.INBOX.idFromName('main'));
const rankStub = (env) => env.RANK.get(env.RANK.idFromName('main'));
function adminOk(request, env) {
  const want = env.ADMIN_KEY || '', got = request.headers.get('x-admin-key') || '';
  if (!want || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}
async function body(request, max = 8000) {
  if (+(request.headers.get('content-length') || 0) > max) return null;
  try { const b = await request.json(); return b && typeof b === 'object' ? b : {}; } catch (e) { return null; }
}
const who = (request) => request.headers.get('CF-Connecting-IP') || 'anon';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      // 랭킹
      if (p === '/api/run/start' && request.method === 'POST') {
        const b = (await body(request)) || {};
        const r = await rankStub(env).start(who(request), b.v);
        return json(r, r.error ? 429 : 200);
      }
      if (p === '/api/run/finish' && request.method === 'POST') {
        const b = await body(request, 1600000);
        if (!b) return json({ error: '보낸 내용을 읽지 못했어요' }, 400);
        const r = await rankStub(env).finish(b);
        return json(r, r.error ? 400 : 200);
      }
      if (p === '/api/rank' && request.method === 'GET') return json(await rankStub(env).board(url.searchParams.get('period') === 'week' ? 'week' : 'all'));
      // 온라인
      if (p === '/api/quick' && request.method === 'POST') return json(await lobbyStub(env).quick());
      if (p === '/api/rooms' && request.method === 'POST') {
        const b = (await body(request)) || {};
        for (let k = 0; k < 6; k++) {
          const code = randomCode();
          if (await roomStub(env, code).init(code, !!b.public)) return json({ code });
        }
        return json({ error: '방을 만들지 못했어요' }, 500);
      }
      if (p === '/api/stats') {
        const [lobby, rank] = await Promise.all([lobbyStub(env).stats(), rankStub(env).board('week')]);
        return json({ ...lobby, starts: rank.starts, saved: rank.saved });
      }
      const m = p.match(/^\/ws\/(\d{6})$/);
      if (m) {
        if (request.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426, headers: CORS });
        return roomStub(env, m[1]).fetch(request);
      }
      // 의견함
      if (p === '/api/feedback' && request.method === 'POST') {
        const b = await body(request, 40000);
        if (!b) return json({ error: '보낸 내용을 읽지 못했어요' }, 400);
        const r = await inboxStub(env).add({ ...b, ua: request.headers.get('User-Agent') || '' }, who(request));
        return json(r, r.error ? 429 : 200);
      }
      if (p === '/admin') return new Response(ADMIN_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex', 'cache-control': 'no-store' } });
      if (p.startsWith('/api/admin/')) {
        if (!env.ADMIN_KEY) return json({ error: '관리자 비밀번호(ADMIN_KEY)가 아직 설정되지 않았어요' }, 503);
        if (!adminOk(request, env)) return json({ error: '비밀번호가 맞지 않아요' }, 401);
        if (p === '/api/admin/feedback' && request.method === 'GET') return json({ items: await inboxStub(env).list() });
        const fm = p.match(/^\/api\/admin\/feedback\/([\w-]{6,40})$/);
        if (fm && request.method === 'POST') { const b = (await body(request)) || {}; return json({ ok: await inboxStub(env).setStatus(fm[1], b.status) }); }
        if (fm && request.method === 'DELETE') return json({ ok: await inboxStub(env).remove(fm[1]) });
        if (p === '/api/admin/rank' && request.method === 'GET') return json(await rankStub(env).board('all'));
        const rm = p.match(/^\/api\/admin\/rank\/stage\/([a-f0-9]{12})$/);
        if (rm && request.method === 'DELETE') return json({ ok: await rankStub(env).remove(rm[1]) });
        return json({ error: 'not found' }, 404);
      }
      if (p === '/') return new Response('한판 블록 서버가 돌고 있어요', { headers: { 'content-type': 'text/plain; charset=utf-8', ...CORS } });
      return json({ error: 'not found' }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: '서버 오류가 났어요' }, 500);
    }
  },
};
