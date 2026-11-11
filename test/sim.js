// node test/sim.js [판 수]  — 컴퓨터끼리 대전 + 혼자 스테이지, 다시 두기 시간 재기
const TB = require('../src/engine.js');
const TBAI = require('../src/ai.js');
const N = +process.argv[2] || 4;
let rs = 12345; const rand = () => (rs = (rs * 16807) % 2147483647) / 2147483647;

// 한 사람(컴퓨터)의 진행기: 블록마다 생각 → 동작을 actMs 간격으로
function player(s, level) {
  const lv = TBAI.LEVELS[level];
  let q = [], wait = 0, startTick = 0, rec = [];
  return {
    s, rec,
    step() {
      if (s.over) return;
      if (!q.length && s.cur && s.tick >= startTick) {
        q = TBAI.plan(s, level, rand).acts;
        wait = Math.round(lv.actMs / 1000 * 60);
      }
      if (q.length) {
        if (wait > 0) wait--;
        else {
          const c = q.shift();
          rec.push([s.tick, c]); TB.act(s, c);
          wait = Math.round(lv.actMs / 1000 * 60);
          if (c === 'h') { q = []; startTick = s.tick + Math.round((lv.pieceMs - lv.actMs * 4) / 1000 * 60); }
        }
      }
    },
  };
}

function battle(la, lb, seed) {
  const A = player(TB.create({ seed, mode: 'vs' }), la), B = player(TB.create({ seed, mode: 'vs' }), lb);
  for (let t = 0; t < 60 * 60 * 6; t++) {
    for (const [P, O] of [[A, B], [B, A]]) {
      P.step();
      if (!P.s.over) TB.tick(P.s);
      for (const e of P.s.ev) if (e.t === 'attack') TB.addGarbage(O.s, e.n, Math.floor(rand() * 10));
      P.s.ev.length = 0;
    }
    if (A.s.over || B.s.over) break;
  }
  return A.s.over && !B.s.over ? 'B' : B.s.over && !A.s.over ? 'A' : 'draw';
}

const pairs = [['hard', 'normal'], ['normal', 'easy'], ['hard', 'easy']];
for (const [a, b] of pairs) {
  let w = { A: 0, B: 0, draw: 0 };
  for (let k = 0; k < N; k++) w[k % 2 ? 'A' : 'B'] += 0, w[battle(a, b, 1000 + k)]++;
  console.log(`${a} 대 ${b}: ${w.A}승 ${w.B}패 ${w.draw}무`);
}

for (const level of ['easy', 'normal', 'hard']) {
  const seed = 777;
  const P = player(TB.create({ seed }), level);
  while (!P.s.over && P.s.tick < 60 * 60 * 40) { P.step(); if (!P.s.over) TB.tick(P.s); P.s.ev.length = 0; }
  if (!P.s.over) { P.rec.push([P.s.tick, 'q']); TB.act(P.s, 'q'); }
  const str = TB.encode(P.rec);
  const t0 = process.hrtime.bigint();
  const r = TB.replay(seed, str);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`혼자 ${level}: 스테이지 ${P.s.stage} 점수 ${P.s.score} 줄 ${P.s.lines} ${Math.round(P.s.tick / 60)}초 (${P.s.why}) · 기록 ${str.length}자 · 다시 두기 ${ms.toFixed(1)}ms 일치 ${r.score === P.s.score && r.stage === P.s.stage}`);
}
