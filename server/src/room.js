/* 온라인 대결 방 (2~4명)
 * 판 진행은 각자 화면이 하고, 방은 이어 주기만 함: 같은 씨앗 나눠 주기 · 판 모양 전하기 · 공격 줄 받을 사람 고르기 · 탈락 순서 · 승수
 * 모두 '준비'를 누르면 3초 뒤 시작. 마지막 한 명이 남으면 끝나고 대기실로.
 * 대결 중 연결이 끊기면 판을 이어 갈 수 없으므로 바로 탈락.
 */
import { DurableObject } from 'cloudflare:workers';

const MAX = 4;
const EMPTY_ROOM_MS = 30 * 60 * 1000;
const OPEN_ROOM_TTL = 10 * 60 * 1000;
const ROUND_MAX_MS = 20 * 60 * 1000;
const START_DELAY = 3000;
const KO_WINDOW = 10000;

function rand32() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; }
export const randomCode = () => String(100000 + (rand32() % 900000));
export const lobbyStub = (env) => env.LOBBY.get(env.LOBBY.idFromName('main'));
export const roomStub = (env, code) => env.ROOM.get(env.ROOM.idFromName(code));
export function cleanName(s) {
  s = String(s || '').replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, 8).join('') || '손님';
}
const emptySeat = () => ({ kind: 'empty', pid: null, name: '', ready: false, wins: 0, offAt: 0 });

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    ctx.blockConcurrencyWhile(async () => { this.room = (await ctx.storage.get('room')) || null; });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  async init(code, isPublic) {
    if (this.room) return false;
    this.room = { v: 1, code, created: Date.now(), public: !!isPublic, seats: Array.from({ length: MAX }, emptySeat), status: 'waiting', round: 0, game: null, last: null };
    await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_MS);
    await this.save();
    return true;
  }
  async save() { if (this.room) await this.ctx.storage.put('room', this.room); }
  sockets() { return this.ctx.getWebSockets().filter((ws) => ws.readyState === 1); }
  pidOf(ws) { try { return (ws.deserializeAttachment() || {}).pid || null; } catch (e) { return null; } }
  online(except) { const set = new Set(); for (const ws of this.sockets()) if (ws !== except) { const p = this.pidOf(ws); if (p) set.add(p); } return set; }
  seatOf(pid) { return pid && this.room ? this.room.seats.findIndex((s) => s.pid === pid) : -1; }
  sendTo(seat, obj) {
    const pid = this.room.seats[seat] && this.room.seats[seat].pid;
    const msg = JSON.stringify(obj);
    for (const ws of this.sockets()) if (this.pidOf(ws) === pid) { try { ws.send(msg); } catch (e) { /* 끊김 */ } }
  }
  sendAll(obj, exceptSeat) {
    const msg = JSON.stringify(obj);
    for (const ws of this.sockets()) {
      if (exceptSeat != null && this.seatOf(this.pidOf(ws)) === exceptSeat) continue;
      try { ws.send(msg); } catch (e) { /* 끊김 */ }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server);
    const pid = (url.searchParams.get('pid') || '').toLowerCase();
    server.serializeAttachment({ pid });
    const fail = (code, message) => {
      try { server.send(JSON.stringify({ t: 'error', fatal: true, code, message })); server.close(4000, code); } catch (e) { /* 닫힘 */ }
      return new Response(null, { status: 101, webSocket: client });
    };
    if (!/^[a-f0-9]{16,64}$/.test(pid)) return fail('bad_player', '접속 정보가 올바르지 않아요. 새로고침해 주세요');
    if (!this.room) return fail('no_room', '없는 방이에요. 방 번호를 확인해 주세요');
    const res = this.join(pid, cleanName(url.searchParams.get('name')));
    if (!res.ok) return fail(res.code, res.message);
    // 같은 사람이 예전 연결을 남겨 뒀으면 닫음
    for (const ws of this.ctx.getWebSockets()) if (ws !== server && this.pidOf(ws) === pid) { try { ws.close(4001, 'replaced'); } catch (e) { /* 무시 */ } }
    await this.changed({ lobby: true });
    return new Response(null, { status: 101, webSocket: client });
  }

  join(pid, name) {
    const r = this.room;
    let i = this.seatOf(pid);
    if (i >= 0) {
      const s = r.seats[i];
      s.offAt = 0;
      if (r.status === 'waiting') s.name = this.uniqueName(name, i);
      return { ok: true };
    }
    i = r.seats.findIndex((s) => s.kind === 'empty');
    if (i < 0) return { ok: false, code: 'full', message: '방이 꽉 찼어요 (4명)' };
    r.seats[i] = { ...emptySeat(), kind: 'human', pid, name: this.uniqueName(name, i) };
    return { ok: true };
  }
  uniqueName(name, idx) {
    const used = new Set(this.room.seats.filter((s, j) => j !== idx && s.kind !== 'empty').map((s) => s.name));
    if (!used.has(name)) return name;
    for (let k = 2; k < 10; k++) { const n = Array.from(name).slice(0, 7).join('') + k; if (!used.has(n)) return n; }
    return name;
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > 1200) return;
    let m;
    try { m = JSON.parse(data); } catch (e) { return; }
    const r = this.room;
    if (!r || !m || typeof m.t !== 'string') return;
    const pid = this.pidOf(ws), seat = this.seatOf(pid);
    if (seat < 0) return;
    const g = r.game;
    const alive = g && r.status === 'playing' && g.alive[seat];
    try {
      switch (m.t) {
        case 'b': // 판 모양 → 다른 사람에게
          if (!alive || typeof m.b !== 'string' || m.b.length > 200 || !/^[0-8]*$/.test(m.b)) return;
          g.stats[seat].sent = Math.max(0, Math.min(9999, m.sent | 0));
          return this.sendAll({ t: 'ob', seat, b: m.b, p: Math.max(0, Math.min(99, m.p | 0)) }, seat);
        case 'atk': {
          if (!alive) return;
          const n = Math.max(1, Math.min(20, m.n | 0));
          const others = g.players.filter((p) => p !== seat && g.alive[p]);
          if (!others.length) return;
          const target = others[rand32() % others.length];
          g.lastHit[target] = { by: seat, at: Date.now() };
          this.sendTo(target, { t: 'g', n, hole: rand32() % 10, from: seat });
          return;
        }
        case 'dead':
          if (!alive) return;
          return this.die(seat);
        case 'ready': {
          if (r.status !== 'waiting') return;
          r.seats[seat].ready = !!m.on;
          return this.maybeStart();
        }
        case 'leave':
          return this.leave(pid);
        case 'hello':
          return this.changed();
      }
    } catch (e) {
      console.error('message', e);
    }
  }

  async maybeStart() {
    const r = this.room;
    const on = this.online();
    const here = r.seats.map((s, i) => [s, i]).filter(([s]) => s.kind === 'human' && on.has(s.pid));
    if (r.status === 'waiting' && here.length >= 2 && here.every(([s]) => s.ready)) {
      const players = here.map(([, i]) => i);
      r.round += 1;
      r.status = 'playing';
      r.game = {
        round: r.round, seed: rand32() || 1, startAt: Date.now(), players,
        alive: Object.fromEntries(players.map((p) => [p, true])), dead: [], lastHit: {},
        stats: Object.fromEntries(players.map((p) => [p, { sent: 0, ko: 0 }])),
      };
      r.seats.forEach((s) => { s.ready = false; });
      await this.ctx.storage.setAlarm(Date.now() + ROUND_MAX_MS);
      await this.save();
      this.sendAll({ t: 'start', round: r.round, seed: r.game.seed, delay: START_DELAY, players: players.map((p) => ({ seat: p, name: r.seats[p].name })) });
    }
    return this.changed({ lobby: true });
  }

  async die(seat, quiet) {
    const r = this.room, g = r.game;
    if (!g || !g.alive[seat]) return;
    g.alive[seat] = false;
    g.dead.push(seat);
    const left = g.players.filter((p) => g.alive[p]).length;
    const hit = g.lastHit[seat];
    let by = -1;
    if (hit && Date.now() - hit.at < KO_WINDOW && hit.by !== seat) { by = hit.by; g.stats[by].ko++; }
    this.sendAll({ t: 'ko', seat, place: left + 1, by });
    if (left <= 1) return this.finish();
    if (!quiet) await this.changed();
  }

  async finish() {
    const r = this.room, g = r.game;
    if (!g) return;
    const alive = g.players.filter((p) => g.alive[p]).sort((a, b) => g.stats[b].sent - g.stats[a].sent);
    const seq = alive.concat(g.dead.slice().reverse());
    const order = seq.map((seat, k) => ({ seat, place: k + 1, name: r.seats[seat].name || '나간 사람', sent: g.stats[seat].sent, ko: g.stats[seat].ko }));
    if (alive.length === 1 && r.seats[alive[0]].kind === 'human') r.seats[alive[0]].wins++;
    r.last = { round: g.round, order };
    r.status = 'waiting';
    r.game = null;
    r.seats.forEach((s, i) => { s.ready = false; if (s.kind === 'human' && s.offAt && !this.online().has(s.pid)) r.seats[i] = emptySeat(); });
    this.sendAll({ t: 'end', round: r.last.round, order });
    await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_MS);
    await this.changed({ lobby: true });
  }

  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch (e) { /* 닫힘 */ }
    await this.dropped(ws);
  }
  async webSocketError(ws) { await this.dropped(ws); }
  async dropped(ws) {
    const r = this.room;
    if (!r) return;
    const pid = this.pidOf(ws), i = this.seatOf(pid);
    if (i < 0) return;
    const on = this.online(ws);
    if (on.has(pid)) return;
    if (r.status === 'playing' && r.game && r.game.alive[i]) await this.die(i, true);
    if (!this.room) return;
    if (r.status === 'waiting') r.seats[i] = { ...emptySeat(), wins: 0 };
    else r.seats[i].offAt = Date.now();
    await this.changed({ lobby: true, except: ws });
  }
  async leave(pid) {
    const r = this.room, i = this.seatOf(pid);
    if (i >= 0) {
      if (r.status === 'playing' && r.game && r.game.alive[i]) await this.die(i, true);
      if (r.status === 'playing') r.seats[i].offAt = Date.now(), r.seats[i].pid = 'gone:' + pid;
      else r.seats[i] = emptySeat();
    }
    for (const w of this.ctx.getWebSockets()) if (this.pidOf(w) === pid) { try { w.close(1000, 'left'); } catch (e) { /* 무시 */ } }
    await this.changed({ lobby: true });
    if (this.room && this.room.status === 'waiting') await this.maybeStartQuiet();
  }
  async maybeStartQuiet() { /* 남은 사람이 모두 준비면 시작 */ const r = this.room; if (r && r.status === 'waiting' && r.seats.some((s) => s.ready)) await this.maybeStart(); }

  async alarm() {
    const r = this.room;
    if (!r) return;
    if (r.status === 'playing' && r.game && Date.now() - r.game.startAt >= ROUND_MAX_MS - 1000) { await this.finish(); return; }
    if (this.online().size) { await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_MS); return; }
    try { await lobbyStub(this.env).remove(r.code); } catch (e) { /* 무시 */ }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.room = null;
  }

  async changed(opt = {}) {
    const r = this.room;
    if (!r) return;
    await this.save();
    const on = this.online(opt.except);
    const g = r.game;
    const seats = r.seats.map((s, i) => ({
      kind: s.kind, name: s.name, wins: s.wins, ready: s.ready, online: s.kind === 'human' && on.has(s.pid),
      inGame: !!(g && g.players.includes(i)), alive: !!(g && g.alive[i]),
    }));
    const room = { code: r.code, status: r.status, round: r.round, seats, last: r.last, public: r.public };
    for (const ws of this.sockets()) {
      if (ws === opt.except) continue;
      try { ws.send(JSON.stringify({ t: 'state', seat: this.seatOf(this.pidOf(ws)), room })); } catch (e) { /* 끊김 */ }
    }
    if (opt.lobby) {
      const humans = r.seats.filter((s) => s.kind === 'human' && on.has(s.pid)).length;
      try { await lobbyStub(this.env).update({ code: r.code, public: r.public, status: r.status, humans, max: MAX }); } catch (e) { console.error('lobby', e); }
    }
  }
}

export class Lobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rooms = {};
    ctx.blockConcurrencyWhile(async () => { this.rooms = (await ctx.storage.get('rooms')) || {}; });
  }
  async save() { await this.ctx.storage.put('rooms', this.rooms); }
  prune() { const now = Date.now(); for (const [c, r] of Object.entries(this.rooms)) if (now - r.updated > 2 * 3600000) delete this.rooms[c]; }
  async update(info) {
    if (!info || !info.code) return;
    const cur = this.rooms[info.code];
    if (!info.public) { if (cur) { delete this.rooms[info.code]; await this.save(); } return; }
    this.rooms[info.code] = { ...cur, ...info, created: cur ? cur.created : Date.now(), updated: Date.now() };
    this.prune();
    await this.save();
  }
  async remove(code) { if (this.rooms[code]) { delete this.rooms[code]; await this.save(); } }
  open() { const now = Date.now(); return Object.values(this.rooms).filter((r) => r.public && r.status === 'waiting' && r.humans < r.max && now - r.updated < OPEN_ROOM_TTL); }
  // 사람이 기다리는 공개 방(많은 곳부터) → 빈 공개 방 → 새로 만들기
  async quick() {
    const open = this.open().sort((a, b) => b.humans - a.humans || a.created - b.created);
    if (open.length) { open[0].updated = Date.now(); open[0].humans++; await this.save(); return { code: open[0].code }; }
    for (let k = 0; k < 6; k++) {
      const code = randomCode();
      if (await roomStub(this.env, code).init(code, true)) {
        const now = Date.now();
        this.rooms[code] = { code, public: true, status: 'waiting', humans: 0, max: MAX, created: now, updated: now };
        await this.save();
        return { code };
      }
    }
    throw new Error('방을 만들지 못했어요');
  }
  async stats() {
    const now = Date.now(), open = this.open();
    const playing = Object.values(this.rooms).filter((r) => r.public && r.status === 'playing' && now - r.updated < 3600000).length;
    return { waitingRooms: open.filter((r) => r.humans > 0).length, waitingPlayers: open.reduce((n, r) => n + r.humans, 0), playingRooms: playing };
  }
}
