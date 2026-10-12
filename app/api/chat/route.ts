// 서버 API: 질문을 받아 처리하고 답변을 돌려준다. (POST /api/chat)
// 설계 근거: DESIGN.md 2.1 처리 과정, 2.3 주고받는 형식, 6장 오류·예외 처리
// 범위: 뼈대(PLAN 작업 10), AI 답변 연결(작업 13), AI 규칙·모호한 질문 안내(작업 14),
//       실제 참고한 근거만 표시(작업 15), 요청 전체 10초 제한(작업 16),
//       Gap 보완: 로그에서 질문 원문 제외, 접속 주소별 질문 수 제한
// 로그 원칙: 사용자 질문 원문은 개인정보가 섞일 수 있으므로 서버 로그에 남기지 않는다 (PRD 7번). 길이만 남긴다.

import { APIError } from "openai";

import { generateAnswer, pickSources, withAmbiguousSuffix } from "@/lib/answer";
import {
  ERROR_MESSAGE,
  INVALID_QUESTION_MESSAGE,
  MAX_QUESTION_LENGTH,
  NOT_FOUND_MESSAGE,
  RATE_LIMITED_MESSAGE,
  REQUEST_TIMEOUT_MS,
} from "@/lib/config";
import { allowRequest, getClientKey } from "@/lib/rate-limit";
import { findRelevantChunks } from "@/lib/search";
import type { ChatResponse } from "@/lib/types";

const NOT_FOUND: ChatResponse = { status: "not_found", answer: NOT_FOUND_MESSAGE, sources: [] };
const FAILED: ChatResponse = { status: "error", answer: ERROR_MESSAGE, sources: [] };

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

/** 질문 하나를 처리한다 (DESIGN.md 2.1의 2~5단계). signal이 중단되면 OpenAI 호출도 멈춘다. */
async function answerQuestion(question: string, signal: AbortSignal): Promise<ChatResponse> {
  // 2~3. 문서 준비 + 관련 조각 찾기
  const chunks = await findRelevantChunks(question, signal);
  if (chunks.length === 0) return NOT_FOUND;

  // 4. AI에게 묻기 (응답 모양이 틀리면 오류 → "잠시 후 다시 시도해 주세요.")
  const result = await generateAnswer(question, chunks, signal);

  // 5. 답변 검사: AI가 못 찾았거나 범위 밖이라고 판단하면 고정 문구
  if (!result.found || result.answer.length === 0) return NOT_FOUND;

  // 근거: AI가 실제로 참고한 조각의 문서 이름만 남긴다. 하나도 안 남으면 근거 없는 답이라 보여 주지 않는다
  const sources = pickSources(result, chunks);
  if (sources.length === 0) {
    console.warn(`[api/chat] 근거로 확인된 문서가 없어 답변을 보여 주지 않습니다 (질문 ${question.length}자)`);
    return NOT_FOUND;
  }

  return { status: "answered", answer: withAmbiguousSuffix(result), sources };
}

/**
 * 서버 로그에 남길 오류 설명을 만든다.
 * OpenAI 오류 메시지에는 API 키 일부가 들어갈 수 있으므로(예: 키가 틀렸을 때) 상태 번호와 종류만 남긴다.
 */
function describeError(error: unknown): string {
  if (error instanceof APIError) return `OpenAI 오류 ${error.status ?? "-"} (${error.constructor.name})`;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** 작업이 signal 중단(10초 초과) 전에 끝나지 않으면 기다리지 않고 오류를 낸다 */
function withTimeout<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export async function POST(request: Request): Promise<Response> {
  // 1. 질문 확인: 비어 있거나 500자를 넘으면 400으로 거절
  const question = await readQuestion(request);
  if (!question || question.length > MAX_QUESTION_LENGTH) {
    return reply({ status: "error", answer: INVALID_QUESTION_MESSAGE, sources: [] }, 400);
  }

  // 질문 수 제한: 같은 접속 주소에서 1분에 10번을 넘으면 OpenAI를 부르지 않고 429로 거절
  if (!allowRequest(getClientKey(request))) {
    console.warn("[api/chat] 같은 접속 주소의 질문이 너무 많아 거절했습니다");
    return reply({ status: "error", answer: RATE_LIMITED_MESSAGE, sources: [] }, 429);
  }

  // 2~5단계 전체에 10초 제한 (문서 준비·뜻 좌표 계산·AI 답변 모두 포함)
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    return reply(await withTimeout(answerQuestion(question, signal), signal));
  } catch (error) {
    // 오류 내용은 서버 로그에만 남기고 화면에는 숨긴다
    if (signal.aborted) {
      console.error(`[api/chat] ${REQUEST_TIMEOUT_MS / 1000}초를 넘겨 중단했습니다 (질문 ${question.length}자)`);
    } else {
      console.error(
        `[api/chat] 처리 중 오류 (${Date.now() - startedAt}ms, 질문 ${question.length}자) / ${describeError(error)}`,
      );
    }
    return reply(FAILED);
  }
}
