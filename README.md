# design-lexicon

한국 그래픽 디자이너 포트폴리오의 **작업 설명 텍스트**를 수집하고, 형태소 분석으로
자주 쓰이는 명사·동사·형용사를 통계적으로 추출하는 리서치 프로젝트.

전체 지침·데이터 스키마·작업 단계는 [`CLAUDE.md`](./CLAUDE.md) 참고.

## 요구 환경

- Node.js >= 20 (개발/검증은 v22 에서 확인)
- 형태소 분석: [`garu-ko`](https://www.npmjs.com/package/garu-ko) (WASM, 1MB 모델, 세종 태그)
- 크롤링: `cheerio`(정적) + `playwright`(SPA 폴백)

## 설치

```bash
npm install
```

> **playwright 브라우저**: 이 리포는 `playwright` 를 프리인스톨 chromium(빌드 1194)에
> 맞춰 **1.56.1** 로 고정했다. `npx playwright install` 은 실행하지 않는다 —
> `chromium.launch()` 가 바로 동작한다. 다른 환경에서 브라우저가 없다면
> `npx playwright install chromium` 으로 받는다.

## 환경 검증 (Phase 0)

의존성이 정상 동작하는지 한 번에 확인한다. garu-ko 로드·샘플 문장 분석,
cheerio 파싱, playwright 렌더를 모두 점검한다.

```bash
npm run verify
```

성공 시 다음과 같이 출력된다:

```
[1] Node 런타임
  ✓ Node 버전 — v22.x
[2] garu-ko 형태소 분석기
  ✓ garu-ko 로드 — Garu.load() 성공
  ✓ 세종 품사 태그 — 검출됨: NNG, NNP
  ...
✅ Phase 0 환경 검증 통과 — 모든 의존성 정상.
```

## 파이프라인 (Phase 1~3, 구현 예정)

```bash
npm run crawl     # data/sites.json → data/raw/{slug}.json
npm run clean     # data/raw → data/cleaned (원본 불변)
npm run analyze   # data/cleaned → data/results (빈도표 · TF-IDF · 리포트)
```

각 스크립트의 상세 요구사항은 파일 상단 주석과 `CLAUDE.md` §5~§7 에 있다.
현재 `crawl.js` / `clean.js` / `analyze.js` 는 스펙만 담은 스켈레톤이며,
Phase 1(파일럿) 부터 채운다.

## 디렉터리

```
data/
  sites.json     수집 대상 목록 (수동 관리)
  raw/           크롤링 원본 (커밋 제외, .gitkeep 만 추적)
  cleaned/       정제 결과 (커밋 제외)
  results/       분석 결과 (커밋 제외)
scripts/
  verify-env.js  환경 검증
  crawl.js       크롤러 (스켈레톤)
  clean.js       정제 (스켈레톤)
  analyze.js     분석 (스켈레톤)
```
