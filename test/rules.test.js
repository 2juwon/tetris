// node test/rules.test.js
const TB = require('../src/engine.js');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('✗', name, '\n  ', e.message); } }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || '') + ' 기대 ' + JSON.stringify(b) + ' 실제 ' + JSON.stringify(a)); }
const { W, H } = TB;

// 그림으로 아래쪽 판 채우기: # 블록, . 빈칸 (마지막 줄이 맨 아래)
function setBoard(s, rows) {
  s.board.fill(0);
  rows.forEach((r, i) => { const y = H - rows.length + i; [...r].forEach((ch, x) => { if (ch === '#') s.board[y * W + x] = 8; }); });
}
function withPiece(s, p, r, x, y) { s.cur = { p, r, x, y }; s.lowY = y; s.lockT = 0; s.resets = 0; s.lastRot = false; }
const fresh = (seed = 7, mode = 'vs') => { const s = TB.create({ seed, mode }); s.ev.length = 0; return s; };
const lastLock = (s) => s.ev.filter((e) => e.t === 'lock').pop();

t('7개씩 한 봉지: 처음 7개는 모두 다름', () => {
  const s = TB.create({ seed: 123 });
  const first = [s.cur.p, ...s.queue.slice(0, 6)];
  eq([...first].sort(), [1, 2, 3, 4, 5, 6, 7]);
});
t('같은 씨앗이면 같은 순서', () => {
  const a = TB.create({ seed: 99 }), b = TB.create({ seed: 99 });
  eq(a.queue, b.queue); eq(a.cur, b.cur);
});
t('회전 모양: T를 네 번 돌리면 제자리', () => {
  const s = fresh(); withPiece(s, 6, 0, 4, 10);
  for (let i = 0; i < 4; i++) TB.act(s, 'b');
  eq([s.cur.r, s.cur.x, s.cur.y], [0, 4, 10]);
});
t('I 회전 상태 1은 세로 한 줄(상자 셋째 칸)', () => eq(TB.CELLS[1][1], [[2, 0], [2, 1], [2, 2], [2, 3]]));
t('벽에서 회전하면 차기로 밀려남 (I 세로 → 가로, 오른쪽 벽)', () => {
  const s = fresh(); withPiece(s, 1, 1, 7, 10); // 세로 I가 x=9
  eq(TB.act(s, 'a'), true);
  eq(TB.fits(s.board, 1, s.cur.r, s.cur.x, s.cur.y), true);
});
t('한 줄 지우기 + 점수 100×레벨', () => {
  const s = fresh(); setBoard(s, ['####.#####']);
  withPiece(s, 1, 1, 2, 5); // 세로 I, x = 4
  TB.act(s, 'h');
  const e = lastLock(s);
  eq(e.n, 1); eq(s.lines, 1);
});
t('네 줄 지우기 = 공격 4줄', () => {
  const s = fresh(); setBoard(s, ['#########.', '#########.', '#########.', '#########.', '#.########']);
  withPiece(s, 1, 1, 7, 5);
  TB.act(s, 'h');
  const e = lastLock(s); eq([e.n, e.atk], [4, 4]);
});
t('연속 네 줄(B2B)이면 +1', () => {
  const s = fresh(); setBoard(s, [...Array(8).fill('#########.'), '#.########']);
  withPiece(s, 1, 1, 7, 5); TB.act(s, 'h');
  s.ev.length = 0; withPiece(s, 1, 1, 7, 5); TB.act(s, 'h');
  const e = lastLock(s); eq([e.n, e.b2b, e.atk], [4, true, 5]); // 4 + B2B 1 + 콤보 1(표에서 0)
});
t('T-스핀 더블 알아보기', () => {
  const s = fresh();
  setBoard(s, [
    '...#......',
    '#...######',
    '##.#######',
    '#.########',
  ]);
  // T를 거꾸로(2) 상태로 구멍에 두고, 마지막 동작을 회전으로 표시
  withPiece(s, 6, 2, 1, H - 4); // 상자 (1,H-4): 칸 (1,H-3)(2,H-3)(3,H-3)(2,H-2)
  eq(TB.fits(s.board, 6, 2, 1, H - 4), true);
  s.lastRot = true; s.lastKick = 0;
  TB.act(s, 'h');
  const e = lastLock(s);
  eq([e.ts, e.n, e.atk], [2, 2, 4]);
});
t('실제 회전으로 T-스핀 더블 넣기 (길 찾기)', () => {
  const rows = ['...#......', '#...######', '##.#######', '#.########'];
  const base = fresh(); setBoard(base, rows);
  // 위에서 시작해 왼쪽·오른쪽·한 칸 내리기·회전으로 갈 수 있는 곳을 모두 찾고, 회전으로 끝나는 자리에서 바로 내리기
  const seen = new Set(), q = [[0, 3, 4, false, 0]];
  let found = false;
  while (q.length && !found) {
    const [r, x, y] = q.shift();
    const k = r + ',' + x + ',' + y;
    if (seen.has(k)) continue; seen.add(k);
    for (const c of ['l', 'r', 'a', 'b', 'v']) {
      const s = fresh(); s.board = base.board.slice(); withPiece(s, 6, r, x, y);
      if (c === 'v') { if (!TB.fits(s.board, 6, r, x, y + 1)) continue; s.cur.y++; }
      else if (!TB.act(s, c)) continue;
      if (c === 'a' || c === 'b') {
        const s2 = fresh(); s2.board = base.board.slice(); s2.cur = { ...s.cur }; s2.lastRot = true; s2.lastKick = s.lastKick;
        if (TB.dropDist(s2) === 0) { TB.act(s2, 'h'); const e = lastLock(s2); if (e.ts === 2 && e.n === 2) found = true; }
      }
      q.push([s.cur.r, s.cur.x, s.cur.y]);
    }
  }
  eq(found, true);
});
t('회전 없이 넣으면 T-스핀 아님', () => {
  const s = fresh();
  setBoard(s, ['...#......', '#...######', '##.#######', '#.########']);
  withPiece(s, 6, 2, 1, H - 4); TB.act(s, 'h');
  eq(lastLock(s).ts, 0);
});
t('받을 방해 줄은 공격으로 먼저 지워짐', () => {
  const s = fresh(); s.garbage = [{ n: 3, hole: 0 }];
  setBoard(s, ['#########.', '#########.', '#########.', '#########.', '#.########']);
  withPiece(s, 1, 1, 7, 5); TB.act(s, 'h');
  eq(TB.pending(s), 0); eq(lastLock(s).sent, 1);
});
t('줄을 못 지우면 방해 줄이 올라옴', () => {
  const s = fresh(); s.garbage = [{ n: 2, hole: 3 }];
  withPiece(s, 4, 0, 0, 5); TB.act(s, 'h');
  eq(TB.pending(s), 0);
  const y = H - 1; eq(s.board.slice(y * W, y * W + W).map((v) => (v === 8 ? 1 : 0)), [1, 1, 1, 0, 1, 1, 1, 1, 1, 1]);
});
t('바닥에 닿고 30틱 지나면 굳음', () => {
  const s = fresh(); setBoard(s, []); withPiece(s, 4, 0, 4, H - 2);
  const n0 = s.pieces;
  for (let i = 0; i < 29; i++) TB.tick(s);
  eq(s.pieces, n0);
  TB.tick(s); eq(s.pieces, n0 + 1);
});
t('바닥에서 15번 넘게 움직이면 바로 굳음', () => {
  const s = fresh(); setBoard(s, []); withPiece(s, 6, 0, 4, H - 2);
  const n0 = s.pieces;
  for (let i = 0; i < 16 && s.pieces === n0; i++) { TB.act(s, i % 2 ? 'l' : 'r'); TB.tick(s); }
  eq(s.pieces, n0 + 1);
});
t('스테이지 표: 1·2는 빈 판, 5는 땅파기', () => {
  eq(TB.stageInfo(1).rows, 0); eq(TB.stageInfo(5).type, 'dig'); eq(TB.stageInfo(3).rows, 1);
  const s = TB.create({ seed: 5, stage: 5 });
  eq(s.board.filter((v) => v === 8).length, 6 * 9);
});
t('10줄 지우면 다음 스테이지', () => {
  const s = TB.create({ seed: 3 }); s.ev.length = 0;
  for (let k = 0; k < 3; k++) {
    setBoard(s, ['#########.', '#########.', '#########.', '#########.', '#.########']);
    withPiece(s, 1, 1, 7, 5); TB.act(s, 'h');
  }
  eq(s.stage, 2); eq(s.stageLines, 0);
  eq(s.ev.some((e) => e.t === 'stage'), true);
});
t('입력 기록 글자로 바꾸고 되돌리기', () => {
  const list = [[0, 'l'], [0, 'b'], [12, 'h'], [12, 'c'], [40, 'r']];
  eq(TB.decode(TB.encode(list)), list);
  eq(TB.encode(list), 'lb12hc28r');
});
t('다시 두기 = 실제 진행과 같은 결과', () => {
  // 아무렇게나 두는 봇으로 판을 끝까지 두고, 기록을 다시 둠
  const seed = 4242, s = TB.create({ seed }), rec = [];
  let rng = 1;
  const r = () => (rng = (rng * 16807) % 2147483647) / 2147483647;
  while (!s.over && s.tick < 60 * 60 * 20) {
    if (r() < 0.08) { const c = 'lrabhcdu'[Math.floor(r() * 8)]; rec.push([s.tick, c]); TB.act(s, c); }
    if (!s.over) TB.tick(s);
    s.ev.length = 0;
  }
  if (!s.over) { rec.push([s.tick, 'q']); TB.act(s, 'q'); }
  const res = TB.replay(seed, TB.encode(rec));
  eq([res.ok, res.score, res.lines, res.stage], [true, s.score, s.lines, s.stage]);
});
t('기록을 바꾸면 결과가 달라짐', () => {
  const seed = 11, s = TB.create({ seed }), rec = [];
  for (let k = 0; k < 30 && !s.over; k++) { rec.push([s.tick, k % 3 ? 'l' : 'h']); TB.act(s, k % 3 ? 'l' : 'h'); TB.tick(s); }
  rec.push([s.tick, 'q']); TB.act(s, 'q');
  const a = TB.replay(seed, TB.encode(rec)), b = TB.replay(seed + 1, TB.encode(rec));
  eq(a.score, s.score);
  if (a.score === b.score && a.lines === b.lines && a.pieces === b.pieces) throw new Error('씨앗이 달라도 같음');
});
t('판 압축', () => {
  const s = fresh(); setBoard(s, ['#.#.#.#.#.']);
  eq(TB.unpackBoard(TB.packBoard(s.board)), s.board);
});

console.log(`규칙 시험 ${pass}개 통과` + (fail ? `, ${fail}개 실패` : ''));
if (fail) process.exit(1);
