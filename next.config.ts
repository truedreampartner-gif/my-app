import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /api/chat은 실행 중에 docs/ 폴더를 읽는다. 코드가 직접 불러오는 파일이 아니라서
  // 배포(Vercel)할 때 자동으로 실리지 않으므로, 함께 싣도록 알려 준다. (DESIGN.md 4장)
  outputFileTracingIncludes: {
    "/api/chat": ["./docs/**/*"],
  },
};

export default nextConfig;
