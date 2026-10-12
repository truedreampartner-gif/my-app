// 챗봇의 숫자 설정값과 고정 문구를 한곳에 모은다.
// 값을 바꿀 때는 이 파일만 고치면 된다. 비밀 값(API 키)은 절대 여기에 두지 않는다.
// 설계 근거: DESIGN.md 5장, PRD.md 5번

// ── 문서 ──────────────────────────────────────────

/** 챗봇이 읽는 문서 폴더 (my-app 기준) */
export const DOCS_DIR = "docs";

/** 읽을 수 있는 파일 형식 */
export const SUPPORTED_EXTENSIONS = [".txt", ".md", ".pdf"];

/** 사용할 문서 최대 개수 (넘으면 파일 이름순 앞 10개만 사용) */
export const MAX_DOCUMENTS = 10;

/** 조각 하나의 크기 (글자 수) */
export const CHUNK_SIZE = 500;

/** 앞뒤 조각이 겹치는 글자 수 (문맥이 끊기지 않도록) */
export const CHUNK_OVERLAP = 100;

// ── 관련 조각 찾기 ────────────────────────────────

/** AI에게 줄 관련 조각 최대 개수 = 근거 문서 최대 개수 */
export const MAX_SOURCES = 3;

/**
 * 관련성 기준점 (0~1, 뜻 좌표의 유사도)
 * 가장 가까운 조각도 이 값보다 낮으면 AI를 부르지 않고 "찾을 수 없습니다"로 답한다.
 * 작업 9 측정(text-embedding-3-small): 테스트 질문의 최고 유사도 중 가장 낮은 값 0.288(오후 반차),
 * 범위 밖 질문(날씨·점심·인사)의 최고 유사도 0.232 → 그 사이인 0.25로 정했다.
 * 작업 18 점검(2026-10-12)에서 테스트 질문 10/10 정답, 모호한 질문("휴가?") 통과를 확인해 확정했다.
 * 문서를 바꾸면 tests/test-questions.md로 다시 점검한다.
 */
export const RELEVANCE_THRESHOLD = 0.25;

// ── OpenAI 모델 ───────────────────────────────────

/** 답변을 만드는 모델 (10초 안에 답해야 하므로 빠른 mini 모델) */
export const ANSWER_MODEL = "gpt-5.4-mini";

/** 뜻 좌표(임베딩)를 계산하는 모델 */
export const EMBEDDING_MODEL = "text-embedding-3-small";

// ── 제한 ──────────────────────────────────────────

/** 요청 전체 제한 시간 (밀리초). 문서 준비·뜻 좌표 계산·AI 답변을 모두 포함한다. */
export const REQUEST_TIMEOUT_MS = 10_000;

/** 질문 최대 길이 (글자 수) */
export const MAX_QUESTION_LENGTH = 500;

/** 답변 본문 최대 길이 (공백 포함 글자 수, 안내 문구 제외) */
export const MAX_ANSWER_CHARS = 300;

/** 답변 본문 최대 문장 수 */
export const MAX_ANSWER_SENTENCES = 5;

// ── 고정 문구 (PRD 5번) ───────────────────────────

/** 문서에서 답을 찾지 못했거나 범위 밖 질문일 때 */
export const NOT_FOUND_MESSAGE = "문서에서 찾을 수 없습니다. 담당자에게 문의해 주세요.";

/** 10초 초과, OpenAI 오류 등 처리에 실패했을 때 */
export const ERROR_MESSAGE = "잠시 후 다시 시도해 주세요.";

/** 질문이 짧거나 모호할 때 답변 끝에 붙이는 안내 */
export const AMBIGUOUS_SUFFIX = "더 구체적으로 물어보시면 정확해져요.";

/** 질문이 비었거나 너무 길 때 (400 응답) */
export const INVALID_QUESTION_MESSAGE = `질문은 1자 이상 ${MAX_QUESTION_LENGTH}자 이하로 입력해 주세요.`;
