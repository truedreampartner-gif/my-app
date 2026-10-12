"use client";

// 챗봇 화면 (주소: /)
// 설계 근거: DESIGN.md 1장 화면 구성 — ① 머리글, ③ 대화 목록, ⑤ 입력 영역
// 범위: 화면 뼈대(PLAN 작업 11), 서버 API 연결(작업 12) — 질문을 /api/chat으로 보내고 답변과 근거 문서 이름을 보여 준다.
// 이후 추가: 개인정보 안내(작업 17), 추천 질문(작업 19), 👍/👎(작업 20)
// 화면 코드는 서버 전용 파일(lib/search.ts, lib/answer.ts, lib/documents.ts)을 불러오지 않는다.

import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";

import { ERROR_MESSAGE, MAX_QUESTION_LENGTH } from "@/lib/config";
import type { ChatRequest, ChatResponse } from "@/lib/types";

/** 대화 목록의 말풍선 하나 */
type Message = {
  id: number;
  /** user: 내 질문(오른쪽), bot: 챗봇 답변(왼쪽) */
  role: "user" | "bot";
  text: string;
  /** 챗봇 답변의 근거 문서 이름 (없으면 빈 목록) */
  sources: string[];
};

/** 서버 API에 질문을 보내고 답변을 받는다. 연결이 끊기거나 응답을 읽지 못하면 오류 답변으로 바꾼다. */
async function askServer(question: string): Promise<ChatResponse> {
  try {
    const body: ChatRequest = { question };
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // 400 응답도 같은 모양(ChatResponse)으로 오므로 그대로 읽는다
    return (await response.json()) as ChatResponse;
  } catch {
    return { status: "error", answer: ERROR_MESSAGE, sources: [] };
  }
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isWaiting, setIsWaiting] = useState(false);
  const nextId = useRef(1);
  const listEndRef = useRef<HTMLDivElement>(null);

  const trimmed = input.trim();
  const canSend = trimmed.length > 0 && !isWaiting;

  // 새 메시지가 오거나 답을 기다리기 시작하면 맨 아래로 스크롤한다
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isWaiting]);

  function addMessage(role: Message["role"], text: string, sources: string[] = []) {
    setMessages((prev) => [...prev, { id: nextId.current++, role, text, sources }]);
  }

  async function sendQuestion(question: string) {
    addMessage("user", question);
    setInput("");
    setIsWaiting(true);

    const reply = await askServer(question);
    addMessage("bot", reply.answer, reply.sources);
    setIsWaiting(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSend) void sendQuestion(trimmed);
  }

  // 한글 입력 중(글자 조합 중)에 Enter가 눌리면 전송하지 않는다 (마지막 글자가 두 번 보내지는 문제 방지)
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
  }

  return (
    <div className="flex h-dvh flex-col bg-zinc-50 text-zinc-900">
      {/* ① 머리글 */}
      <header className="border-b border-zinc-200 bg-white px-4 py-4">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-xl font-bold">모두의 교육 비서관</h1>
          <p className="mt-1 text-sm text-zinc-500">사내 문서를 바탕으로 질문에 답해 드려요.</p>
        </div>
      </header>

      {/* ③ 대화 목록 */}
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {messages.length === 0 && (
            <p className="mt-16 text-center text-sm text-zinc-400">
              궁금한 내용을 아래 입력창에 적어 보세요.
            </p>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={
                  message.role === "user"
                    ? "max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2 text-white"
                    : "max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-zinc-200 bg-white px-4 py-2"
                }
              >
                {message.text}
                {message.sources.length > 0 && (
                  <p className="mt-2 border-t border-zinc-100 pt-2 text-xs text-zinc-500">
                    📄 근거: {message.sources.join(", ")}
                  </p>
                )}
              </div>
            </div>
          ))}

          {isWaiting && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-sm border border-zinc-200 bg-white px-4 py-2 text-zinc-400">
                답변을 찾는 중…
              </div>
            </div>
          )}
          <div ref={listEndRef} />
        </div>
      </main>

      {/* ⑤ 입력 영역 */}
      <footer className="border-t border-zinc-200 bg-white px-4 py-3">
        <form onSubmit={handleSubmit} className="mx-auto flex max-w-2xl items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={MAX_QUESTION_LENGTH}
              placeholder="궁금한 내용을 입력하세요…"
              aria-label="질문 입력"
              className="w-full rounded-xl border border-zinc-300 py-3 pl-4 pr-20 outline-none focus:border-blue-500"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400">
              {input.length}/{MAX_QUESTION_LENGTH}
            </span>
          </div>
          <button
            type="submit"
            disabled={!canSend}
            className="rounded-xl bg-blue-600 px-5 py-3 font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            전송
          </button>
        </form>
      </footer>
    </div>
  );
}
