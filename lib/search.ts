// OpenAI 연결과 뜻 좌표(임베딩) 계산을 맡는다. [서버 전용]
// 설계 근거: DESIGN.md 2.2 문서 준비 과정, 3.2 추가 기술, 4장 API 키 규칙
// 범위: OpenAI 연결 확인(PLAN 작업 8)
// 이후 추가: 관련 조각 찾기(작업 9)
import "server-only";

import OpenAI from "openai";

import { EMBEDDING_MODEL } from "@/lib/config";

let client: OpenAI | null = null;

/**
 * OpenAI 연결 도구를 돌려준다. 처음 한 번만 만들고 이후에는 다시 쓴다.
 * API 키는 .env의 OPENAI_API_KEY에서만 읽고, 코드나 로그에는 절대 남기지 않는다.
 */
export function getOpenAIClient(): OpenAI {
  if (client) return client;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY가 설정되지 않았습니다. .env 파일을 확인해 주세요.");
  }

  client = new OpenAI({ apiKey });
  return client;
}

/** 글 여러 개의 뜻 좌표(임베딩)를 한 번에 계산한다. 결과 순서는 입력 순서와 같다. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const response = await getOpenAIClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });

  return response.data
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}
