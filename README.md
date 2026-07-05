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

## 파이프라인

```bash
npm run crawl     # data/sites.json → data/raw/{slug}.json
npm run clean     # data/raw → data/cleaned (원본 불변)
npm run analyze   # data/cleaned → data/results (빈도표 · TF-IDF · 리포트)

# 특정 사이트만: npm run crawl -- sulki-min
```

세 스크립트 모두 구현·검증 완료(파일 상단 주석과 `CLAUDE.md` §5~§7 참고).
`crawl.js` 는 정적(cheerio)으로 먼저 훑고, 본문 있는 페이지가 하나도 없으면
SPA로 보고 사이트 전체를 playwright로 재시도한다.

### 파이프라인 셀프 테스트 (네트워크 불필요)

`127.0.0.1` 에 가짜 포트폴리오(정적 1 + SPA 1)를 띄워 crawl→clean→analyze 를
실제로 돌리고 결과를 검증한다. 외부 웹이 막힌 환경에서도 코드 정확성을 확인할 수 있다.

```bash
npm run test:pipeline
```

### ⚠️ 실행 환경 주의 — 외부 웹 접근

실제 크롤링은 **대상 사이트에 HTTPS로 나갈 수 있는 환경**에서 실행해야 한다.

- **Claude Code 웹 세션 등 egress가 막힌 환경**에서는 외부 사이트(예: sulki-min.com)에
  접근할 수 없다(npm·GitHub 같은 허용 목록만 통과). 이 경우 `npm run crawl` 은 각
  사이트를 실패로 기록하고 넘어간다. → **로컬 CLI 또는 네트워크가 열린 환경에서 실행.**
- **Node 내장 `fetch` 는 프록시 환경변수를 기본적으로 읽지 않는다.** 프록시 뒤에서
  돌린다면 `NODE_USE_ENV_PROXY=1` 을 주거나(Node ≥ 22.21) 프록시 없는 환경에서 실행한다.
- 코드 자체는 환경 독립적이다 — 위 셀프 테스트로 로직은 이미 검증돼 있다.

## 디렉터리

```
data/
  sites.json     수집 대상 목록 (수동 관리)
  raw/           크롤링 원본 (커밋 제외, .gitkeep 만 추적)
  cleaned/       정제 결과 (커밋 제외)
  results/       분석 결과 (커밋 제외)
scripts/
  verify-env.js  환경 검증
  crawl.js       크롤러 (fetch+cheerio, playwright 폴백)
  clean.js       정제 (반복 블록/노이즈 제거, lang 판정)
  analyze.js     분석 (garu-ko 형태소 · 빈도 · TF-IDF · 리포트)
test/
  run-pipeline.js      네트워크 없는 파이프라인 셀프 테스트
  sites.fixture.json   테스트용 사이트 목록
```
