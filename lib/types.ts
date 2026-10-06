// 서버와 화면, 서버 안의 각 단계가 주고받는 데이터 모양을 한곳에 정의한다.
// 설계 근거: DESIGN.md 2.2 ~ 2.4

/** 화면 → 서버: POST /api/chat 요청 본문 */
export type ChatRequest = {
  question: string;
};

/**
 * 답변 결과의 종류
 * - answered: 문서에서 답을 찾음 (모호한 질문 포함)
 * - not_found: 못 찾음 또는 범위 밖 질문
 * - error: 10초 초과, OpenAI 오류, 잘못된 요청 등
 */
export type ChatStatus = "answered" | "not_found" | "error";

/** 서버 → 화면: POST /api/chat 응답 본문 (항상 이 모양) */
export type ChatResponse = {
  status: ChatStatus;
  /** 화면에 그대로 보여 줄 답변 문장 */
  answer: string;
  /** 근거 문서 이름 (answered일 때 1~3개, 중복 없음 / 그 외에는 빈 목록) */
  sources: string[];
};

/** docs/ 문서를 잘게 나눈 조각 하나 */
export type DocumentChunk = {
  /** 원래 문서 파일 이름 (예: "연차휴가_규정.pdf") */
  docName: string;
  /** 조각 내용 */
  text: string;
};

/** OpenAI가 돌려주도록 지정하는 답변 모양 (서버 안에서만 사용) */
export type AiAnswer = {
  /** 조각에서 답을 찾았는지 */
  found: boolean;
  /** 질문이 짧거나 모호했는지 (true면 서버가 안내 문구를 붙인다) */
  ambiguous: boolean;
  /** 답변 본문 (5문장·300자 이내) */
  answer: string;
  /** 실제로 참고한 조각 번호 (이번 요청에서 붙인 1~3번) */
  usedChunks: number[];
};
