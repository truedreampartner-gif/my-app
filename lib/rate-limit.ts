// 같은 접속 주소(IP)에서 짧은 시간에 질문을 너무 많이 보내지 못하게 막는다. [서버 전용]
// 목적: 로그인 없이 공개 배포된 상태에서 OpenAI 사용료가 한꺼번에 쌓이는 것을 줄인다.
// 한계: 데이터베이스 없이 서버 메모리로 센다(PRD 6번 비범위). Vercel은 서버가 여러 대로 늘거나 새로 켜질 수 있어
//       완벽한 제한은 아니다. OpenAI 사용량 한도(대시보드 설정)와 함께 쓰는 1차 방어선이다.
import "server-only";

import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from "@/lib/config";

/** 접속 주소별 최근 질문 시각 목록 */
const requestLog = new Map<string, number[]>();

/** 기록이 너무 쌓이지 않도록, 이 개수를 넘으면 오래된 기록을 정리한다 */
const CLEANUP_THRESHOLD = 1_000;

/** 요청을 보낸 접속 주소를 꺼낸다. Vercel은 x-forwarded-for 맨 앞에 실제 주소를 넣어 준다. */
export function getClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

/** 제한 시간보다 오래된 기록을 지운다 */
function prune(now: number) {
  for (const [key, times] of requestLog) {
    const recent = times.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length === 0) requestLog.delete(key);
    else requestLog.set(key, recent);
  }
}

/**
 * 이번 질문을 받아도 되는지 확인하고, 받아도 되면 기록한다.
 * 최근 RATE_LIMIT_WINDOW_MS(1분) 동안 RATE_LIMIT_MAX_REQUESTS(10번)를 넘으면 false.
 */
export function allowRequest(key: string, now = Date.now()): boolean {
  if (requestLog.size > CLEANUP_THRESHOLD) prune(now);

  const recent = (requestLog.get(key) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestLog.set(key, recent);
    return false;
  }
  recent.push(now);
  requestLog.set(key, recent);
  return true;
}
