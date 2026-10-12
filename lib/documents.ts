// docs/ 폴더의 문서를 읽어 글자(텍스트)로 가져온다. [서버 전용]
// 설계 근거: DESIGN.md 2.2 문서 준비 과정, 6장 오류·예외 처리
// 범위: .txt·.md 읽기(PLAN 작업 5), PDF 읽기(작업 6), 조각 나누기·최대 10개 제한(작업 7)
import "server-only";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { extractText, getDocumentProxy } from "unpdf";

import {
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  DOCS_DIR,
  MAX_DOCUMENTS,
  SUPPORTED_EXTENSIONS,
} from "@/lib/config";
import type { DocumentChunk } from "@/lib/types";

/** 글자로 읽어 온 문서 하나 */
export type SourceDocument = {
  /** 문서 파일 이름 (근거 표시에 그대로 쓴다) */
  docName: string;
  /** 문서 전체 내용 */
  text: string;
};

/** docs/ 폴더의 절대 경로 */
function getDocsPath(): string {
  return path.join(process.cwd(), DOCS_DIR);
}

/** 파일 확장자를 소문자로 돌려준다 (예: "규정.MD" → ".md") */
function getExtension(fileName: string): string {
  return path.extname(fileName).toLowerCase();
}

/** 줄바꿈을 통일하고, 파일 맨 앞의 보이지 않는 표시(BOM)와 앞뒤 공백을 없앤다 */
function cleanText(raw: string): string {
  return raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
}

/** .txt·.md 파일을 글자 그대로 읽는다 */
async function readTextFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

/** PDF 파일에서 글자를 뽑아낸다 (모든 페이지를 하나로 이어 붙임) */
async function readPdfFile(filePath: string): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(filePath)));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/** 확장자에 맞는 방법으로 파일을 읽는다 */
async function readDocumentFile(filePath: string): Promise<string> {
  return getExtension(filePath) === ".pdf" ? readPdfFile(filePath) : readTextFile(filePath);
}

/**
 * docs/ 폴더의 .txt·.md·.pdf 파일을 파일 이름순으로 읽는다.
 * 문서가 MAX_DOCUMENTS(10개)를 넘으면 이름순 앞 10개만 쓰고, 빠진 파일 이름은 서버 로그에 남긴다.
 * 읽지 못한 파일과 내용이 빈 파일(글자 없는 스캔 PDF 등)은 건너뛰고 서버 로그에 이름을 남긴다.
 * docs/ 폴더가 없으면 빈 목록을 돌려준다.
 */
export async function loadDocuments(): Promise<SourceDocument[]> {
  const docsPath = getDocsPath();

  let fileNames: string[];
  try {
    fileNames = await readdir(docsPath);
  } catch (error) {
    console.error(`[documents] docs 폴더를 읽을 수 없습니다: ${docsPath}`, error);
    return [];
  }

  const supportedFileNames = fileNames
    .filter((name) => SUPPORTED_EXTENSIONS.includes(getExtension(name)))
    .sort((a, b) => a.localeCompare(b, "ko"));

  const usedFileNames = supportedFileNames.slice(0, MAX_DOCUMENTS);
  const skippedFileNames = supportedFileNames.slice(MAX_DOCUMENTS);
  if (skippedFileNames.length > 0) {
    console.warn(
      `[documents] 문서가 ${MAX_DOCUMENTS}개를 넘어 다음 파일은 사용하지 않습니다: ${skippedFileNames.join(", ")}`,
    );
  }

  const documents: SourceDocument[] = [];
  for (const docName of usedFileNames) {
    try {
      const text = cleanText(await readDocumentFile(path.join(docsPath, docName)));
      if (text.length === 0) {
        console.warn(`[documents] 읽을 글자가 없어 건너뜁니다: ${docName}`);
        continue;
      }
      documents.push({ docName, text });
    } catch (error) {
      console.error(`[documents] 파일을 읽을 수 없어 건너뜁니다: ${docName}`, error);
    }
  }

  return documents;
}

/**
 * 조각을 끝낼 자리를 찾는다.
 * 조각 뒤쪽 절반 안에서 문단 → 줄 → 문장 → 띄어쓰기 순으로 자연스러운 경계를 찾고,
 * 없으면 글자 수에 맞춰 그대로 자른다.
 */
function findChunkEnd(text: string, start: number): number {
  const hardEnd = Math.min(start + CHUNK_SIZE, text.length);
  if (hardEnd === text.length) return hardEnd;

  const window = text.slice(start, hardEnd);
  const minLength = Math.floor(CHUNK_SIZE / 2);
  const separators = ["\n\n", "\n", ". ", " "];
  for (const separator of separators) {
    const index = window.lastIndexOf(separator);
    if (index >= minLength) return start + index + separator.length;
  }
  return hardEnd;
}

/**
 * 문서 하나를 약 CHUNK_SIZE(500자) 크기의 조각으로 나눈다.
 * 앞뒤 조각은 CHUNK_OVERLAP(100자)씩 겹치게 해서, 경계에 걸친 내용도 한쪽 조각에 온전히 남게 한다.
 */
export function splitIntoChunks(document: SourceDocument): DocumentChunk[] {
  const { docName, text } = document;
  const chunks: DocumentChunk[] = [];

  let start = 0;
  while (start < text.length) {
    const end = findChunkEnd(text, start);
    const chunkText = text.slice(start, end).trim();
    if (chunkText.length > 0) chunks.push({ docName, text: chunkText });
    if (end >= text.length) break;
    // 경계는 조각 뒤쪽 절반에서 찾으므로, 겹침만큼 되돌아가도 항상 앞으로 나아간다
    start = end - CHUNK_OVERLAP;
  }

  return chunks;
}

/** docs/ 문서를 모두 읽어 조각 목록으로 돌려준다 (조각마다 원래 문서 이름이 붙어 있다) */
export async function loadDocumentChunks(): Promise<DocumentChunk[]> {
  const documents = await loadDocuments();
  return documents.flatMap(splitIntoChunks);
}
