/**
 * test/run-pipeline.js — 네트워크 없이 전체 파이프라인을 검증하는 셀프 테스트.
 *
 * 127.0.0.1 에 가짜 디자이너 포트폴리오 2곳을 띄우고(정적 1 + SPA 1),
 * crawl → clean → analyze 를 실제로 돌린 뒤 핵심 결과를 assert 한다.
 * 외부 웹 접근이 막힌 환경(예: Claude Code 웹)에서도 코드 정확성을 증명할 수 있다.
 *
 * 실행: npm run test:pipeline
 *
 * ⚠️ playwright 브라우저가 필요하다(SPA 폴백 경로). 이 리포는 프리인스톨 chromium
 *    빌드에 맞춰 playwright 를 고정해 두었으므로 `npm run verify` 가 통과하면 함께 동작한다.
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT_A = 8901;
const PORT_B = 8902;

// ── fixture HTML ────────────────────────────────────────────────
const NAV = `<nav><a href="/">home</a> <a href="/works">works</a> <a href="/about">about</a></nav>`;
const FOOTER = `<footer>© 2024 studio · seoul · studio@example.com · +82 2 123 4567</footer>`;
const page = (title, body) =>
  `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title>` +
  `<style>.x{color:red}</style><script>console.log('noise')</script></head>` +
  `<body><header>스튜디오 A</header>${NAV}<main>${body}</main>${FOOTER}</body></html>`;

const A = {
  '/': page('스튜디오 A', `<h1>스튜디오 A</h1><p>2024</p><p>서울 기반 그래픽 디자인 스튜디오입니다.</p>`),
  '/works': page('작업', `<h1>작업</h1><ul>
     <li><a href="/works/poster-rhythm">도시의 리듬</a></li>
     <li><a href="/works/book-white">여백의 감각</a></li>
     <li><a href="/works/identity-en">Identity (EN)</a></li></ul>`),
  '/works/poster-rhythm': page('도시의 리듬', `<article><h2>도시의 리듬</h2>
     <p>이 포스터는 도시의 불규칙한 리듬을 감각적인 타이포그래피로 재해석한 작업입니다.
     넓은 여백을 남기고 굵은 활자로 화면을 단순하게 다듬었습니다. 활자의 크기와 간격을
     세밀하게 조율하며 도시의 소음과 정적을 시각적인 리듬으로 번역하려 했습니다.</p>
     <p>강렬한 색을 절제하고 검정과 흰색의 대비를 강조했습니다. 인쇄 과정에서는 종이의
     질감과 잉크의 농도를 반복해서 실험하며 물성을 드러냈습니다.</p></article>`),
  '/works/book-white': page('여백의 감각', `<article><h2>여백의 감각</h2>
     <p>전시 도록을 위한 이 작업은 여백을 하나의 언어로 다루었습니다. 이미지와 글자 사이의
     간격을 섬세하게 조율해 조용하고 단정한 리듬을 만들었습니다. 페이지를 넘길 때마다 밀도가
     달라지도록 설계해 독자가 속도를 스스로 조절하게 했습니다.</p>
     <p>종이의 질감과 인쇄의 밀도를 실험하며 물성을 드러내려 했습니다.</p></article>`),
  '/works/identity-en': page('Identity (EN)', `<article><h2>Brand Identity</h2>
     <p>This project explores a flexible identity system built on a modular grid.
     The logotype adapts across print and screen while keeping a consistent rhythm and tone.</p></article>`),
  '/about': page('소개', `<article><h2>소개</h2>
     <p>스튜디오 A는 2015년 서울에서 설립된 그래픽 디자인 스튜디오입니다. 책과 포스터,
     아이덴티티를 중심으로 문화 예술 분야의 여러 클라이언트와 꾸준히 협업해 왔습니다.</p>
     <p>연락처 studio@example.com</p></article>`),
};

const B_DATA = {
  '/': { title: '스튜디오 B', h: '스튜디오 B', body: '실험적인 타이포그래피와 출판을 다루는 스튜디오.' },
  '/project/grid': {
    title: '그리드 실험', h: '그리드 실험',
    body: '이 프로젝트는 유동적인 그리드를 실험한 출판물입니다. 활자의 크기와 자간을 세밀하게 변주하며 페이지마다 다른 밀도를 만들었습니다. 규칙을 세우고 그 규칙을 스스로 깨뜨리는 과정을 반복했습니다.',
  },
};
const spaShell = (pathname) => {
  const links = Object.keys(B_DATA).map((p) => `<a href="${p}">${p}</a>`).join(' ');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>loading</title></head>` +
    `<body><nav>${links}</nav><main id="app"></main><script>` +
    `const DATA=${JSON.stringify(B_DATA)};const d=DATA[location.pathname]||DATA['/'];` +
    `document.title=d.title;document.getElementById('app').innerHTML='<article><h1>'+d.h+'</h1><p>'+d.body+'</p></article>';` +
    `</script></body></html>`;
};

function startServers() {
  const robots = (res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('User-agent: *\nDisallow: /private\n');
  };
  const sA = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/robots.txt') return robots(res);
    const html = A[u.pathname];
    if (html) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); }
    else res.writeHead(404).end('404');
  });
  const sB = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/robots.txt') return robots(res);
    if (B_DATA[u.pathname]) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(spaShell(u.pathname)); }
    else res.writeHead(404).end('404');
  });
  return Promise.all([
    new Promise((r) => sA.listen(PORT_A, '127.0.0.1', () => r(sA))),
    new Promise((r) => sB.listen(PORT_B, '127.0.0.1', () => r(sB))),
  ]);
}

function run(script, env) {
  return new Promise((resolve, reject) => {
    const p = spawn('node', [path.join('scripts', script), 'studio-a', 'studio-b'], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${script} exit ${code}\n${out}`))));
  });
}

async function main() {
  // 이전 실행물 정리 (fixture slug만)
  for (const dir of ['raw', 'cleaned']) {
    for (const slug of ['studio-a', 'studio-b']) {
      await rm(path.join(ROOT, 'data', dir, `${slug}.json`), { force: true });
    }
  }
  await mkdir(path.join(ROOT, 'data', 'results'), { recursive: true });

  const servers = await startServers();
  const sitesFile = path.join(ROOT, 'test', 'sites.fixture.json');
  try {
    console.log('· crawl …');
    const crawlOut = await run('crawl.js', { SITES_FILE: sitesFile });
    assert.match(crawlOut, /studio-a: 6p/, '정적 사이트 6페이지 수집 실패');
    assert.match(crawlOut, /cheerio/, '정적 사이트가 cheerio로 처리되지 않음');
    assert.match(crawlOut, /studio-b[\s\S]*playwright/, 'SPA가 playwright 폴백으로 안 감');

    console.log('· clean …');
    await run('clean.js', {});
    const cleanedA = JSON.parse(await readFile(path.join(ROOT, 'data', 'cleaned', 'studio-a.json'), 'utf8'));
    assert.ok(cleanedA.stats.boilerplateLines >= 1, '반복 블록(헤더) 제거 실패');
    assert.ok(cleanedA.pages.some((p) => p.lang === 'en'), '영문 페이지 lang 판정 실패');
    assert.ok(cleanedA.pages.some((p) => p.lang === 'ko'), '한글 페이지 lang 판정 실패');

    console.log('· analyze …');
    await run('analyze.js', {});
    const tfidf = JSON.parse(await readFile(path.join(ROOT, 'data', 'results', 'tfidf.json'), 'utf8'));
    const report = await readFile(path.join(ROOT, 'data', 'results', 'report.md'), 'utf8');
    const sigA = tfidf.signatures.find((s) => s.slug === 'studio-a').signature.map((x) => x.term);
    const sigB = tfidf.signatures.find((s) => s.slug === 'studio-b').signature.map((x) => x.term);
    assert.ok(sigA.includes('여백') || sigA.includes('리듬'), 'studio-a 시그니처에 기대 단어 없음');
    assert.ok(sigB.includes('그리드') || sigB.includes('출판물'), 'studio-b 시그니처에 기대 단어 없음');
    // 동사/형용사가 기본형(-다)으로 집계되는지
    assert.match(report, /남기다|다듬다|만들다/, '동사 기본형 집계 실패');
    assert.match(report, /세밀하다|넓다|굵다/, '형용사 기본형 집계 실패');

    console.log('\n✅ 파이프라인 셀프 테스트 통과 (crawl · clean · analyze).');
  } finally {
    servers.forEach((s) => s.close());
  }
}

main().catch((e) => {
  console.error('\n❌ 테스트 실패:', e.message);
  process.exit(1);
});
