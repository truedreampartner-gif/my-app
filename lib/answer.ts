// AI 지시문을 만들고 OpenAI에 물어 답변을 받는다. [서버 전용]
// 설계 근거: DESIGN.md 2.1 4단계(AI에게 묻기), 2.4 AI 지시문
// 범위: AI 답변 연결(PLAN 작업 13) — 고른 조각과 질문을 보내 답변 문장을 받는다.
// 이후 추가: PRD 5번 규칙 전체·응답 모양 지정·모호한 질문 안내(작업 14), 근거 확인(작업 15), 10초 제한(작업 16)
import "server-only";

import { ANSWER_MODEL } from "@/lib/config";
import { getOpenAIClient } from "@/lib/search";
import type { DocumentChunk } from "@/lib/types";

/** AI에게 주는 기본 지시문 */
const INSTRUCTIONS = [
  "너는 사내 문서 안내 챗봇 '모두의 교육 비서관'이다.",
  "아래 [문서 조각]에 있는 내용만 근거로 한국어로 답한다. 문서에 없는 내용은 지어내지 않는다.",
].join("\n");

/**
 * 조각을 이번 요청 안에서 1번, 2번, 3번으로 다시 번호 매겨 AI에게 보낼 글로 만든다.
 * (DESIGN.md 2.1 4단계 — 번호는 작업 15의 근거 확인에서 쓴다)
 */
function formatChunks(chunks: DocumentChunk[]): string {
  return chunks
    .map((chunk, i) => `[문서 조각 ${i + 1}] (출처: ${chunk.docName})\n${chunk.text}`)
    .join("\n\n");
}

/** 고른 조각과 질문을 OpenAI에 보내 답변 문장을 받는다 */
export async function generateAnswer(question: string, chunks: DocumentChunk[]): Promise<string> {
  const response = await getOpenAIClient().responses.create({
    model: ANSWER_MODEL,
    instructions: INSTRUCTIONS,
    input: `${formatChunks(chunks)}\n\n[질문]\n${question}`,
    // 10초 안에 답해야 하므로 깊게 생각하는 단계를 최소로 줄인다
    reasoning: { effort: "low" },
  });

  return response.output_text.trim();
}
