/**
 * clean.js — 정제 (Phase 1에서 구현)
 *
 * 입력:  data/raw/{slug}.json
 * 출력:  data/cleaned/{slug}.json         (원본 raw/ 는 절대 수정하지 않음)
 *
 * 요구사항 (CLAUDE.md §6):
 *   1. 반복 블록 제거: 같은 사이트의 3개 이상 페이지에 동일하게 등장하는
 *      텍스트 줄 → 내비게이션/푸터로 간주해 삭제
 *   2. 이메일·전화번호·연도만 있는 줄·100자 미만 페이지 제거
 *   3. 한국어 비율 계산 → 페이지별 lang 필드 부여 (ko / en / mixed)
 *   4. 결과는 cleaned/ 에 저장, 원본은 불변
 *
 * ⚠️ Phase 0 단계에서는 미구현. 파일럿 결과의 노이즈를 보고 규칙을 보정한다.
 */

/**
 * 한국어 비율로 lang 판정. (Phase 1 에서 clean 로직에 연결)
 * @param {string} text
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

function main() {
  console.error(
    '[clean.js] 아직 구현되지 않았습니다 (Phase 1). CLAUDE.md §6·§8 참고.'
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
