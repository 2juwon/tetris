/* 스테이지 랭킹
 * 새 게임을 시작할 때 서버가 도전 번호·열쇠·씨앗을 줌 → 게임이 끝나면 입력 기록을 보내고
 * 서버가 같은 씨앗으로 처음부터 다시 두어 스테이지·점수·줄 수를 확인한 뒤에만 표에 올림.
 * 순서: 스테이지가 높을수록 → 점수가 높을수록 → 먼저 올린 사람
 * 한계: 기록을 사람이 아닌 프로그램이 만들어도(시간은 실제 시간보다 빠를 수 없게만 막음) 구별하지 못함 → 관리 페이지에서 지움
 */
import { DurableObject } from 'cloudflare:workers';
import TB from '../../src/engine.js';

const KEEP = 100;
const RUN_TTL = 4 * 86400000;          // 시작하고 4일 지나면 도전 정보 정리 (화면은 3일까지 등록 가능)
const STARTS_PER_HOUR = 60;
const MAX_INPUT = 1500000;             // 입력 기록 최대 글자 수
const DAY = 86400000, KST = 9 * 3600000;
export const weekOf = (t) => Math.floor((t + KST - 4 * DAY) / (7 * DAY));
export const weekStart = (w) => w * 7 * DAY + 4 * DAY - KST;
const WEEKS_KEPT = 12;
const wk = (w) => 'w:' + String(w).padStart(5, '0');

const hex = (bytes) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
export function cleanRankName(s) {
  s = String(s || '').replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, 8).join('');
}
export const order = (x, y) => y.stage - x.stage || y.score - x.score || x.at - y.at;

export class Rank extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.fast = !!(env && env.FAST_TEST);
  }
  async tidy() {
    const now = Date.now();
    if (now - (this.lastTidy || 0) < 3600 * 1000) return;
    this.lastTidy = now;
    const old = await this.ctx.storage.list({ prefix: 'r:', end: 'r:' + (now - RUN_TTL).toString(36), limit: 500 });
    if (old.size) await this.ctx.storage.delete([...old.keys()]);
    const oldW = await this.ctx.storage.list({ prefix: 'w:', end: wk(weekOf(now) - WEEKS_KEPT), limit: 500 });
    if (oldW.size) await this.ctx.storage.delete([...oldW.keys()]);
  }
  async stats() { return (await this.ctx.storage.get('stats')) || { starts: 0, saved: 0 }; }
  async weekBoard(w) {
    const b = await this.ctx.storage.get(wk(w));
    if (b) return b;
    const all = (await this.ctx.storage.get('b:stage')) || { list: [] };
    return { list: all.list.filter((e) => weekOf(e.at) === w).map((e) => ({ ...e })).sort(order) };
  }

  async start(who, v) {
    if (v !== TB.RULES_VERSION) return { error: '게임이 새로 바뀌었어요. 새로고침한 뒤 다시 시작해 주세요' };
    await this.tidy();
    const hour = Math.floor(Date.now() / 3600000);
    const lk = 'l:' + who;
    const l = (await this.ctx.storage.get(lk)) || { hour, n: 0 };
    if (l.hour !== hour) { l.hour = hour; l.n = 0; }
    if (l.n >= STARTS_PER_HOUR) return { error: '새 게임을 너무 자주 시작했어요. 잠시 뒤에 다시 해 주세요' };
    l.n += 1;
    await this.ctx.storage.put(lk, l);
    const at = Date.now();
    const id = at.toString(36) + hex(6);
    const token = hex(16);
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
    await this.ctx.storage.put('r:' + id, { token, at, seed });
    const st = await this.stats(); st.starts += 1; await this.ctx.storage.put('stats', st);
    return { run: id, token, seed };
  }

  async finish(body) {
    const id = String(body.run || '');
    if (!/^[a-z0-9]{6,12}[a-f0-9]{12}$/.test(id)) return { error: '이 게임은 랭킹 도전으로 시작하지 않았어요' };
    const r = await this.ctx.storage.get('r:' + id);
    if (!r || r.token !== String(body.token || '')) return { error: '랭킹 도전 기록을 찾지 못했어요 (3일이 지났을 수 있어요)' };
    if (r.done) return { error: '이미 등록한 기록이에요' };
    if (body.v !== TB.RULES_VERSION) { r.done = true; await this.ctx.storage.put('r:' + id, r); return { error: '예전 화면으로 한 게임이라 등록할 수 없어요. 새로고침한 뒤 새 게임부터 해 주세요' }; }
    const name = cleanRankName(body.name);
    if (!name) return { error: '이름을 넣어 주세요' };
    const inputs = String(body.inputs || '');
    if (inputs.length > MAX_INPUT || !/^[0-9lrabhcduq]*$/.test(inputs)) return { error: '기록이 이상해요' };
    const now = Date.now();
    const realTicks = (now - r.at) / 1000 * 60;
    const res = TB.replay(r.seed, inputs, { maxTicks: this.fast ? 0 : Math.ceil(realTicks * 1.03 + 600) }); // 실제 걸린 시간보다 빠른 기록은 안 됨
    const claim = body.claim || {};
    if (!res.ok || res.score !== claim.score || res.stage !== claim.stage || res.lines !== claim.lines) {
      r.fails = (r.fails || 0) + 1;
      if (r.fails >= 3) r.done = true;
      await this.ctx.storage.put('r:' + id, r);
      await this.report(res.ok ? '점수 불일치' : '다시 두기 실패(' + res.why + ')', id, { claim, got: res.ok ? { stage: res.stage, score: res.score, lines: res.lines } : null, len: inputs.length, ms: now - r.at, seed: r.seed });
      return { error: res.why === 'long' ? '기록 시간이 맞지 않아 확인할 수 없어요' : '기록을 확인하지 못했어요. 관리자에게 자동으로 알렸어요' };
    }
    if (res.score <= 0) return { error: '점수가 있어야 올릴 수 있어요' };
    r.done = true;
    await this.ctx.storage.put('r:' + id, r);
    const entry = { id: hex(6), run: id, name, stage: res.stage, score: res.score, lines: res.lines, ms: Math.round(res.ticks / 60 * 1000), at: now };
    const put = async (key, b) => {
      b.list.push(entry); b.list.sort(order);
      const idx = b.list.findIndex((e) => e.id === entry.id);
      b.list = b.list.slice(0, KEEP);
      await this.ctx.storage.put(key, b);
      return idx >= 0 && idx < KEEP ? idx + 1 : null;
    };
    const w = weekOf(now);
    const wb = await this.weekBoard(w);
    const place = await put('b:stage', (await this.ctx.storage.get('b:stage')) || { list: [] });
    const weekPlace = await put(wk(w), wb);
    const st = await this.stats(); st.saved += 1; await this.ctx.storage.put('stats', st);
    return { ok: true, place, weekPlace, stage: res.stage, score: res.score };
  }

  async board(period) {
    const st = await this.stats();
    const pub = (e) => { const { run, ...rest } = e; return rest; };
    if (period === 'week') {
      const w = weekOf(Date.now());
      const b = await this.weekBoard(w);
      return { period: 'week', list: b.list.map(pub), starts: st.starts, saved: st.saved, weekStart: weekStart(w), weekEnd: weekStart(w + 1) };
    }
    const b = (await this.ctx.storage.get('b:stage')) || { list: [] };
    return { period: 'all', list: b.list.map(pub), starts: st.starts, saved: st.saved };
  }
  // 전체 표와 주간 표에서 같이 지움
  async remove(id) {
    const b = await this.ctx.storage.get('b:stage');
    if (!b) return false;
    const gone = b.list.find((e) => e.id === id);
    if (!gone) return false;
    b.list = b.list.filter((e) => e.id !== id);
    await this.ctx.storage.put('b:stage', b);
    const weeks = await this.ctx.storage.list({ prefix: 'w:' });
    for (const [k, wb] of weeks) {
      const before = wb.list.length;
      wb.list = wb.list.filter((e) => e.id !== id);
      if (wb.list.length < before) await this.ctx.storage.put(k, wb);
    }
    return true;
  }
  async report(why, id, ctx) {
    try {
      const inbox = this.env.INBOX.get(this.env.INBOX.idFromName('main'));
      await inbox.add({ kind: 'bug', text: '[자동] 랭킹 등록 확인 실패 — ' + why, context: { auto: 'rank', run: id, ...ctx } }, 'rank-auto-' + id + '-' + Date.now());
    } catch (e) { console.error('report', e); }
  }
}
