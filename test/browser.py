# python3 test/browser.py [파일] — 휴대폰·PC 폭에서 첫 화면, 스테이지, 컴퓨터 대결 화면을 찍고 오류를 모음
import sys, os, time
from playwright.sync_api import sync_playwright
f = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else 'dist/block.html')
out = '/tmp/shots'; os.makedirs(out, exist_ok=True)
errs = []
# 컴퓨터(고급) 판단으로 내 판을 두는 도우미
AUTOPLAY = """
(n) => { const T = window.__TB_TEST__; const G = T.G; let k = 0;
  return new Promise(res => { const iv = setInterval(() => { const G = T.G; if (!G || G.ended || G.s.over || k >= n) { clearInterval(iv); res(k); return; }
    if (!G.started || G.q.length) return;
    const p = TBAI.plan(G.s, 'hard', Math.random); G.q.push(...p.acts); k++; }, 60); }); }
"""
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--autoplay-policy=no-user-gesture-required'])
    for name, vp, mobile in [('phone', {'width': 390, 'height': 844}, True), ('pc', {'width': 1280, 'height': 800}, False)]:
        ctx = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile, device_scale_factor=2 if mobile else 1)
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'fonts' not in m.text else None)
        pg.goto('file://' + f)
        time.sleep(0.8)
        pg.screenshot(path=f'{out}/{name}-home.png')
        pg.click('#goStage'); time.sleep(3.4)
        n = pg.evaluate(AUTOPLAY, 45)
        time.sleep(0.4)
        pg.screenshot(path=f'{out}/{name}-stage.png')
        st = pg.evaluate("(() => { const s = __TB_TEST__.G.s; return { stage: s.stage, lines: s.lines, score: s.score, over: s.over, recs: __TB_TEST__.G.rec.length }; })()")
        print(name, 'stage', st)
        # 그만하고 결과
        pg.keyboard.press('Escape'); time.sleep(0.3)
        pg.screenshot(path=f'{out}/{name}-pause.png')
        pg.click('#mQuit'); time.sleep(1.4)
        pg.screenshot(path=f'{out}/{name}-result.png')
        pg.click('#mHome'); time.sleep(0.3)
        pg.click('#goCpu'); time.sleep(0.3)
        pg.screenshot(path=f'{out}/{name}-cpupick.png')
        pg.click('[data-lv=normal]'); time.sleep(3.3)
        pg.evaluate(AUTOPLAY, 25); time.sleep(0.2)
        pg.screenshot(path=f'{out}/{name}-cpu.png')
        cs = pg.evaluate("(() => { const G = __TB_TEST__.G; return G ? { me: G.s.sent, cpu: G.opps[0].s.sent, cpuLines: G.opps[0].s.lines, ended: G.ended } : null; })()")
        print(name, 'cpu', cs)
        pg.click('#goRank') if pg.is_visible('#goRank') else None
        ctx.close()
    b.close()
print('오류', len(errs)); [print(' ', e) for e in errs[:10]]
