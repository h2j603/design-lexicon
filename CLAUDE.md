# 리포지토리 세팅 지침서 — 한국 디자이너 작업 설명 어휘 리서치

## 1. 프로젝트 개요

한국 그래픽 디자이너들의 포트폴리오 사이트에서 작업 설명 텍스트를 수집하고,
형태소 분석을 통해 자주 사용되는 명사/동사/형용사를 통계적으로 추출하는 리서치 프로젝트.

- 목적: 리서치 (출력물 형태는 아직 미정 — 웹/글/시각화로 발전 가능성 있음)
- 분석 대상: 작업(프로젝트) 설명글 위주. about/소개글은 별도 트랙으로 분리 저장
- 언어: 한국어 텍스트 우선. 영문만 있는 사이트는 수집하되 별도 표기 (`lang: "en"`)

## 2. 기술 스택

- **크롤링**: Node.js로 통일 (Python 대신 — 분석 단계와 언어 일원화)
  - 1차: `fetch` + `cheerio` (정적 HTML)
  - 2차 폴백: `playwright` (SPA — 텍스트가 비어 나오는 사이트만)
- **형태소 분석**: `garu-ko` (npm) — WASM 기반, Node에서 실행 가능
- **데이터 저장**: JSON 파일 (DB 불필요, 리서치 규모)

> 환경 메모: 이 실행 환경에는 playwright 브라우저(chromium 빌드 1194)가
> 이미 설치돼 있고, `playwright` 패키지를 그 빌드에 맞는 **1.56.1** 로 고정했다.
> 따라서 `npx playwright install` 을 실행하지 말 것 — `chromium.launch()` 만으로 동작한다.

## 3. 리포지토리 구조

```
design-lexicon/
├── CLAUDE.md              # 이 지침서
├── package.json
├── data/
│   ├── sites.json         # 수집 대상 목록 (수동 관리)
│   ├── raw/               # 사이트별 크롤링 원본 {slug}.json
│   ├── cleaned/           # 정제 후 텍스트
│   └── results/           # 분석 결과 (빈도표, TF-IDF)
├── scripts/
│   ├── verify-env.js      # Phase 0 환경 검증 (npm run verify)
│   ├── crawl.js           # 크롤러 (fetch+cheerio, playwright 폴백)
│   ├── clean.js           # 노이즈 제거
│   └── analyze.js         # garu-ko 형태소 분석 + 통계
├── test/
│   ├── run-pipeline.js    # 네트워크 없는 파이프라인 셀프 테스트
│   └── sites.fixture.json
└── README.md
```

## 4. 데이터 스키마

### sites.json (수동으로 채움)

```json
[
  {
    "slug": "designer-name",
    "name": "디자이너/스튜디오명",
    "url": "https://...",
    "type": "individual | studio",
    "note": "선정 근거 (어워드, 행사, 웹링 등)"
  }
]
```

### raw/{slug}.json (크롤러 출력)

```json
{
  "slug": "designer-name",
  "crawledAt": "ISO datetime",
  "method": "cheerio | playwright",
  "pages": [
    {
      "url": "...",
      "title": "...",
      "text": "추출된 전체 텍스트",
      "kind": "work | about | other"
    }
  ]
}
```

`kind`는 URL 패턴/휴리스틱으로 1차 분류하고, 애매하면 `other`로 두고 수동 검토.

## 5. 크롤러 요구사항 (crawl.js)

1. sites.json의 각 사이트에 대해 시작 URL부터 같은 도메인 내 링크를 BFS로 순회
2. **매너 필수**: 요청 간 1.5초 딜레이, robots.txt 확인 및 준수, User-Agent 명시
3. 페이지당 텍스트 추출 시 `script`, `style`, `nav`, `footer` 태그 제거 후 텍스트화
4. 텍스트가 200자 미만이면 SPA 의심 → 해당 사이트 전체를 playwright로 재시도
5. 페이지 수 상한: 사이트당 100페이지 (무한 순회 방지)
6. 이미지/PDF/외부 링크 제외, URL 중복 방문 방지
7. 실패한 사이트는 에러 로그 남기고 다음 사이트로 진행 (전체 중단 금지)

## 6. 정제 규칙 (clean.js)

1. **반복 블록 제거**: 같은 사이트의 3개 이상 페이지에 동일하게 등장하는 텍스트 줄
   → 내비게이션/푸터로 간주하고 삭제
2. 이메일, 전화번호, 연도만 있는 줄, 100자 미만 페이지 제거
3. 한국어 비율 계산해서 페이지별 `lang` 필드 부여 (ko/en/mixed)
4. 결과를 cleaned/에 저장하되 **원본(raw/)은 절대 수정하지 않음**

## 7. 분석 (analyze.js)

1. `garu-ko`로 형태소 분석 (Node 환경에서 로드)
2. 세종 품사 태그 기준 필터링:
   - 명사: NNG (필요시 NNP 별도 집계)
   - 동사: VV
   - 형용사: VA
3. 출력:
   - 전체 코퍼스 빈도표 (품사별 상위 100)
   - 디자이너별 빈도표
   - TF-IDF: 특정 디자이너만 유독 쓰는 단어 (시그니처 어휘)
4. 결과는 JSON + 사람이 읽을 수 있는 마크다운 리포트 동시 생성

## 8. 작업 순서 (중요)

**Phase 0 — 환경 검증** ← 첫 세션은 여기까지만 ✅ 완료

- 리포 구조 생성, 의존성 설치
- garu-ko가 Node에서 정상 로드되는지 샘플 문장으로 테스트
- playwright 브라우저 바이너리 설치 가능 여부 확인
- 검증 실행: `npm run verify`

**Phase 1 — 파일럿 (사이트 2~3개)** ← 진행 중 🚧

- crawl.js / clean.js / analyze.js 구현 완료, 로컬 fixture로 end-to-end 검증
  (`npm run test:pipeline` — 외부 웹 없이 통과)
- sites.json 에 파일럿 2개 등록: sulki-min, shin-shin
- **남은 것: 실제 두 사이트 크롤 실행 후 실제 노이즈로 정제 규칙 보정.**
  단, 외부 웹 egress가 열린 환경(로컬 CLI 등)에서 실행해야 함 (README '실행 환경 주의').

**Phase 2 — 본 수집**

- 사이트 목록 확정 후 전체 실행
- 사이트별 성공/실패 리포트 확인

**Phase 3 — 분석 및 리포트**

## 9. 하지 말 것

- 로그인 필요한 페이지, 인스타그램 등 SNS 크롤링 시도 금지
- robots.txt가 거부하는 경로 접근 금지
- 요청 딜레이 제거 금지 (개인 사이트 서버 배려)
- raw 데이터 덮어쓰기 금지 (재크롤링 시 타임스탬프 붙여 별도 저장)
- Phase 0~1 완료 전에 대량 크롤링 시작 금지
