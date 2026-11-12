# 한판 블록

떨어지는 블록을 쌓아 줄을 지우는 게임 (테트리스 방식, 비공식). https://2juwon.github.io/tetris/

- **스테이지 도전**: 10줄을 지우면 다음 스테이지, 5의 배수는 땅파기(깔린 방해 줄 모두 없애기). 3스테이지부터 방해 줄이 깔리고 점점 빨라짐. 이번 주 / 전체 랭킹
- **컴퓨터와 대결**: 초급 · 중급 · 고급
- **사람들과 대결**: 2~4명 온라인 (빠른 참가, 방 번호, 초대 링크 `#번호`)

## 구조
- `src/engine.js` 규칙 엔진 TB (SRS 회전, 7개 봉지, 보관, T-스핀, 공격 줄, 1초 60틱 결정적 진행 + 다시 두기)
- `src/ai.js` 컴퓨터 TBAI · `src/ui.html` 화면 → `node build.js` → `index.html`(Pages), `dist/block.html`(아티팩트)
- `server/` Cloudflare Workers + Durable Objects: Rank(입력 기록을 다시 두어 확인) · Room/Lobby(온라인) · Inbox(의견함, 관리 페이지 `/admin`)
- 서버 주소는 `config.json`. `main`에 server/·engine이 바뀌면 Actions '서버 배포' (Secrets: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, ADMIN_KEY)

## 시험
- `node test/rules.test.js` 규칙 · `node test/sim.js 6` 컴퓨터끼리 대결·다시 두기 시간
- `cd server && npx wrangler dev --var FAST_TEST:1` → `node test/online.test.mjs`
- `python3 test/browser.py` 화면 · `SERVER=http://127.0.0.1:8787 node build.js` + `python3 -m http.server 8790` → `python3 test/online_browser.py` (끝나면 `node build.js`로 되돌리기)
- 규칙·진행을 바꾸면 `src/engine.js`의 `RULES_VERSION`을 1 올릴 것 (예전 화면 기록은 랭킹에서 거절)
