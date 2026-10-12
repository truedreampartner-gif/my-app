// OpenAI 연결과 뜻 좌표(임베딩) 계산을 맡는다. [서버 전용]
// 설계 근거: DESIGN.md 2.2 문서 준비 과정, 3.2 추가 기술, 4장 API 키 규칙
// 범위: OpenAI 연결 확인(PLAN 작업 8), 관련 조각 찾기(작업 9), 10초 제한 연동(작업 16)
import "server-only";

import OpenAI from "openai";

import { EMBEDDING_MODEL, MAX_SOURCES, RELEVANCE_THRESHOLD } from "@/lib/config";
import { loadDocumentChunks } from "@/lib/documents";
import type { DocumentChunk } from "@/lib/types";

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

/**
 * 글 여러 개의 뜻 좌표(임베딩)를 한 번에 계산한다. 결과 순서는 입력 순서와 같다.
 * signal이 중단되면(10초 초과) OpenAI 호출도 함께 멈춘다.
 */
export async function embedTexts(texts: string[], signal?: AbortSignal): Promise<number[][]> {
  if (texts.length === 0) return [];

  const response = await getOpenAIClient().embeddings.create(
    { model: EMBEDDING_MODEL, input: texts },
    { signal },
  );

  return response.data
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

/** 뜻 좌표를 계산해 둔 조각 하나 */
type IndexedChunk = DocumentChunk & { embedding: number[] };

/** 질문과 관련 있다고 고른 조각 하나 */
export type RelevantChunk = DocumentChunk & {
  /** 질문과의 뜻 유사도 (0~1, 클수록 가깝다) */
  score: number;
};

/** 문서 조각과 뜻 좌표 보관함 (서버가 켜진 뒤 처음 한 번만 만든다) */
let indexPromise: Promise<IndexedChunk[]> | null = null;

/** docs/ 문서를 조각으로 나누고, 모든 조각의 뜻 좌표를 한 번에 계산한다 */
async function buildIndex(): Promise<IndexedChunk[]> {
  const chunks = await loadDocumentChunks();
  const embeddings = await embedTexts(chunks.map((chunk) => chunk.text));
  return chunks.map((chunk, i) => ({ ...chunk, embedding: embeddings[i] }));
}

/**
 * 보관해 둔 조각 목록을 돌려준다. 없으면 새로 만든다.
 * 동시에 질문이 여러 개 와도 한 번만 만들고, 만들다 실패하면 다음 질문 때 다시 시도한다.
 * 여러 질문이 함께 쓰는 보관함이라 질문 하나의 10초 제한으로 중단하지 않는다.
 * (첫 질문이 10초를 넘겨도 보관함은 계속 만들어져, 다음 질문부터 빨라진다)
 * 문서를 바꾸면 서버를 다시 켜야(배포 환경은 다시 배포해야) 반영된다.
 */
function getIndex(): Promise<IndexedChunk[]> {
  if (!indexPromise) {
    indexPromise = buildIndex().catch((error) => {
      indexPromise = null;
      throw error;
    });
  }
  return indexPromise;
}

/** 두 뜻 좌표가 얼마나 비슷한지 계산한다 (코사인 유사도, 1에 가까울수록 비슷) */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 질문과 뜻이 가까운 조각을 최대 MAX_SOURCES(3)개 고른다. 가까운 순서로 정렬된다.
 * 유사도가 RELEVANCE_THRESHOLD(기준점)보다 낮은 조각은 고르지 않는다.
 * 빈 목록이면 "문서에서 찾을 수 없습니다"로 답해야 한다는 뜻이다.
 * signal이 중단되면(10초 초과) 질문의 뜻 좌표 계산을 멈춘다.
 */
export async function findRelevantChunks(
  question: string,
  signal?: AbortSignal,
): Promise<RelevantChunk[]> {
  const [index, [questionEmbedding]] = await Promise.all([
    getIndex(),
    embedTexts([question], signal),
  ]);

  return index
    .map(({ embedding, ...chunk }) => ({ ...chunk, score: cosineSimilarity(questionEmbedding, embedding) }))
    .filter((chunk) => chunk.score >= RELEVANCE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SOURCES);
}
