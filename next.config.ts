import type { NextConfig } from "next";

// Two ways to build:
//  * `npm run build`         -> normal Next.js app for Vercel (live version with Supabase,
//                               includes the /api/people server route for creating logins).
//  * `npm run build:static`  -> plain static files in out/ (browser-only demo, previews, tests).
// Server-only files end in .server.ts so the static build leaves them out.
const STATIC = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  ...(STATIC ? { output: "export" as const } : {}),
  pageExtensions: STATIC ? ["tsx", "ts"] : ["tsx", "ts", "server.ts"],
  images: { unoptimized: true },
  poweredByHeader: false,
};

export default nextConfig;
