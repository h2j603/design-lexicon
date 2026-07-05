/**
 * Phase 0 — 환경 검증 (Environment verification)
 *
 * 실제 크롤링/분석을 시작하기 전에, 이 프로젝트가 의존하는 런타임이
 * 모두 정상 동작하는지 확인한다:
 *   1. Node 버전
 *   2. garu-ko 형태소 분석기가 Node에서 로드되고 샘플 문장을 분석하는지
 *      (세종 태그 NNG/NNP/VV/VA 가 실제로 나오는지)
 *   3. playwright 브라우저 바이너리를 실행할 수 있는지 (SPA 폴백 대비)
 *   4. cheerio 로 정적 HTML 파싱이 되는지
 *
 * 하나라도 실패하면 non-zero 로 종료한다.
 *
 * 실행: npm run verify
 */

let failures = 0;

function ok(label, detail = '') {
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}
function fail(label, err) {
  failures++;
  console.log(`  ✗ ${label}`);
  if (err) console.log(`      ${String(err.stack || err).split('\n').slice(0, 4).join('\n      ')}`);
}
function section(title) {
  console.log(`\n${title}`);
}

// ── 1. Node 런타임 ──────────────────────────────────────────────
section('[1] Node 런타임');
{
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) ok('Node 버전', `v${process.versions.node}`);
  else fail(`Node 버전이 너무 낮음 (v${process.versions.node}, >=20 필요)`);
}

// ── 2. garu-ko 형태소 분석 ──────────────────────────────────────
section('[2] garu-ko 형태소 분석기');
{
  // 명사(NNG/NNP)·동사(VV)·형용사(VA)가 모두 나오도록 구성한 샘플.
  // analyze.js 가 실제로 집계할 네 품사를 한 번에 검증한다.
  const sample =
    '이 포스터는 넓은 여백을 남기고 타이포그래피를 단순하게 다듬은 작업이다.';
  try {
    const { Garu } = await import('garu-ko');
    const garu = await Garu.load();
    ok('garu-ko 로드', 'Garu.load() 성공');

    const info = garu.modelInfo();
    ok('모델 정보', `v${info.version}, ${(info.size / 1e6).toFixed(2)}MB, acc ${info.accuracy}`);

    const result = garu.analyze(sample);
    const tokens = Array.isArray(result) ? result[0].tokens : result.tokens;
    if (!tokens || tokens.length === 0) throw new Error('분석 결과 토큰이 비어 있음');

    // 이 프로젝트가 실제로 집계할 품사가 나오는지 확인
    const wanted = ['NNG', 'NNP', 'VV', 'VA'];
    const seen = new Set(tokens.map((t) => t.pos));
    const present = wanted.filter((p) => seen.has(p));
    ok('샘플 문장 분석', `${tokens.length} 토큰`);
    console.log(`      입력: ${sample}`);
    console.log(
      `      토큰: ${tokens.map((t) => `${t.text}/${t.pos}`).join(' ')}`
    );

    const missing = wanted.filter((p) => !seen.has(p));
    if (present.length === wanted.length) {
      ok('세종 품사 태그', `NNG·NNP·VV·VA 모두 검출`);
    } else if (present.length === 0) {
      fail('목표 품사(NNG/NNP/VV/VA) 미검출 — 태그셋 확인 필요');
    } else {
      // 일부만 검출 — 치명적이진 않지만 샘플/태그셋 재확인 필요
      fail(`목표 품사 일부 미검출 — 검출: ${present.join(', ')} / 누락: ${missing.join(', ')}`);
    }

    // nouns() 헬퍼도 확인 (analyze.js 에서 쓸 수 있음)
    const nouns = garu.nouns(sample);
    ok('nouns() 헬퍼', `명사 ${nouns.length}개: ${nouns.join(', ')}`);

    garu.destroy();
  } catch (err) {
    fail('garu-ko 검증 실패', err);
  }
}

// ── 3. cheerio 정적 HTML 파싱 ───────────────────────────────────
section('[3] cheerio (정적 HTML 파서)');
{
  try {
    const { load } = await import('cheerio');
    const $ = load('<html><body><nav>메뉴</nav><main><p>작업 설명</p></main><footer>푸터</footer></body></html>');
    $('nav, footer, script, style').remove();
    const text = $('body').text().trim();
    if (text === '작업 설명') ok('파싱 + 노이즈 태그 제거', `"${text}"`);
    else fail(`cheerio 텍스트 추출 예상과 다름: "${text}"`);
  } catch (err) {
    fail('cheerio 검증 실패', err);
  }
}

// ── 4. playwright 브라우저 실행 ─────────────────────────────────
section('[4] playwright 브라우저 (SPA 폴백)');
{
  try {
    const { chromium } = await import('playwright');
    let launched = false;
    try {
      const browser = await chromium.launch({ headless: true });
      launched = true;
      const page = await browser.newPage();
      await page.setContent('<h1 id="t">렌더 확인</h1>');
      const rendered = await page.$eval('#t', (el) => el.textContent);
      await browser.close();
      if (rendered === '렌더 확인') ok('chromium 실행 + 렌더', `"${rendered}"`);
      else fail(`playwright 렌더 결과 예상과 다름: "${rendered}"`);
    } catch (launchErr) {
      if (launched) throw launchErr;
      // 바이너리 미설치 등 — 치명적이지 않게 안내
      fail('chromium 실행 실패 (바이너리 설치 필요할 수 있음)', launchErr);
      console.log('      → `npx playwright install chromium` 또는 환경의 PLAYWRIGHT_BROWSERS_PATH 확인');
    }
  } catch (err) {
    fail('playwright import 실패', err);
  }
}

// ── 요약 ────────────────────────────────────────────────────────
section('─'.repeat(50));
if (failures === 0) {
  console.log('✅ Phase 0 환경 검증 통과 — 모든 의존성 정상.\n');
  process.exit(0);
} else {
  console.log(`❌ ${failures}개 항목 실패 — 위 로그 확인 필요.\n`);
  process.exit(1);
}
