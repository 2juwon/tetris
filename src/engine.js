/* 한판 블록 규칙 엔진 — TB
 * 판: 가로 10 × 세로 24 (위 4줄은 안 보이는 여유 칸). 칸 번호 i = y*10 + x, 값 0 빈칸 · 1~7 블록 · 8 방해 줄
 * 1초에 60틱. 같은 씨앗 + 같은 입력이면 언제나 같은 결과 → 서버가 다시 두어서 랭킹 기록을 확인함
 * 입력: l 왼쪽 · r 오른쪽 · a 왼쪽 회전 · b 오른쪽 회전 · h 바로 내리기 · c 보관 · d 빨리 내리기 시작 · u 끝 · q 그만하기
 */
(function (root) {
  'use strict';
  const RULES_VERSION = 1; // 규칙·진행을 바꾸면 1 올릴 것 (예전 화면 기록은 랭킹에서 거절)
  const W = 10, H = 24, HID = 4;
  const NAMES = ' IJLOSTZ'; // 1~7
  const SHAPES = {
    1: [[0, 1], [1, 1], [2, 1], [3, 1]],        // I (4칸 상자)
    2: [[0, 0], [0, 1], [1, 1], [2, 1]],        // J
    3: [[2, 0], [0, 1], [1, 1], [2, 1]],        // L
    4: [[0, 0], [1, 0], [0, 1], [1, 1]],        // O (2칸 상자)
    5: [[1, 0], [2, 0], [0, 1], [1, 1]],        // S
    6: [[1, 0], [0, 1], [1, 1], [2, 1]],        // T
    7: [[0, 0], [1, 0], [1, 1], [2, 1]],        // Z
  };
  const BOX = { 1: 4, 4: 2 };
  // CELLS[p][r] = [[x,y]...] 상자 안 자리 (r: 0 처음 · 1 오른쪽 · 2 거꾸로 · 3 왼쪽)
  const CELLS = {};
  for (let p = 1; p <= 7; p++) {
    const n = BOX[p] || 3;
    CELLS[p] = [SHAPES[p]];
    for (let r = 1; r < 4; r++) CELLS[p].push(CELLS[p][r - 1].map(([x, y]) => [n - 1 - y, x]));
  }
  // SRS 벽 차기 (y는 위가 +인 표 그대로 적고, 쓸 때 뒤집음)
  const K3 = {
    '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]], '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]], '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]], '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]], '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  };
  const KI = {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]], '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]], '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]], '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]], '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  };
  const LOCK = 30, MAX_RESETS = 15, NEXT_SHOWN = 5;
  const LINE_SCORE = [0, 100, 300, 500, 800];
  const TSPIN_SCORE = [400, 800, 1200, 1600];
  const MINI_SCORE = [100, 200, 400];
  const PC_SCORE = [0, 800, 1200, 1800, 2000];
  const LINE_ATK = [0, 0, 1, 2, 4];
  const COMBO_ATK = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];
  const STAGE_LINES = 10;
  const MAX_LEVEL = 15;

  // 스테이지 n: 5의 배수는 '땅파기'(깔린 방해 줄을 모두 없애기), 나머지는 10줄 지우기 (3부터 방해 줄이 깔려 시작)
  function stageInfo(n) {
    if (n % 5 === 0) return { type: 'dig', rows: Math.min(4 + n / 5 * 2, 14), goal: 0, level: Math.min(n, MAX_LEVEL) };
    return { type: 'lines', rows: n < 3 ? 0 : Math.min(n - 2, 8), goal: STAGE_LINES, level: Math.min(n, MAX_LEVEL) };
  }
  // 한 틱에 내려가는 줄 수 (가이드라인 속도 표)
  function gravity(level) {
    const L = Math.max(1, Math.min(20, level));
    return 1 / (Math.pow(0.8 - (L - 1) * 0.007, L - 1) * 60);
  }

  function rnd(s, key) {
    let a = (s[key] = (s[key] + 0x6D2B79F5) >>> 0);
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /* opts: { seed, mode: 'stage' | 'vs', stage } */
  function create(opts) {
    opts = opts || {};
    const seed = (opts.seed >>> 0) || 1;
    const s = {
      v: RULES_VERSION, seed, mode: opts.mode === 'vs' ? 'vs' : 'stage',
      board: new Array(W * H).fill(0),
      brng: seed, grng: (seed ^ 0x9E3779B9) >>> 0,
      queue: [], hold: 0, canHold: true, cur: null,
      tick: 0, grav: 0, lockT: 0, resets: 0, lowY: 0, soft: false, lastRot: false, lastKick: 0,
      score: 0, lines: 0, level: 1, combo: -1, b2b: false, pieces: 0, sent: 0, tspins: 0, tetrises: 0, maxCombo: 0,
      stage: 1, stageLines: 0, goal: STAGE_LINES, goalType: 'lines', stageAt: 0,
      garbage: [], over: false, why: '', ev: [],
    };
    fill(s);
    if (s.mode === 'stage') setupStage(s, Math.max(1, opts.stage | 0 || 1));
    spawn(s);
    return s;
  }

  function fill(s) {
    while (s.queue.length < NEXT_SHOWN + 2) {
      const bag = [1, 2, 3, 4, 5, 6, 7];
      for (let i = 6; i > 0; i--) { const j = Math.floor(rnd(s, 'brng') * (i + 1)); const t = bag[i]; bag[i] = bag[j]; bag[j] = t; }
      s.queue.push(...bag);
    }
  }

  function setupStage(s, n) {
    const info = stageInfo(n);
    s.stage = n; s.stageLines = 0; s.goal = info.goal; s.goalType = info.type; s.level = info.level; s.stageAt = s.tick;
    s.board.fill(0);
    let hole = Math.floor(rnd(s, 'grng') * W);
    for (let k = 0; k < info.rows; k++) {
      // 땅파기는 구멍이 자주 바뀌고, 보통 스테이지는 가끔 바뀜
      if (k === 0 || rnd(s, 'grng') < (info.type === 'dig' ? 0.7 : 0.35)) hole = Math.floor(rnd(s, 'grng') * W);
      const y = H - 1 - k;
      for (let x = 0; x < W; x++) s.board[y * W + x] = x === hole ? 0 : 8;
    }
  }

  function fits(board, p, r, x, y) {
    const c = CELLS[p][r];
    for (let k = 0; k < 4; k++) {
      const cx = x + c[k][0], cy = y + c[k][1];
      if (cx < 0 || cx >= W || cy >= H) return false;
      if (cy >= 0 && board[cy * W + cx]) return false;
    }
    return true;
  }
  const curFits = (s, dx, dy, r) => { const c = s.cur; return fits(s.board, c.p, r == null ? c.r : r, c.x + dx, c.y + dy); };

  function spawn(s, p) {
    if (!p) { p = s.queue.shift(); fill(s); }
    s.cur = { p, r: 0, x: p === 4 ? 4 : 3, y: p === 1 ? 1 : 2 };
    s.grav = 0; s.lockT = 0; s.resets = 0; s.lastRot = false; s.lastKick = 0;
    if (!curFits(s, 0, 0)) { s.cur.y -= 1; if (!curFits(s, 0, 0)) return end(s, 'topout'); }
    if (curFits(s, 0, 1)) s.cur.y += 1;
    s.lowY = s.cur.y;
  }

  function end(s, why) {
    if (s.over) return;
    s.over = true; s.why = why;
    s.ev.push({ t: 'over', why });
  }

  function grounded(s) { return !curFits(s, 0, 1); }
  function moved(s) {
    if (s.cur.y > s.lowY) { s.lowY = s.cur.y; s.resets = 0; s.lockT = 0; return; }
    if (grounded(s) && s.resets < MAX_RESETS) { s.lockT = 0; s.resets++; }
  }

  function move(s, dx) {
    if (!curFits(s, dx, 0)) return false;
    s.cur.x += dx; s.lastRot = false; moved(s); return true;
  }
  function rotate(s, dir) {
    const c = s.cur;
    if (c.p === 4) return false;
    const to = (c.r + dir + 4) % 4;
    const kicks = (c.p === 1 ? KI : K3)[c.r + '>' + to];
    for (let i = 0; i < kicks.length; i++) {
      const dx = kicks[i][0], dy = -kicks[i][1];
      if (fits(s.board, c.p, to, c.x + dx, c.y + dy)) {
        c.r = to; c.x += dx; c.y += dy; s.lastRot = true; s.lastKick = i;
        moved(s);
        return true;
      }
    }
    return false;
  }
  function dropDist(s) { let d = 0; while (curFits(s, 0, d + 1)) d++; return d; }

  function holdPiece(s) {
    if (!s.canHold) return false;
    const p = s.cur.p, h = s.hold;
    s.hold = p; s.canHold = false;
    spawn(s, h || 0);
    s.ev.push({ t: 'hold' });
    return true;
  }

  // T-스핀: 마지막 동작이 회전 + T 상자 네 모서리 중 셋 이상이 막힘. 앞쪽 두 모서리가 다 막혔거나 다섯 번째 차기면 진짜, 아니면 미니
  function tspinKind(s) {
    const c = s.cur;
    if (c.p !== 6 || !s.lastRot) return 0;
    const occ = (x, y) => x < 0 || x >= W || y >= H || (y >= 0 && s.board[y * W + x] !== 0);
    const cs = [occ(c.x, c.y), occ(c.x + 2, c.y), occ(c.x, c.y + 2), occ(c.x + 2, c.y + 2)]; // 왼위 오른위 왼아래 오른아래
    if (cs.filter(Boolean).length < 3) return 0;
    const front = [[0, 1], [1, 3], [2, 3], [0, 2]][c.r];
    return (cs[front[0]] && cs[front[1]]) || s.lastKick === 4 ? 2 : 1;
  }

  function lock(s) {
    const c = s.cur, cells = CELLS[c.p][c.r];
    const ts = tspinKind(s);
    let above = true;
    for (const [dx, dy] of cells) {
      const y = c.y + dy;
      if (y >= 0) s.board[y * W + c.x + dx] = c.p;
      if (y >= HID) above = false;
    }
    s.pieces++;
    s.cur = null;
    // 줄 지우기
    const full = [];
    for (let y = 0; y < H; y++) {
      let k = 0;
      for (let x = 0; x < W; x++) if (s.board[y * W + x]) k++;
      if (k === W) full.push(y);
    }
    const n = full.length;
    if (n) {
      const nb = new Array(W * H).fill(0);
      let ny = H - 1;
      for (let y = H - 1; y >= 0; y--) {
        if (full.includes(y)) continue;
        for (let x = 0; x < W; x++) nb[ny * W + x] = s.board[y * W + x];
        ny--;
      }
      s.board = nb;
    }
    const pc = n > 0 && s.board.every((v) => v === 0);
    const hard = n === 4 || (ts > 0 && n > 0);
    const b2bBonus = hard && s.b2b;
    if (n > 0) { s.combo++; s.b2b = hard; } else s.combo = -1;
    if (s.combo > s.maxCombo) s.maxCombo = s.combo;
    if (ts && n) s.tspins++;
    if (n === 4) s.tetrises++;
    // 점수
    let pts = ts === 2 ? TSPIN_SCORE[n] : ts === 1 ? MINI_SCORE[Math.min(n, 2)] : LINE_SCORE[n];
    if (b2bBonus) pts = Math.floor(pts * 1.5);
    if (s.combo > 0) pts += 50 * s.combo;
    if (pc) pts += PC_SCORE[n];
    s.score += pts * s.level;
    s.lines += n;
    // 공격 줄
    let atk = ts === 2 ? n * 2 : ts === 1 ? [0, 0, 1][Math.min(n, 2)] : LINE_ATK[n];
    if (n && b2bBonus) atk += 1;
    if (n) atk += COMBO_ATK[Math.min(s.combo, COMBO_ATK.length - 1)];
    if (pc) atk += 10;
    let out = atk;
    while (out > 0 && s.garbage.length) { // 받을 방해 줄부터 지움
      const g = s.garbage[0], k = Math.min(out, g.n);
      g.n -= k; out -= k;
      if (!g.n) s.garbage.shift();
    }
    s.ev.push({ t: 'lock', p: c.p, n, ts, b2b: b2bBonus, combo: s.combo, pc, atk, sent: out, pts: pts * s.level, rows: full });
    if (out > 0) { s.sent += out; s.ev.push({ t: 'attack', n: out }); }
    if (above && !n) return end(s, 'lockout');
    if (!n && s.garbage.length) { if (!riseGarbage(s)) return; }
    if (s.mode === 'stage') {
      s.stageLines += n;
      const done = s.goalType === 'dig' ? !s.board.includes(8) : s.stageLines >= s.goal;
      if (done) {
        const bonus = 1000 * s.stage + Math.max(0, 300 - Math.floor((s.tick - s.stageAt) / 60)) * 10 * Math.min(s.stage, 10);
        s.score += bonus;
        s.ev.push({ t: 'stage', cleared: s.stage, bonus, next: s.stage + 1 });
        setupStage(s, s.stage + 1);
        s.canHold = true;
      }
    } else {
      // 대전: 30초마다 조금씩 빨라짐
      s.level = Math.min(10, 1 + Math.floor(s.tick / 1800));
    }
    s.canHold = true;
    spawn(s);
  }

  // 받은 방해 줄을 한 번에 최대 10줄 밀어 올림
  function riseGarbage(s) {
    let k = 0;
    const rows = [];
    while (s.garbage.length && k < 10) {
      const g = s.garbage[0], take = Math.min(g.n, 10 - k);
      for (let i = 0; i < take; i++) rows.push(g.hole);
      k += take; g.n -= take;
      if (!g.n) s.garbage.shift();
    }
    if (!k) return true;
    for (let i = 0; i < k * W; i++) if (s.board[i]) { s.board.fill(8, 0, W * HID); end(s, 'garbage'); return false; }
    s.board = s.board.slice(k * W).concat(new Array(k * W).fill(0));
    rows.forEach((hole, i) => { const y = H - k + i; for (let x = 0; x < W; x++) s.board[y * W + x] = x === hole ? 0 : 8; });
    s.ev.push({ t: 'rise', n: k });
    return true;
  }

  // 상대가 보낸 방해 줄 (hole: 구멍 칸 0~9)
  function addGarbage(s, n, hole) {
    n = Math.max(0, Math.min(20, n | 0));
    if (!n || s.over) return;
    s.garbage.push({ n, hole: Math.max(0, Math.min(W - 1, hole | 0)) });
    s.ev.push({ t: 'incoming', n });
  }
  const pending = (s) => s.garbage.reduce((a, g) => a + g.n, 0);

  function act(s, code) {
    if (s.over || !s.cur) return false;
    switch (code) {
      case 'l': return move(s, -1);
      case 'r': return move(s, 1);
      case 'a': return rotate(s, -1);
      case 'b': return rotate(s, 1);
      case 'c': return holdPiece(s);
      case 'd': s.soft = true; return true;
      case 'u': s.soft = false; return true;
      case 'q': end(s, 'quit'); return true;
      case 'h': {
        const d = dropDist(s);
        s.cur.y += d; s.score += 2 * d;
        if (d) s.lastRot = false;
        s.ev.push({ t: 'drop', d, p: s.cur.p, r: s.cur.r, x: s.cur.x, y: s.cur.y });
        lock(s);
        return true;
      }
    }
    return false;
  }

  function tick(s) {
    if (s.over) return;
    s.tick++;
    if (!s.cur) { spawn(s); return; }
    const g = gravity(s.level);
    s.grav += s.soft ? Math.min(20, g * 20) : g;
    while (s.grav >= 1) {
      s.grav -= 1;
      if (curFits(s, 0, 1)) {
        s.cur.y++; s.lastRot = false;
        if (s.soft) s.score += 1;
        if (s.cur.y > s.lowY) { s.lowY = s.cur.y; s.resets = 0; s.lockT = 0; }
      } else { s.grav = 0; break; }
    }
    if (grounded(s)) {
      if (s.resets >= MAX_RESETS) s.lockT = LOCK;
      if (++s.lockT >= LOCK) lock(s);
    } else s.lockT = 0;
  }

  function ghostY(s) { return s.cur ? s.cur.y + dropDist(s) : 0; }

  /* 입력 기록: [[틱, 코드]...] ↔ 문자열 "앞 입력과의 틱 차이(10진수, 0이면 생략) + 코드" 예) 12l3l0b → "12l3lb" */
  function decode(str) {
    const out = [];
    const re = /([0-9]*)([a-z])/g;
    let m, t = 0;
    while ((m = re.exec(str))) { t += parseInt(m[1] || '0', 10); out.push([t, m[2]]); }
    return out;
  }
  function encode10(list) {
    let out = '', last = 0;
    for (const [t, c] of list) { const d = t - last; out += (d ? d : '') + c; last = t; }
    return out;
  }

  /* 기록 다시 두기 (랭킹 확인용). maxTicks를 넘거나 기록이 끝났는데도 안 끝나면 실패 */
  function replay(seed, inputs, opts) {
    opts = opts || {};
    const list = typeof inputs === 'string' ? decode(inputs) : inputs;
    const s = create({ seed, mode: 'stage', stage: 1 });
    const maxTicks = opts.maxTicks || 60 * 60 * 60 * 3;
    let i = 0;
    while (!s.over && s.tick <= maxTicks) {
      while (i < list.length && list[i][0] === s.tick) { act(s, list[i][1]); i++; if (s.over) break; }
      if (s.over) break;
      if (i < list.length && list[i][0] < s.tick) return { ok: false, why: 'order' };
      tick(s); // 입력이 끝나도 판은 저절로 끝날 때까지 진행
      s.ev.length = 0;
    }
    if (!s.over) return { ok: false, why: 'long' };
    return { ok: true, stage: s.stage, score: s.score, lines: s.lines, ticks: s.tick, why: s.why, pieces: s.pieces, used: i, total: list.length };
  }

  // 판을 짧은 글자로 (온라인에서 상대에게 보여 줄 보이는 20줄만)
  function packBoard(board) {
    let out = '';
    for (let i = HID * W; i < W * H; i++) out += board[i];
    return out;
  }
  function unpackBoard(str) {
    const b = new Array(W * H).fill(0);
    for (let i = 0; i < (W * (H - HID)) && i < str.length; i++) b[HID * W + i] = +str[i] || 0;
    return b;
  }

  const TB = {
    RULES_VERSION, W, H, HID, NAMES, CELLS, NEXT_SHOWN, LOCK, STAGE_LINES, MAX_LEVEL,
    stageInfo, gravity, create, fits, act, tick, ghostY, dropDist, addGarbage, pending,
    encode: encode10, decode, replay, packBoard, unpackBoard,
  };
  root.TB = TB;
  if (typeof module !== 'undefined' && module.exports) module.exports = TB;
})(typeof self !== 'undefined' ? self : this);
