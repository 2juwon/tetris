/* 한판 블록 컴퓨터 — TBAI
 * 놓을 수 있는 자리(회전 4 × 가로 위치)를 모두 바로 내려 보고 판 모양 점수(엘-테트리스 계열)로 고름
 * 초급: 느리고 가끔 실수 · 중급: 보관 사용 · 고급: 다음 블록까지 보고 공격 줄을 노림
 */
(function (root) {
  'use strict';
  const TB = root.TB || (typeof require !== 'undefined' ? require('./engine.js') : null);
  const { W, H, CELLS } = TB;

  const LEVELS = {
    easy:   { name: '초급', pieceMs: 1150, actMs: 100, look: false, hold: false, atk: 0, mistake: 0.07, top: 2 },
    normal: { name: '중급', pieceMs: 700,  actMs: 55,  look: false, hold: true,  atk: 3, mistake: 0.04, top: 2 },
    hard:   { name: '고급', pieceMs: 380,  actMs: 22,  look: true,  hold: true,  atk: 9, mistake: 0,    top: 1 },
  };

  const WT = { land: -4.5, rows: 3.4, rowT: -3.2, colT: -9.35, holes: -7.9, wells: -3.39, high: -1.2 };

  function spawnPos(board, p) {
    const x = p === 4 ? 4 : 3;
    let y = p === 1 ? 1 : 2;
    if (!TB.fits(board, p, 0, x, y)) y -= 1;
    if (TB.fits(board, p, 0, x, y + 1)) y += 1;
    return { x, y };
  }

  // 회전·이동으로 실제 갈 수 있는 자리만: 엔진 동작을 흉내 낸 작은 상태로 확인
  function fake(board, p, x, y) {
    return { board, cur: { p, r: 0, x, y }, over: false, ev: [], lowY: y, resets: 0, lockT: 0, lastRot: false, lastKick: 0, garbage: [] };
  }
  function placements(board, p) {
    const out = [];
    const sp = spawnPos(board, p);
    if (!TB.fits(board, p, 0, sp.x, sp.y)) return out;
    const rots = p === 4 ? [[]] : [[], ['b'], ['b', 'b'], ['a']];
    for (const rs of rots) {
      const s = fake(board, p, sp.x, sp.y);
      let okRot = true;
      for (const c of rs) if (!TB.act(s, c)) { okRot = false; break; }
      if (!okRot) continue;
      const r = s.cur.r, x0 = s.cur.x, y0 = s.cur.y;
      for (const dir of [0, -1, 1]) {
        let x = x0;
        const moves = [];
        if (dir !== 0) {
          // 한 칸씩 끝까지
          for (;;) {
            if (!TB.fits(board, p, r, x + dir, y0)) break;
            x += dir; moves.push(dir < 0 ? 'l' : 'r');
            out.push(make(board, p, r, x, y0, rs.concat(moves)));
          }
        } else out.push(make(board, p, r, x, y0, rs.slice()));
      }
    }
    return out;
  }
  function make(board, p, r, x, y, acts) {
    let d = 0;
    while (TB.fits(board, p, r, x, y + d + 1)) d++;
    return { p, r, x, y: y + d, acts: acts.concat('h') };
  }

  // 놓은 뒤 판과 지운 줄 수
  function place(board, pl) {
    const b = board.slice();
    for (const [dx, dy] of CELLS[pl.p][pl.r]) { const yy = pl.y + dy; if (yy >= 0) b[yy * W + pl.x + dx] = pl.p; }
    let n = 0;
    const nb = new Array(W * H).fill(0);
    let ny = H - 1;
    for (let y = H - 1; y >= 0; y--) {
      let full = true;
      for (let x = 0; x < W; x++) if (!b[y * W + x]) { full = false; break; }
      if (full) { n++; continue; }
      for (let x = 0; x < W; x++) nb[ny * W + x] = b[y * W + x];
      ny--;
    }
    return { b: nb, n };
  }

  function features(b) {
    let rowT = 0, colT = 0, holes = 0, wells = 0, maxH = 0;
    const heights = new Array(W).fill(0);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) if (b[y * W + x]) { heights[x] = H - y; break; }
      if (heights[x] > maxH) maxH = heights[x];
    }
    for (let y = 0; y < H; y++) {
      let prev = 1;
      for (let x = 0; x < W; x++) { const f = b[y * W + x] ? 1 : 0; if (f !== prev) rowT++; prev = f; }
      if (prev === 0) rowT++;
    }
    for (let x = 0; x < W; x++) {
      let prev = 0, seen = false;
      for (let y = 0; y < H; y++) {
        const f = b[y * W + x] ? 1 : 0;
        if (f !== prev) colT++;
        if (f) seen = true; else if (seen) holes++;
        prev = f;
      }
      if (prev === 0) colT++;
    }
    for (let x = 0; x < W; x++) {
      const l = x === 0 ? H : heights[x - 1], r = x === W - 1 ? H : heights[x + 1];
      const d = Math.min(l, r) - heights[x];
      if (d > 0) wells += d * (d + 1) / 2;
    }
    return { rowT, colT, holes, wells, maxH, heights };
  }

  function value(board, pl, lv, pending, combo) {
    const { b, n } = place(board, pl);
    const f = features(b);
    let land = 0;
    for (const [, dy] of CELLS[pl.p][pl.r]) land += H - (pl.y + dy);
    land /= 4;
    let v = WT.land * land + WT.rows * n + WT.rowT * f.rowT + WT.colT * f.colT + WT.holes * f.holes + WT.wells * f.wells;
    if (f.maxH > 12) v += WT.high * (f.maxH - 12) * (f.maxH - 12);
    if (lv.atk) {
      const atk = [0, 0, 1, 2, 4][n] + (n && combo >= 1 ? [0, 0, 1, 1, 2, 2, 3][Math.min(combo + 1, 6)] : 0);
      v += lv.atk * atk;
      if (pending > 0 && n) v += 2 * Math.min(n, pending) + (f.maxH > 10 ? 4 * n : 0);
    }
    if (f.maxH >= 19) v -= 500;
    return { v, b, n };
  }

  function best(board, p, lv, pending, combo, nextP) {
    const pls = placements(board, p);
    const scored = pls.map((pl) => ({ pl, ...value(board, pl, lv, pending, combo) }));
    scored.sort((a, b) => b.v - a.v);
    if (lv.look && nextP && scored.length) {
      for (const c of scored.slice(0, 6)) {
        const pl2 = placements(c.b, nextP);
        let m = -1e9;
        for (const q of pl2) { const r = value(c.b, q, lv, Math.max(0, pending - c.n), c.n ? combo + 1 : -1).v; if (r > m) m = r; }
        c.v2 = c.v * 0.5 + m;
      }
      scored.slice(0, 6).sort((a, b) => b.v2 - a.v2).forEach((c, i) => { scored[i] = c; });
    }
    return scored;
  }

  /* 지금 판에서 할 일: { acts: ['c'?, 'b', 'l', ..., 'h'] } */
  function plan(s, level, rand) {
    const lv = LEVELS[level] || LEVELS.normal;
    rand = rand || Math.random;
    if (!s.cur) return { acts: [] };
    const pending = TB.pending(s);
    const a = best(s.board, s.cur.p, lv, pending, s.combo, s.queue[0]);
    let pick = a, holdUsed = false;
    if (lv.hold && s.canHold) {
      const hp = s.hold || s.queue[0];
      if (hp !== s.cur.p) {
        const nextAfter = s.hold ? s.queue[0] : s.queue[1];
        const b = best(s.board, hp, lv, pending, s.combo, nextAfter);
        const va = a.length ? (a[0].v2 != null ? a[0].v2 : a[0].v) : -1e9;
        const vb = b.length ? (b[0].v2 != null ? b[0].v2 : b[0].v) : -1e9;
        if (vb > va + 0.5) { pick = b; holdUsed = true; }
      }
    }
    if (!pick.length) return { acts: ['h'] };
    let i = 0;
    if (lv.mistake && rand() < lv.mistake) i = Math.floor(rand() * Math.min(lv.top + 3, pick.length));
    else if (lv.top > 1) i = Math.floor(rand() * Math.min(lv.top, pick.length) * rand());
    const acts = pick[i].pl.acts.slice();
    if (holdUsed) acts.unshift('c');
    return { acts, target: pick[i].pl };
  }

  const TBAI = { LEVELS, plan, placements, features, place };
  root.TBAI = TBAI;
  if (typeof module !== 'undefined' && module.exports) module.exports = TBAI;
})(typeof self !== 'undefined' ? self : this);
