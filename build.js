// node build.js → index.html (GitHub Pages용 완성본), dist/block.html (아티팩트)
// SERVER=http://127.0.0.1:8787 node build.js → 로컬 서버 시험용 (끝나면 꼭 그냥 node build.js로 되돌릴 것)
const fs = require('fs');
const core = fs.readFileSync(__dirname + '/src/engine.js', 'utf8') + '\n' + fs.readFileSync(__dirname + '/src/ai.js', 'utf8');
const ui = fs.readFileSync(__dirname + '/src/ui.html', 'utf8');
const cfg = JSON.parse(fs.readFileSync(__dirname + '/config.json', 'utf8'));
const server = process.env.SERVER != null ? process.env.SERVER : (cfg.server || '');
const withCore = ui.replace('<!--CORE-->', () => '<script id="core">\n' + core + '\n</script>');
const body = withCore.replace("'__SERVER_URL__'", JSON.stringify(server));
const artifact = withCore.replace("'__SERVER_URL__'", "''"); // 아티팩트는 다른 서버에 접속할 수 없음
fs.mkdirSync(__dirname + '/dist', { recursive: true });
const head = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#070b16">
<meta name="description" content="떨어지는 블록을 쌓아 줄을 지우는 게임. 스테이지 도전과 주간 랭킹, 컴퓨터(초급·중급·고급)와 대결, 2~4명 온라인 대결.">
<meta property="og:title" content="한판 블록">
<meta property="og:description" content="스테이지 랭킹 · 컴퓨터와 대결 · 사람들과 온라인 대결">
`;
const wrap = (b) => { const e = b.indexOf('</style>') + 8; return head + b.slice(0, e) + '\n</head>\n<body>\n' + b.slice(e) + '\n</body>\n</html>\n'; };
fs.writeFileSync(__dirname + '/index.html', wrap(body));
fs.writeFileSync(__dirname + '/dist/block.html', wrap(artifact));
console.log('index.html', fs.statSync(__dirname + '/index.html').size, 'bytes (서버 ' + (server || '없음') + ') / dist/block.html', fs.statSync(__dirname + '/dist/block.html').size, 'bytes');
