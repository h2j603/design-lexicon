/**
 * crawl.js — 크롤러 (Phase 1에서 구현)
 *
 * 입력:  data/sites.json
 * 출력:  data/raw/{slug}.json               (스키마는 CLAUDE.md §4)
 *        재크롤링 시 data/raw/{slug}.{timestamp}.json 로 별도 저장 (덮어쓰기 금지)
 *
 * 요구사항 (CLAUDE.md §5):
 *   1. 각 사이트 시작 URL부터 같은 도메인 내 링크를 BFS 순회
 *   2. 매너: 요청 간 1.5초 딜레이, robots.txt 확인·준수, User-Agent 명시
 *   3. 텍스트 추출 시 script/style/nav/footer 제거 후 텍스트화
 *   4. 페이지 텍스트 200자 미만이면 SPA 의심 → 그 사이트 전체를 playwright로 재시도
 *      (playwright 는 이 환경의 프리인스톨 브라우저 사용 — chromium.launch() 로 충분)
 *   5. 사이트당 최대 100페이지 (무한 순회 방지)
 *   6. 이미지/PDF/외부 링크 제외, 방문 URL 중복 방지
 *   7. 실패한 사이트는 에러 로그 남기고 다음 사이트로 진행 (전체 중단 금지)
 *
 * 스택: fetch + cheerio(1차) → playwright(SPA 폴백, 2차)
 *
 * ⚠️ Phase 0(환경 검증) 단계에서는 미구현. `npm run verify` 통과 후,
 *    Phase 1 파일럿(사이트 2~3개)부터 여기를 채운다.
 */

export const USER_AGENT =
  'design-lexicon-research/0.1 (+https://github.com/h2j603/design-lexicon; academic research; contact via repo)';
export const REQUEST_DELAY_MS = 1500;
export const MAX_PAGES_PER_SITE = 100;
export const SPA_TEXT_THRESHOLD = 200;

function main() {
  console.error(
    '[crawl.js] 아직 구현되지 않았습니다 (Phase 1). ' +
      'CLAUDE.md §5·§8 을 참고해 파일럿 단계에서 구현하세요.'
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
