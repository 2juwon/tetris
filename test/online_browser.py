# 로컬 서버 + 브라우저 2개: 랭킹 등록, 온라인 대결 끝까지
# SERVER=http://127.0.0.1:8787 node build.js && python3 -m http.server 8790 &  → python3 test/online_browser.py
import time, os
from playwright.sync_api import sync_playwright
URL = os.environ.get('URL', 'http://127.0.0.1:8790/index.html')
out = '/tmp/shots'; os.makedirs(out, exist_ok=True)
errs = []
AUTO = """(lv) => { window.__auto = setInterval(() => { const G = __TB_TEST__.G; if (!G || !G.started || G.ended || G.s.over || G.q.length) return; G.q.push(...TBAI.plan(G.s, lv, Math.random).acts); }, 140); }"""
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-proxy-server'])
    # 1) 랭킹
    c1 = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    a = c1.new_page(); a.on('pageerror', lambda e: errs.append('A ' + str(e)))
    a.goto(URL); time.sleep(0.6)
    a.click('#goStage'); time.sleep(3.3)
    print('랭킹 도전:', a.evaluate("!!__TB_TEST__.G.run"))
    a.evaluate(AUTO, 'hard'); time.sleep(6)
    a.evaluate("clearInterval(window.__auto)")
    a.keyboard.press('Escape'); time.sleep(0.3); a.click('#mQuit'); time.sleep(1.5)
    a.fill('#rkName', '테스트왕'); a.click('#rkGo'); time.sleep(1.5)
    print('등록:', a.inner_text('#rankBox'))
    a.screenshot(path=f'{out}/rank-done.png')
    a.click('#mRank'); time.sleep(1.2)
    a.screenshot(path=f'{out}/rank-list.png')
    print('랭킹 표:', a.inner_text('#rkList')[:120].replace('\n', ' '))
    a.click('#mClose')
    # 2) 온라인 둘이서
    c2 = b.new_context(viewport={'width': 1280, 'height': 800})
    bb = c2.new_page(); bb.on('pageerror', lambda e: errs.append('B ' + str(e)))
    a.click('#goOnline'); time.sleep(0.4); a.fill('#nm', '휴대폰'); a.click('#mkRoom'); time.sleep(1.2)
    code = a.inner_text('#rCode').strip(); print('방', code)
    bb.goto(URL + '#' + code); time.sleep(0.8)
    if bb.is_visible('#nm'):
        bb.fill('#nm', '컴퓨터앞'); bb.fill('#codeIn', code); bb.click('#joinBtn'); time.sleep(1)
    a.screenshot(path=f'{out}/room.png')
    a.click('#rReady'); bb.click('#rReady'); time.sleep(4.0)
    a.evaluate(AUTO, 'hard')
    # B는 그냥 바로 내리기만 → 빨리 짐
    bb.evaluate("window.__d = setInterval(() => { const G = __TB_TEST__.G; if (G && G.started && !G.ended) G.q.push('h'); }, 250)")
    time.sleep(3)
    a.screenshot(path=f'{out}/online-a.png'); bb.screenshot(path=f'{out}/online-b.png')
    for _ in range(40):
        if a.is_visible('#mRoom'): break
        time.sleep(0.5)
    a.screenshot(path=f'{out}/online-end.png')
    print('A 결과:', a.inner_text('#ovBox')[:80].replace('\n', ' ') if a.is_visible('#ovBox') else '없음')
    print('B 결과:', bb.inner_text('#ovBox')[:80].replace('\n', ' ') if bb.is_visible('#ovBox') else '없음')
    a.click('#mRoom'); time.sleep(0.5)
    print('대기실 승수:', a.inner_text('#rSeats').replace('\n', ' '))
    a.screenshot(path=f'{out}/room-after.png')
    b.close()
print('오류', len(errs)); [print(' ', e) for e in errs[:10]]
