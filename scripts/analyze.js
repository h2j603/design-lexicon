/**
 * analyze.js — garu-ko 형태소 분석 + 통계 (빈도표 · TF-IDF · 리포트)
 *
 * 입력:  data/cleaned/{slug}.json  (기본: kind === "work" & lang ∈ {ko,mixed})
 *        about 페이지는 별도 트랙(about-freq)으로 분리 집계 (CLAUDE.md §1)
 * 출력:  data/results/corpus-freq.json   전체 코퍼스 품사별 상위 100
 *        data/results/by-designer.json   디자이너별 빈도표
 *        data/results/tfidf.json         시그니처 어휘(TF-IDF)
 *        data/results/report.md          사람이 읽는 마크다운 리포트
 *
 * 세종 태그 (CLAUDE.md §7): 명사 NNG(+NNP 별도), 동사 VV, 형용사 VA
 *
 * 실행: npm run analyze
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Garu } from 'garu-ko';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CLEANED_DIR = path.join(ROOT, 'data', 'cleaned');
const RESULTS_DIR = path.join(ROOT, 'data', 'results');

const TOP_N = 100; // 빈도표 상위 N
const SIGNATURE_N = 20; // 디자이너별 시그니처 어휘 상위 N

/** 집계 대상 품사 카테고리 → 세종 태그. */
export const POS_CATEGORIES = {
  noun: ['NNG'],
  properNoun: ['NNP'],
  verb: ['VV'],
  adjective: ['VA'],
};
const TARGET_TAGS = new Set(Object.values(POS_CATEGORIES).flat());

/** 동사/형용사 어간은 기본형(-다)으로 표시. 명사는 표면형 그대로. */
function displayForm(text, pos) {
  return pos === 'VV' || pos === 'VA' ? `${text}다` : text;
}

/**
 * 페이지 텍스트를 줄 단위로 garu-ko 분석 → 카테고리별 토큰 배열.
 * 줄 단위 분석은 긴 페이지의 메모리/정확도 이슈를 피한다.
 */
function analyzePage(garu, text) {
  const buckets = { noun: [], properNoun: [], verb: [], adjective: [] };
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || !/[가-힣]/.test(t)) continue;
    const res = garu.analyze(t);
    const tokens = Array.isArray(res) ? res[0]?.tokens || [] : res.tokens;
    for (const tk of tokens) {
      if (!TARGET_TAGS.has(tk.pos)) continue;
      const surface = tk.text.trim();
      if (!surface) continue;
      const form = displayForm(surface, tk.pos);
      if (tk.pos === 'NNG') buckets.noun.push(form);
      else if (tk.pos === 'NNP') buckets.properNoun.push(form);
      else if (tk.pos === 'VV') buckets.verb.push(form);
      else if (tk.pos === 'VA') buckets.adjective.push(form);
    }
  }
  return buckets;
}

function tally(words) {
  const m = new Map();
  for (const w of words) m.set(w, (m.get(w) || 0) + 1);
  return m;
}

function topEntries(map, n) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
    .slice(0, n)
    .map(([term, count]) => ({ term, count }));
}

async function loadCleaned(onlySlugs) {
  const files = (await readdir(CLEANED_DIR)).filter(
    (f) => f.endsWith('.json') && !f.startsWith('.')
  );
  const records = [];
  for (const f of files) {
    const rec = JSON.parse(await readFile(path.join(CLEANED_DIR, f), 'utf8'));
    if (!onlySlugs.length || onlySlugs.includes(rec.slug)) records.push(rec);
  }
  return records;
}

async function main() {
  const onlySlugs = process.argv.slice(2);
  const records = await loadCleaned(onlySlugs);
  if (!records.length) {
    console.error('분석할 cleaned 파일이 없습니다. 먼저 npm run clean 실행.');
    process.exit(1);
  }

  console.log('garu-ko 로딩...');
  const garu = await Garu.load();

  const CATS = Object.keys(POS_CATEGORIES); // noun, properNoun, verb, adjective

  // 디자이너별 집계 (work 트랙) + about 트랙 별도
  const perDesigner = []; // { slug, counts: {cat: Map}, workPages, koPages }
  const aboutCounts = Object.fromEntries(CATS.map((c) => [c, new Map()]));
  const corpusCounts = Object.fromEntries(CATS.map((c) => [c, new Map()]));

  for (const rec of records) {
    const counts = Object.fromEntries(CATS.map((c) => [c, new Map()]));
    let workPages = 0;
    let skippedLang = 0;

    for (const page of rec.pages) {
      const korean = page.lang === 'ko' || page.lang === 'mixed';
      const track = page.kind === 'about' ? 'about' : 'work';
      if (track === 'work' && page.kind !== 'work') continue; // work 트랙은 kind==='work'만
      if (!korean) {
        if (track === 'work') skippedLang++;
        continue;
      }
      const buckets = analyzePage(garu, page.text);
      if (track === 'about') {
        for (const c of CATS) for (const w of buckets[c]) inc(aboutCounts[c], w);
        continue;
      }
      workPages++;
      for (const c of CATS)
        for (const w of buckets[c]) {
          inc(counts[c], w);
          inc(corpusCounts[c], w);
        }
    }
    perDesigner.push({ slug: rec.slug, counts, workPages, skippedLang });
  }

  garu.destroy();

  // ── 출력 1: 전체 코퍼스 빈도표 ──
  const corpusFreq = Object.fromEntries(
    CATS.map((c) => [c, topEntries(corpusCounts[c], TOP_N)])
  );
  const aboutFreq = Object.fromEntries(
    CATS.map((c) => [c, topEntries(aboutCounts[c], TOP_N)])
  );

  // ── 출력 2: 디자이너별 빈도표 ──
  const byDesigner = perDesigner.map((d) => ({
    slug: d.slug,
    workPages: d.workPages,
    skippedNonKorean: d.skippedLang,
    freq: Object.fromEntries(CATS.map((c) => [c, topEntries(d.counts[c], 30)])),
  }));

  // ── 출력 3: TF-IDF (명사+고유명사+동사+형용사 통합) 시그니처 어휘 ──
  const tfidf = computeTfIdf(perDesigner, CATS);

  await mkdir(RESULTS_DIR, { recursive: true });
  const meta = {
    generatedAt: new Date().toISOString(),
    designers: perDesigner.map((d) => d.slug),
    posCategories: POS_CATEGORIES,
  };
  await writeJson('corpus-freq.json', { ...meta, work: corpusFreq, about: aboutFreq });
  await writeJson('by-designer.json', { ...meta, designers: byDesigner });
  await writeJson('tfidf.json', { ...meta, signatures: tfidf });
  await writeReport({ meta, corpusFreq, byDesigner, tfidf, perDesigner });

  console.log(`\n✓ 분석 완료 → data/results/ (디자이너 ${perDesigner.length}명)`);
  for (const d of perDesigner) {
    console.log(`  - ${d.slug}: work ${d.workPages}p (비한국어 제외 ${d.skippedLang})`);
  }
}

function inc(map, w) {
  map.set(w, (map.get(w) || 0) + 1);
}

/**
 * 각 디자이너를 하나의 문서로 보고 TF-IDF 계산.
 * tf = 디자이너 내 빈도 / 디자이너 총 토큰수,  idf = ln(N / df).
 * 특정 디자이너만 유독 쓰는 단어(=시그니처)를 상위로.
 */
function computeTfIdf(perDesigner, CATS) {
  const N = perDesigner.length;
  // 통합 카운트 (카테고리 무관, 표시형 기준)
  const merged = perDesigner.map((d) => {
    const m = new Map();
    for (const c of CATS) for (const [w, n] of d.counts[c]) m.set(w, (m.get(w) || 0) + n);
    return { slug: d.slug, m };
  });
  const df = new Map();
  for (const { m } of merged) for (const w of m.keys()) df.set(w, (df.get(w) || 0) + 1);

  return merged.map(({ slug, m }) => {
    const total = sum(m) || 1;
    const scored = [...m.entries()]
      .map(([term, count]) => {
        const tf = count / total;
        const idf = Math.log(N / (df.get(term) || 1));
        return { term, count, tfidf: +(tf * idf).toFixed(6) };
      })
      // idf=0 (모든 디자이너가 쓰는 단어)은 시그니처가 아니므로 제외
      .filter((x) => x.tfidf > 0)
      .sort((a, b) => b.tfidf - a.tfidf || b.count - a.count)
      .slice(0, SIGNATURE_N);
    return { slug, signature: scored };
  });
}
// helper: 안전한 합
function sum(map) {
  let s = 0;
  for (const v of map.values()) s += v;
  return s;
}

async function writeJson(name, obj) {
  await writeFile(path.join(RESULTS_DIR, name), JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

async function writeReport({ meta, corpusFreq, byDesigner, tfidf, perDesigner }) {
  const L = [];
  L.push('# 작업 설명 어휘 분석 리포트\n');
  L.push(`생성: ${meta.generatedAt}`);
  L.push(`대상 디자이너: ${meta.designers.join(', ')} (${meta.designers.length}명)`);
  L.push(`품사: 명사 NNG · 고유명사 NNP · 동사 VV · 형용사 VA\n`);

  const CAT_LABEL = { noun: '명사', properNoun: '고유명사', verb: '동사', adjective: '형용사' };

  L.push('## 1. 전체 코퍼스 빈도 (work 트랙, 상위 20)\n');
  for (const [cat, label] of Object.entries(CAT_LABEL)) {
    const rows = corpusFreq[cat].slice(0, 20);
    L.push(`### ${label} (${cat})`);
    if (!rows.length) {
      L.push('_데이터 없음_\n');
      continue;
    }
    L.push('| # | 단어 | 빈도 |');
    L.push('|---|------|------|');
    rows.forEach((r, i) => L.push(`| ${i + 1} | ${r.term} | ${r.count} |`));
    L.push('');
  }

  L.push('## 2. 디자이너별 상위 어휘\n');
  for (const d of byDesigner) {
    L.push(`### ${d.slug} (work ${d.workPages}p)`);
    for (const [cat, label] of Object.entries(CAT_LABEL)) {
      const rows = d.freq[cat].slice(0, 10);
      if (!rows.length) continue;
      L.push(`- **${label}**: ${rows.map((r) => `${r.term}(${r.count})`).join(', ')}`);
    }
    L.push('');
  }

  L.push('## 3. 시그니처 어휘 (TF-IDF — 그 디자이너만 유독 쓰는 단어)\n');
  for (const t of tfidf) {
    L.push(`### ${t.slug}`);
    if (!t.signature.length) {
      L.push('_단일 디자이너이거나 공통 어휘뿐 — TF-IDF 계산 불가_\n');
      continue;
    }
    L.push(t.signature.map((s) => `${s.term}(${s.tfidf})`).join(', '));
    L.push('');
  }

  if (meta.designers.length < 2) {
    L.push('> ⚠ 디자이너가 2명 미만이면 TF-IDF 시그니처는 의미가 없습니다 (idf=0).');
  }

  await writeFile(path.join(RESULTS_DIR, 'report.md'), L.join('\n') + '\n', 'utf8');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
