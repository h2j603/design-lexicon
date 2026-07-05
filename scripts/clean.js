/**
 * clean.js — 정제 (반복 블록/노이즈 제거, lang 판정)
 *
 * 입력:  data/raw/{slug}.json
 * 출력:  data/cleaned/{slug}.json          (원본 raw/ 는 절대 수정하지 않음)
 *
 * 요구사항 (CLAUDE.md §6):
 *   1. 반복 블록 제거: 같은 사이트 3개 이상 페이지에 동일 등장하는 줄 → 삭제
 *   2. 이메일·전화번호·연도만 있는 줄·100자 미만 페이지 제거
 *   3. 한국어 비율로 페이지별 lang 부여 (ko/en/mixed)
 *   4. cleaned/ 에 저장, 원본 불변
 *
 * 실행: npm run clean            (data/raw 의 최신 {slug}.json 전체)
 *       node scripts/clean.js slugA
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const CLEANED_DIR = path.join(ROOT, 'data', 'cleaned');

const MIN_PAGE_CHARS = 100; // 이보다 짧은 페이지는 버림
const BOILERPLATE_PAGE_THRESHOLD = 3; // N개 이상 페이지에 나오는 줄 = 보일러플레이트

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /(?:\+?\d[\d ().-]{7,}\d)/;
const YEAR_ONLY_RE = /^\s*(?:19|20)\d{2}(?:\s*[-–~]\s*(?:19|20)?\d{2})?\s*$/;

/**
 * 한국어 비율로 lang 판정.
 * @returns {'ko'|'en'|'mixed'|'none'}
 */
export function detectLang(text) {
  const ko = (text.match(/[가-힣]/g) || []).length;
  const en = (text.match(/[A-Za-z]/g) || []).length;
  const total = ko + en;
  if (total === 0) return 'none';
  const koRatio = ko / total;
  if (koRatio >= 0.7) return 'ko';
  if (koRatio <= 0.1) return 'en';
  return 'mixed';
}

/** 한 줄이 노이즈(이메일/전화/연도만/너무 짧음)인지. */
function isNoiseLine(line) {
  const t = line.trim();
  if (!t) return true;
  if (YEAR_ONLY_RE.test(t)) return true;
  if (EMAIL_RE.test(t) && t.length < 60) return true; // 이메일 위주의 줄
  if (PHONE_RE.test(t) && t.replace(PHONE_RE, '').trim().length < 4) return true;
  return false;
}

/**
 * 사이트 하나의 raw 레코드를 정제.
 * @param {object} record  raw/{slug}.json 파싱 결과
 */
export function cleanRecord(record) {
  const pages = record.pages || [];

  // 1) 사이트 전체에서 줄별 등장 페이지 수 집계 → 보일러플레이트 후보
  const linePageCount = new Map();
  const pageLines = pages.map((p) => {
    const seen = new Set();
    const lines = (p.text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    for (const l of lines) {
      if (!seen.has(l)) {
        seen.add(l);
        linePageCount.set(l, (linePageCount.get(l) || 0) + 1);
      }
    }
    return lines;
  });

  const boilerplate = new Set();
  for (const [line, count] of linePageCount) {
    // 짧은 줄(메뉴 라벨 등)은 임계 이상 반복되면 보일러플레이트로 간주.
    // 아주 긴 문단이 우연히 여러 페이지에 겹칠 일은 드무니 길이 가드는 두지 않되,
    // 페이지가 임계 미만이면 애초에 보일러플레이트 판정을 하지 않음.
    if (pages.length >= BOILERPLATE_PAGE_THRESHOLD && count >= BOILERPLATE_PAGE_THRESHOLD) {
      boilerplate.add(line);
    }
  }

  const cleanedPages = [];
  const dropped = [];
  pages.forEach((p, i) => {
    const kept = pageLines[i].filter((l) => !boilerplate.has(l) && !isNoiseLine(l));
    const text = kept.join('\n');
    if (text.length < MIN_PAGE_CHARS) {
      dropped.push({ url: p.url, reason: `<${MIN_PAGE_CHARS}자`, kind: p.kind });
      return;
    }
    cleanedPages.push({
      url: p.url,
      title: p.title,
      kind: p.kind,
      lang: detectLang(text),
      text,
    });
  });

  return {
    slug: record.slug,
    crawledAt: record.crawledAt,
    cleanedAt: new Date().toISOString(),
    method: record.method,
    stats: {
      pagesIn: pages.length,
      pagesOut: cleanedPages.length,
      dropped: dropped.length,
      boilerplateLines: boilerplate.size,
      byKind: countBy(cleanedPages, (p) => p.kind),
      byLang: countBy(cleanedPages, (p) => p.lang),
    },
    droppedPages: dropped,
    boilerplateSample: [...boilerplate].slice(0, 20),
    pages: cleanedPages,
  };
}

function countBy(arr, fn) {
  const m = {};
  for (const x of arr) {
    const k = fn(x);
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

/**
 * raw/ 에서 slug 별 "가장 최근" 파일 경로를 고른다.
 * ({slug}.json 과 재크롤 타임스탬프 파일 {slug}.<ts>.json 중 최신)
 */
async function latestRawBySlug() {
  const files = (await readdir(RAW_DIR)).filter(
    (f) => f.endsWith('.json') && !f.startsWith('.')
  );
  const bySlug = new Map();
  for (const f of files) {
    const m = f.match(/^(.+?)(?:\.(\d{4}-.+))?\.json$/);
    if (!m) continue;
    const slug = m[1];
    const ts = m[2] || ''; // 타임스탬프 없는 base 는 '' → 가장 낮게, 나중 것이 이김
    const prev = bySlug.get(slug);
    if (!prev || ts > prev.ts) bySlug.set(slug, { file: f, ts });
  }
  return bySlug;
}

async function main() {
  const onlySlugs = process.argv.slice(2);
  const bySlug = await latestRawBySlug();
  const entries = [...bySlug.entries()].filter(
    ([slug]) => !onlySlugs.length || onlySlugs.includes(slug)
  );
  if (!entries.length) {
    console.error('정제할 raw 파일이 없습니다. 먼저 npm run crawl 실행.');
    process.exit(1);
  }
  await mkdir(CLEANED_DIR, { recursive: true });

  for (const [slug, { file }] of entries) {
    const record = JSON.parse(await readFile(path.join(RAW_DIR, file), 'utf8'));
    const cleaned = cleanRecord(record);
    await writeFile(
      path.join(CLEANED_DIR, `${slug}.json`),
      JSON.stringify(cleaned, null, 2) + '\n',
      'utf8'
    );
    const s = cleaned.stats;
    console.log(
      `✓ ${slug}: ${s.pagesIn}→${s.pagesOut}p (drop ${s.dropped}, ` +
        `보일러플레이트 ${s.boilerplateLines}줄) lang ${JSON.stringify(s.byLang)} ` +
        `kind ${JSON.stringify(s.byKind)}`
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
