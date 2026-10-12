// 서버 API: 질문을 받아 처리하고 답변을 돌려준다. (POST /api/chat)
// 설계 근거: DESIGN.md 2.1 처리 과정, 2.3 주고받는 형식
// 범위: 뼈대(PLAN 작업 10), AI 답변 연결(작업 13), AI 규칙·모호한 질문 안내(작업 14)
// 이후 추가: 실제 참고한 근거만 표시(작업 15), 요청 전체 10초 제한(작업 16)

import { generateAnswer, withAmbiguousSuffix } from "@/lib/answer";
import {
  ERROR_MESSAGE,
  INVALID_QUESTION_MESSAGE,
  MAX_QUESTION_LENGTH,
  NOT_FOUND_MESSAGE,
} from "@/lib/config";
import { findRelevantChunks } from "@/lib/search";
import type { ChatResponse } from "@/lib/types";

/** 응답을 항상 같은 모양(ChatResponse)으로 만든다 */
function reply(body: ChatResponse, status = 200): Response {
  return Response.json(body, { status });
}

/** 요청 본문에서 질문을 꺼낸다. 형식이 맞지 않으면 null */
async function readQuestion(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || !("question" in body)) return null;
    const { question } = body;
    return typeof question === "string" ? question.trim() : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  // 1. 질문 확인: 비어 있거나 500자를 넘으면 400으로 거절
  const question = await readQuestion(request);
  if (!question || question.length > MAX_QUESTION_LENGTH) {
    return reply({ status: "error", answer: INVALID_QUESTION_MESSAGE, sources: [] }, 400);
  }

  try {
    // 2~3. 문서 준비 + 관련 조각 찾기
    const chunks = await findRelevantChunks(question);
    if (chunks.length === 0) {
      return reply({ status: "not_found", answer: NOT_FOUND_MESSAGE, sources: [] });
    }

    // 4. AI에게 묻기 (응답 모양이 틀리면 오류 → 아래 catch에서 "잠시 후 다시 시도해 주세요.")
    const result = await generateAnswer(question, chunks);

    // 5. 답변 검사: AI가 못 찾았거나 범위 밖이라고 판단하면 고정 문구
    if (!result.found || result.answer.length === 0) {
      return reply({ status: "not_found", answer: NOT_FOUND_MESSAGE, sources: [] });
    }

    // 근거: 지금은 AI에게 준 조각의 문서 이름을 중복 없이 모두 표시한다
    // (작업 15에서 AI가 실제로 참고한 조각의 문서만 남기도록 바꾼다)
    const sources = [...new Set(chunks.map((chunk) => chunk.docName))];
    return reply({ status: "answered", answer: withAmbiguousSuffix(result), sources });
  } catch (error) {
    // 오류 내용은 서버 로그에만 남기고 화면에는 숨긴다
    console.error("[api/chat] 처리 중 오류", error);
    return reply({ status: "error", answer: ERROR_MESSAGE, sources: [] });
  }
}
