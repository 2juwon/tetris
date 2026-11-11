// cd server && npx wrangler dev --var FAST_TEST:1 --port 8787  →  node test/online.test.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const TB = require('../../src/engine.js');
const TBAI = require('../../src/ai.js');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✗', m); } };
const post = async (p, b) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) }); return { status: r.status, ...(await r.json()) }; };
const get = async (p) => (await fetch(BASE + p)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 랭킹 ──
function playAI(seed, pieces) {
  const s = TB.create({ seed }), rec = [];
  let n = 0;
  while (!s.over && n < pieces) {
    const p = TBAI.plan(s, 'normal', Math.random);
    for (const c of p.acts) { if (TB.act(s, c)) rec.push([s.tick, c]); if (s.over) break; }
    for (let k = 0; k < 10 && !s.over; k++) { TB.tick(s); s.ev.length = 0; }
    n++;
  }
  if (!s.over) { rec.push([s.tick, 'q']); TB.act(s, 'q'); }
  return { s, inputs: TB.encode(rec) };
}
{
  const bad = await post('/api/run/start', { v: 999 });
  ok(bad.error, '예전 버전 시작 거절');
  const t = await post('/api/run/start', { v: TB.RULES_VERSION });
  ok(t.run && t.token && t.seed, '도전 시작');
  const { s, inputs } = playAI(t.seed, 160);
  const claim = { stage: s.stage, score: s.score, lines: s.lines };
  const wrong = await post('/api/run/finish', { run: t.run, token: t.token, v: TB.RULES_VERSION, inputs, claim: { ...claim, score: claim.score + 10 }, name: '꾀돌이' });
  ok(wrong.error, '점수 고친 기록 거절');
  const r = await post('/api/run/finish', { run: t.run, token: t.token, v: TB.RULES_VERSION, inputs, claim, name: '블록왕' });
  ok(r.ok && r.place === 1 && r.weekPlace === 1, '등록 1위 ' + JSON.stringify(r));
  const again = await post('/api/run/finish', { run: t.run, token: t.token, v: TB.RULES_VERSION, inputs, claim, name: '블록왕' });
  ok(again.error, '같은 도전 두 번 등록 거절');
  const t2 = await post('/api/run/start', { v: TB.RULES_VERSION });
  const other = await post('/api/run/finish', { run: t2.run, token: t2.token, v: TB.RULES_VERSION, inputs, claim, name: '베끼기' });
  ok(other.error, '다른 씨앗에 남의 기록 거절');
  const tk = await post('/api/run/finish', { run: t2.run, token: 'ffff', v: TB.RULES_VERSION, inputs, claim, name: 'x' });
  ok(tk.error, '열쇠 틀림 거절');
  const g2 = playAI(t2.seed, 40);
  const r2 = await post('/api/run/finish', { run: t2.run, token: t2.token, v: TB.RULES_VERSION, inputs: g2.inputs, claim: { stage: g2.s.stage, score: g2.s.score, lines: g2.s.lines }, name: '둘째' });
  ok(r2.ok, '둘째 기록 등록 ' + JSON.stringify(r2));
  const wk = await get('/api/rank?period=week'), all = await get('/api/rank');
  ok(wk.list.length >= 2 && all.list.length >= 2 && wk.weekStart && wk.weekEnd, '이번 주·전체 표');
  ok(all.list[0].stage > all.list[1].stage || (all.list[0].stage === all.list[1].stage && all.list[0].score >= all.list[1].score), '스테이지·점수 순서');
  ok(!('run' in all.list[0]), '도전 번호 숨김');
}

// ── 온라인 ──
const pid = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
function client(code, name) {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/ws/' + code + '?pid=' + pid() + '&name=' + encodeURIComponent(name));
  const c = { ws, msgs: [], state: null, seat: -1, name };
  ws.onmessage = (e) => { if (e.data === 'pong') return; const m = JSON.parse(e.data); c.msgs.push(m); if (m.t === 'state') { c.state = m.room; c.seat = m.seat; } };
  c.send = (o) => ws.send(JSON.stringify(o));
  c.open = new Promise((r) => (ws.onopen = r));
  c.wait = async (pred, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = c.msgs.find(pred); if (m) return m; await sleep(30); } return null; };
  return c;
}
{
  const { code } = await post('/api/rooms', {});
  ok(/^\d{6}$/.test(code), '방 만들기');
  const A = client(code, '가나'), B = client(code, '가나'), C = client(code, '다라');
  await Promise.all([A.open, B.open, C.open]); await sleep(300);
  ok(A.state && A.state.seats.filter((s) => s.kind === 'human').length === 3, '세 명 입장');
  ok(new Set(A.state.seats.filter((s) => s.kind === 'human').map((s) => s.name)).size === 3, '같은 이름은 다르게');
  A.send({ t: 'ready', on: true }); B.send({ t: 'ready', on: true }); await sleep(200);
  ok(!A.msgs.some((m) => m.t === 'start'), '모두 준비 전에는 시작 안 함');
  C.send({ t: 'ready', on: true });
  const sa = await A.wait((m) => m.t === 'start'), sc = await C.wait((m) => m.t === 'start');
  ok(sa && sc && sa.seed === sc.seed && sa.players.length === 3, '같은 씨앗으로 시작');
  A.send({ t: 'b', b: '0'.repeat(190) + '8888888880', p: 0, sent: 0 });
  const ob = await B.wait((m) => m.t === 'ob');
  ok(ob && ob.seat === A.seat && ob.b.endsWith('8888888880'), '판 모양 전달');
  ok(!A.msgs.some((m) => m.t === 'ob'), '내 판은 나에게 안 옴');
  A.send({ t: 'atk', n: 4 });
  await sleep(300);
  const got = [B, C].map((x) => x.msgs.find((m) => m.t === 'g'));
  ok(got.filter(Boolean).length === 1 && got.find(Boolean).n === 4, '공격 줄은 한 사람에게만');
  const target = got[0] ? B : C, other = target === B ? C : B;
  target.send({ t: 'dead' });
  const ko = await A.wait((m) => m.t === 'ko');
  ok(ko && ko.place === 3 && ko.by === A.seat, '탈락 3위 + KO는 공격한 사람');
  // 4명째는 진행 중에 들어와 대기
  const D2 = client(code, '마바'); await D2.open; await sleep(200);
  ok(D2.state && D2.state.status === 'playing' && !D2.msgs.some((m) => m.t === 'start'), '진행 중에 들어오면 다음 판부터');
  other.ws.close(); // 끊기면 탈락 → A 혼자 남아 끝
  const end = await A.wait((m) => m.t === 'end');
  ok(end && end.order[0].seat === A.seat && end.order.length === 3, '마지막 남은 사람 1위 ' + JSON.stringify(end && end.order));
  await sleep(200);
  ok(A.state.status === 'waiting' && A.state.seats[A.seat].wins === 1, '승수 +1, 대기실로');
  const E = client(code, '사아'); await E.open; await sleep(200);
  ok(E.msgs.some((m) => m.t === 'state'), '빈자리에 다시 들어옴');
  const F = client(code, '자차'); await F.open;
  const full = await F.wait((m) => m.t === 'error');
  ok(full && full.fatal, '5명째는 꽉 참');
  [A, B, C, D2, E, F].forEach((x) => { try { x.ws.close(); } catch (e) { /* */ } });
}
{
  const q1 = await post('/api/quick'); const P = client(q1.code, '빠른1'); await P.open; await sleep(200);
  const q2 = await post('/api/quick');
  ok(q1.code === q2.code, '빠른 참가는 기다리는 방으로');
  const st = await get('/api/stats');
  ok(st.waitingPlayers >= 1, '대기 인원 ' + JSON.stringify(st));
  P.ws.close();
}
const bad = client('000001', 'x'); await bad.open.catch(() => {});
const nr = await bad.wait((m) => m.t === 'error');
ok(nr && nr.code === 'no_room', '없는 방');
console.log(`서버 시험 ${pass}개 통과` + (fail ? `, ${fail}개 실패` : ''));
process.exit(fail ? 1 : 0);
