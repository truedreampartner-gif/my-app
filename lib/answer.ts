// AI 지시문을 만들고 OpenAI에 물어 답변을 받는다. [서버 전용]
// 설계 근거: DESIGN.md 2.1 4~5단계, 2.4 AI 지시문, PRD.md 5번 "AI가 지킬 규칙"
// 범위: AI 답변 연결(PLAN 작업 13), 규칙 전체·응답 모양 지정·답변 검사(작업 14), 근거 확인(작업 15),
//       10초 제한 연동(작업 16)
import "server-only";

import {
  AMBIGUOUS_SUFFIX,
  ANSWER_MODEL,
  MAX_ANSWER_CHARS,
  MAX_ANSWER_SENTENCES,
  MAX_SOURCES,
} from "@/lib/config";
import { getOpenAIClient } from "@/lib/search";
import type { AiAnswer, DocumentChunk } from "@/lib/types";

/** AI에게 주는 지시문 (PRD 5번 규칙) */
const INSTRUCTIONS = `너는 사내 문서 안내 챗봇 '모두의 교육 비서관'이다. 아래 규칙을 반드시 지킨다.

1. [문서 조각]에 있는 내용만 근거로 답한다. 문서 조각에 없는 내용은 절대 지어내거나 추측하지 않는다.
2. 문서 조각에서 답을 찾을 수 없거나, 잡담·날씨·일반 상식처럼 사내 문서와 관계없는 질문이면 found를 false로 한다.
3. 질문이 한두 단어처럼 짧거나 모호하면, 가장 가까운 내용으로 답하고 ambiguous를 true로 한다. 안내 문구는 붙이지 않는다.
4. answer는 ${MAX_ANSWER_SENTENCES}문장 이내이면서 공백 포함 ${MAX_ANSWER_CHARS}자 이내의 한국어 평문으로 쓴다. 굵게(**), 제목(#), 목록 기호 같은 마크다운은 쓰지 않는다.
5. usedChunks에는 답변에 실제로 참고한 문서 조각 번호만 1~3개 적는다. found가 false면 빈 목록으로 둔다.`;

/** AI 답변 모양 (DESIGN.md 2.4) — 이 모양이 아니면 OpenAI가 답을 만들지 않는다 */
const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean", description: "문서 조각에서 답을 찾았는지" },
    ambiguous: { type: "boolean", description: "질문이 짧거나 모호했는지" },
    answer: { type: "string", description: "답변 본문 (found가 false면 빈 문자열)" },
    usedChunks: {
      type: "array",
      items: { type: "integer" },
      description: "실제로 참고한 문서 조각 번호",
    },
  },
  required: ["found", "ambiguous", "answer", "usedChunks"],
  additionalProperties: false,
};

/**
 * 조각을 이번 요청 안에서 1번, 2번, 3번으로 다시 번호 매겨 AI에게 보낼 글로 만든다.
 * (DESIGN.md 2.1 4단계 — 번호는 작업 15의 근거 확인에서 쓴다)
 */
function formatChunks(chunks: DocumentChunk[]): string {
  return chunks
    .map((chunk, i) => `[문서 조각 ${i + 1}] (출처: ${chunk.docName})\n${chunk.text}`)
    .join("\n\n");
}

/** 문장 수를 센다 (마침표·물음표·느낌표로 끝나는 덩어리 기준) */
function countSentences(text: string): number {
  return text.split(/(?<=[.?!])\s+/).filter((sentence) => sentence.trim().length > 0).length;
}

/** AI가 돌려준 글이 정해진 모양인지 확인한다. 아니면 오류를 낸다 (→ "잠시 후 다시 시도해 주세요.") */
function parseAiAnswer(raw: string): AiAnswer {
  const value: unknown = JSON.parse(raw);
  if (
    typeof value !== "object" ||
    value === null ||
    !("found" in value) ||
    !("ambiguous" in value) ||
    !("answer" in value) ||
    !("usedChunks" in value) ||
    typeof value.found !== "boolean" ||
    typeof value.ambiguous !== "boolean" ||
    typeof value.answer !== "string" ||
    !Array.isArray(value.usedChunks) ||
    !value.usedChunks.every((n) => Number.isInteger(n))
  ) {
    throw new Error(`AI 응답이 정해진 모양이 아닙니다: ${raw.slice(0, 200)}`);
  }
  return {
    found: value.found,
    ambiguous: value.ambiguous,
    answer: value.answer.trim(),
    usedChunks: value.usedChunks as number[],
  };
}

/**
 * 고른 조각과 질문을 OpenAI에 보내, 정해진 모양(AiAnswer)으로 답을 받는다.
 * signal이 중단되면(10초 초과) OpenAI 호출도 함께 멈춘다.
 */
export async function generateAnswer(
  question: string,
  chunks: DocumentChunk[],
  signal?: AbortSignal,
): Promise<AiAnswer> {
  const response = await getOpenAIClient().responses.create(
    {
      model: ANSWER_MODEL,
      instructions: INSTRUCTIONS,
      input: `${formatChunks(chunks)}\n\n[질문]\n${question}`,
      text: {
        format: { type: "json_schema", name: "chat_answer", schema: ANSWER_SCHEMA, strict: true },
      },
      // 10초 안에 답해야 하므로 깊게 생각하는 단계를 최소로 줄인다
      reasoning: { effort: "low" },
    },
    { signal },
  );

  const result = parseAiAnswer(response.output_text);

  // 본문이 길이 규칙을 넘으면 서버 로그에만 남기고 그대로 보여 준다 (PRD 5번, DESIGN.md 6장)
  if (result.answer.length > MAX_ANSWER_CHARS || countSentences(result.answer) > MAX_ANSWER_SENTENCES) {
    console.warn(
      `[answer] 답변 길이 규칙 초과: ${result.answer.length}자, ${countSentences(result.answer)}문장 / 질문: ${question}`,
    );
  }

  return result;
}

/**
 * AI가 참고했다고 한 조각 번호 중 실제로 준 번호(1~조각 수)만 남기고,
 * 그 조각들의 문서 이름을 중복 없이 최대 MAX_SOURCES(3)개 돌려준다.
 * AI가 지어낸 번호는 버리므로, 근거에는 실제로 준 문서 이름만 나온다. (DESIGN.md 2.1 5단계)
 * 빈 목록이면 근거 없는 답이므로 보여 주지 않아야 한다.
 */
export function pickSources(result: AiAnswer, chunks: DocumentChunk[]): string[] {
  const docNames = result.usedChunks
    .filter((n) => n >= 1 && n <= chunks.length)
    .map((n) => chunks[n - 1].docName);
  const sources = [...new Set(docNames)].slice(0, MAX_SOURCES);

  const ignored = result.usedChunks.filter((n) => n < 1 || n > chunks.length);
  if (ignored.length > 0) {
    console.warn(`[answer] 실제로 주지 않은 조각 번호를 버렸습니다: ${ignored.join(", ")}`);
  }
  return sources;
}

/** 모호한 질문이면 답변 끝에 안내 문구를 붙인다 (안내 문구는 300자 규칙에 포함하지 않는다) */
export function withAmbiguousSuffix(result: AiAnswer): string {
  return result.ambiguous ? `${result.answer} ${AMBIGUOUS_SUFFIX}` : result.answer;
}
