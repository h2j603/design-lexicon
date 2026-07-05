/**
 * crawl.js — 크롤러 (fetch+cheerio 1차, playwright SPA 폴백)
 *
 * 입력:  data/sites.json
 * 출력:  data/raw/{slug}.json                 (스키마 CLAUDE.md §4)
 *        이미 존재하면 data/raw/{slug}.{timestamp}.json 로 별도 저장 (덮어쓰기 금지)
 *
 * 요구사항 (CLAUDE.md §5):
 *   1. 시작 URL부터 같은 도메인 링크를 BFS 순회
 *   2. 매너: 요청 간 1.5초 딜레이, robots.txt 준수, User-Agent 명시
 *   3. script/style/nav/footer 제거 후 텍스트화
 *   4. 텍스트 200자 미만 → SPA 의심 → 사이트 전체 playwright 재시도
 *   5. 사이트당 최대 100페이지
 *   6. 이미지/PDF/외부 링크 제외, URL 중복 방지
 *   7. 사이트 실패는 로그만 남기고 다음 사이트로 진행 (전체 중단 금지)
 *
 * 실행: npm run crawl            (data/sites.json 전체)
 *       node scripts/crawl.js slugA slugB   (특정 slug만)
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as cheerio from 'cheerio';

export const USER_AGENT =
  'design-lexicon-research/0.1 (+https://github.com/h2j603/design-lexicon; academic research; contact via repo)';
export const REQUEST_DELAY_MS = 1500;
export const MAX_PAGES_PER_SITE = 100;
export const SPA_TEXT_THRESHOLD = 200;
const FETCH_TIMEOUT_MS = 20000;

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const RAW_DIR = path.join(ROOT, 'data', 'raw');

// 크롤링에서 제외할 확장자 (이미지/문서/미디어/에셋)
const SKIP_EXT =
  /\.(jpe?g|png|gif|webp|svg|avif|ico|bmp|tiff?|pdf|zip|rar|7z|gz|dmg|mp4|webm|mov|avi|mp3|wav|ogg|css|js|json|xml|rss|woff2?|ttf|otf|eot)(\?.*)?$/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── URL 헬퍼 ────────────────────────────────────────────────────
/** hash 제거, 마지막 슬래시 정규화. 중복 방문 판정용 키. */
function normalizeUrl(raw, base) {
  let u;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  // 쿼리는 유지하되 흔한 트래킹 파라미터는 제거
  ['utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'gclid'].forEach((p) =>
    u.searchParams.delete(p)
  );
  let s = u.toString();
  // 루트가 아닌 경로의 끝 슬래시는 제거해 /a 와 /a/ 를 동일 취급
  if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
  return s;
}

function sameSite(url, origin) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

// ── robots.txt (최소 파서) ──────────────────────────────────────
/**
 * User-agent 그룹별 Disallow/Allow 를 파싱해 경로 허용 여부를 판정.
 * 우리 UA 토큰과 '*' 그룹을 병합, 최장 일치 규칙 우선(표준 관행).
 */
function parseRobots(txt) {
  const groups = [];
  let current = null;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((field === 'disallow' || field === 'allow') && current) {
      current.rules.push({ allow: field === 'allow', path: value });
    }
  }
  return groups;
}

function robotsChecker(txt, uaToken) {
  const groups = parseRobots(txt);
  const ua = uaToken.toLowerCase();
  const applicable = groups.filter(
    (g) => g.agents.includes('*') || g.agents.some((a) => ua.includes(a))
  );
  const rules = applicable.flatMap((g) => g.rules).filter((r) => r.path !== '');
  return (pathname) => {
    let best = null;
    for (const r of rules) {
      if (pathname.startsWith(r.path)) {
        if (!best || r.path.length > best.path.length) best = r;
      }
    }
    // 규칙 없음 또는 Allow 최장일치 → 허용. Disallow 최장일치 → 거부.
    return !best || best.allow;
  };
}

async function loadRobots(origin) {
  try {
    const res = await fetchWithTimeout(`${origin}/robots.txt`);
    if (res.status === 200) {
      const txt = await res.text();
      return { check: robotsChecker(txt, USER_AGENT), note: 'parsed' };
    }
    // 404 등 → robots 없음 → 전부 허용
    return { check: () => true, note: `no robots (HTTP ${res.status})` };
  } catch (e) {
    // 네트워크 오류 → 확인 불가. 보수적으로 허용하되 경고.
    return { check: () => true, note: `robots fetch failed: ${e.message}` };
  }
}

// ── fetch ───────────────────────────────────────────────────────
async function fetchWithTimeout(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

// ── HTML → 텍스트/링크 ──────────────────────────────────────────
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'main', 'header', 'li', 'ul', 'ol',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'tr', 'table', 'blockquote',
  'figure', 'figcaption', 'dl', 'dt', 'dd', 'pre', 'hr',
]);

/** noise 태그 제거 후, 블록 경계에서 줄바꿈을 넣어 텍스트 추출. */
function extractText($) {
  $('script, style, nav, footer, noscript, svg, template').remove();
  const body = $('body').length ? $('body')[0] : null;
  if (!body) return '';
  const out = [];
  const walk = (node) => {
    if (node.type === 'text') {
      out.push(node.data);
      return;
    }
    if (node.type !== 'tag') return;
    const tag = node.name.toLowerCase();
    const block = BLOCK_TAGS.has(tag);
    if (block) out.push('\n');
    for (const c of node.children || []) walk(c);
    if (block) out.push('\n');
  };
  walk(body);
  return out
    .join('')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function extractLinks($, pageUrl, origin) {
  const links = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    const n = normalizeUrl(href, pageUrl);
    if (!n) return;
    if (!sameSite(n, origin)) return;
    if (SKIP_EXT.test(new URL(n).pathname)) return;
    links.add(n);
  });
  return [...links];
}

// ── kind 분류 (URL/제목 휴리스틱, 애매하면 other) ───────────────
const ABOUT_HINT = /(about|info|profile|bio|cv|contact|studio|소개|프로필|연혁|이력)/i;
const WORK_HINT =
  /(work|works|project|projects|portfolio|archive|selected|작업|프로젝트|작품)/i;

function classifyKind(url, title) {
  const p = (() => {
    try {
      return decodeURIComponent(new URL(url).pathname);
    } catch {
      return url;
    }
  })();
  const hay = `${p} ${title || ''}`;
  if (ABOUT_HINT.test(hay)) return 'about';
  if (WORK_HINT.test(hay)) return 'work';
  return 'other';
}

// ── 공통 BFS (fetchPage 추상화로 cheerio/playwright 공유) ────────
async function crawlBFS({ startUrl, origin, robots, fetchPage, method }) {
  const start = normalizeUrl(startUrl, startUrl);
  const queue = [start];
  const visited = new Set([start]);
  const pages = [];
  const errors = [];

  while (queue.length && pages.length < MAX_PAGES_PER_SITE) {
    const url = queue.shift();
    let pathname;
    try {
      pathname = new URL(url).pathname;
    } catch {
      continue;
    }
    if (!robots.check(pathname)) {
      errors.push({ url, error: 'robots disallow' });
      continue;
    }
    await sleep(REQUEST_DELAY_MS); // 요청 전 딜레이 (서버 배려)
    let html;
    try {
      html = await fetchPage(url);
    } catch (e) {
      errors.push({ url, error: e.message });
      continue;
    }
    if (!html) continue;
    const $ = cheerio.load(html);
    const title = ($('title').first().text() || '').replace(/\s+/g, ' ').trim();
    // 링크는 nav 포함 전체 문서에서 먼저 뽑는다 (extractText가 nav/footer를 제거하므로
    // 순서를 바꾸면 내비게이션 링크가 사라져 BFS가 확장되지 않는다).
    const links = extractLinks($, url, origin);
    const text = extractText($);
    pages.push({ url, title, text, kind: classifyKind(url, title) });
    for (const link of links) {
      if (!visited.has(link)) {
        visited.add(link);
        queue.push(link);
      }
    }
  }
  return { pages, errors };
}

// ── 사이트 하나 크롤 ────────────────────────────────────────────
async function crawlSite(site) {
  const start = normalizeUrl(site.url, site.url);
  if (!start) throw new Error(`잘못된 URL: ${site.url}`);
  const origin = new URL(start).origin;

  const robots = await loadRobots(origin);
  console.log(`  robots.txt: ${robots.note}`);
  if (!robots.check(new URL(start).pathname)) {
    throw new Error('시작 URL이 robots.txt에서 거부됨');
  }

  // 1차: 정적(cheerio)으로 사이트 전체를 크롤.
  const staticFetch = async (url) => {
    const res = await fetchWithTimeout(url);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    if (!/html/i.test(ct)) throw new Error(`non-html (${ct})`);
    return res.text();
  };
  let method = 'cheerio';
  let result = await crawlBFS({ startUrl: start, origin, robots, fetchPage: staticFetch });

  // SPA 판정: 정적 크롤에서 본문(≥임계)이 있는 페이지가 하나도 없으면
  // JS 렌더 사이트로 보고 사이트 전체를 playwright로 재시도 (CLAUDE.md §5-4).
  const richPages = result.pages.filter((p) => p.text.length >= SPA_TEXT_THRESHOLD).length;
  if (richPages === 0) {
    if (result.pages.length === 0 && result.errors.length && result.errors.every((e) => /HTTP|failed|abort/i.test(e.error))) {
      // 시작부터 접근 자체가 안 됨 — playwright로도 한 번 시도해 본다.
      console.log('  정적 크롤 실패 → playwright로 재시도');
    } else {
      console.log(
        `  정적 크롤 본문 페이지 0 (수집 ${result.pages.length}p, 모두 <${SPA_TEXT_THRESHOLD}자) → SPA 판정, playwright 재시도`
      );
    }
    method = 'playwright';
    const pw = await crawlWithPlaywright({ startUrl: start, origin, robots });
    if (pw.pages.length === 0) {
      throw new Error(`정적·playwright 모두 페이지 수집 실패 (errors: ${pw.errors.length})`);
    }
    result = pw;
  }

  return {
    slug: site.slug,
    crawledAt: new Date().toISOString(),
    method,
    startUrl: start,
    stats: {
      pages: result.pages.length,
      errors: result.errors.length,
      byKind: countBy(result.pages, (p) => p.kind),
    },
    errors: result.errors,
    pages: result.pages,
  };
}

// ── playwright 폴백 ─────────────────────────────────────────────
async function crawlWithPlaywright({ startUrl, origin, robots }) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const fetchPage = async (url) => {
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: FETCH_TIMEOUT_MS });
        return await page.content();
      } finally {
        await page.close();
      }
    };
    return await crawlBFS({ startUrl, origin, robots, fetchPage, method: 'playwright' });
  } finally {
    await browser.close();
  }
}

// ── 유틸 ────────────────────────────────────────────────────────
function countBy(arr, fn) {
  const m = {};
  for (const x of arr) {
    const k = fn(x);
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function writeRaw(record) {
  await mkdir(RAW_DIR, { recursive: true });
  const base = path.join(RAW_DIR, `${record.slug}.json`);
  let target = base;
  if (await exists(base)) {
    // 덮어쓰기 금지 — 타임스탬프 붙여 별도 저장
    const ts = record.crawledAt.replace(/[:.]/g, '-');
    target = path.join(RAW_DIR, `${record.slug}.${ts}.json`);
    console.log(`  ⚠ 기존 raw 존재 → 새 파일로 저장: ${path.basename(target)}`);
  }
  await writeFile(target, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return target;
}

// ── main ────────────────────────────────────────────────────────
async function main() {
  const onlySlugs = process.argv.slice(2);
  // 기본은 data/sites.json. 테스트/대체 목록은 SITES_FILE 로 지정 가능.
  const sitesFile = process.env.SITES_FILE || path.join(ROOT, 'data', 'sites.json');
  const sites = JSON.parse(await readFile(sitesFile, 'utf8'));
  const targets = onlySlugs.length
    ? sites.filter((s) => onlySlugs.includes(s.slug))
    : sites;

  if (!targets.length) {
    console.error('크롤할 사이트가 없습니다. data/sites.json 확인.');
    process.exit(1);
  }

  const summary = [];
  for (const site of targets) {
    console.log(`\n▶ ${site.slug} (${site.url})`);
    try {
      const record = await crawlSite(site);
      const out = await writeRaw(record);
      console.log(
        `  ✓ ${record.stats.pages}p / err ${record.stats.errors} / ${record.method} / kind ${JSON.stringify(record.stats.byKind)}`
      );
      summary.push({ slug: site.slug, ok: true, ...record.stats, file: path.basename(out) });
    } catch (e) {
      // 사이트 실패는 로그만 — 다음 사이트로 계속 (전체 중단 금지)
      console.error(`  ✗ 실패: ${e.message}`);
      summary.push({ slug: site.slug, ok: false, error: e.message });
    }
  }

  console.log('\n── 요약 ──');
  for (const s of summary) {
    console.log(
      s.ok
        ? `  ✓ ${s.slug}: ${s.pages}p (${JSON.stringify(s.byKind)}) → ${s.file}`
        : `  ✗ ${s.slug}: ${s.error}`
    );
  }
  const failed = summary.filter((s) => !s.ok).length;
  console.log(`\n완료: 성공 ${summary.length - failed} / 실패 ${failed}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
