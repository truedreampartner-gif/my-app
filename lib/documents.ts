// docs/ 폴더의 문서를 읽어 글자(텍스트)로 가져온다. [서버 전용]
// 설계 근거: DESIGN.md 2.2 문서 준비 과정, 6장 오류·예외 처리
// 현재 범위: .txt·.md 읽기(PLAN 작업 5), PDF 읽기(작업 6)
// 이후 추가: 조각 나누기·최대 10개 제한(작업 7)
import "server-only";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { extractText, getDocumentProxy } from "unpdf";

import { DOCS_DIR, SUPPORTED_EXTENSIONS } from "@/lib/config";

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

  const documents: SourceDocument[] = [];
  for (const docName of supportedFileNames) {
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
