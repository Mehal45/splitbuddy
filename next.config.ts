import type { NextConfig } from "next";

// Everything runs in the browser (mock data in localStorage), so the app is
// exported as plain static files. Works on Vercel, any static host, or file preview.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
