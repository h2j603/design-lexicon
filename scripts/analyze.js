/**
 * analyze.js — 형태소 분석 + 통계 (Phase 3에서 구현)
 *
 * 입력:  data/cleaned/{slug}.json (kind === "work" 위주, about 은 별도 트랙)
 * 출력:  data/results/*.json  +  사람이 읽을 수 있는 마크다운 리포트
 *
 * 요구사항 (CLAUDE.md §7):
 *   1. garu-ko 로 형태소 분석 (Node: `import { Garu } from 'garu-ko'; await Garu.load()`)
 *   2. 세종 태그 필터: 명사 NNG(+필요시 NNP 별도 집계), 동사 VV, 형용사 VA
 *   3. 출력:
 *      - 전체 코퍼스 빈도표 (품사별 상위 100)
 *      - 디자이너별 빈도표
 *      - TF-IDF: 특정 디자이너만 유독 쓰는 시그니처 어휘
 *   4. 결과는 JSON + 마크다운 리포트 동시 생성
 *
 * ✅ garu-ko 로드/분석은 Phase 0 (`npm run verify`)에서 이미 검증됨.
 *    실제 집계·TF-IDF·리포트 생성은 Phase 3 에서 채운다.
 */

/** 집계 대상 세종 품사 태그. */
export const TARGET_POS = {
  noun: ['NNG'], // NNP 는 필요 시 별도 집계
  properNoun: ['NNP'],
  verb: ['VV'],
  adjective: ['VA'],
};

function main() {
  console.error(
    '[analyze.js] 아직 구현되지 않았습니다 (Phase 3). ' +
      'garu-ko 로드는 `npm run verify` 로 검증됨. CLAUDE.md §7·§8 참고.'
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
