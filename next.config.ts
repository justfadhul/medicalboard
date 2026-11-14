import type { NextConfig } from "next";

const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const wss = supabase.replace(/^http/, "ws"); // https -> wss, http -> ws (local Supabase)
const dev = process.env.NODE_ENV === "development";
const bridge = process.env.NEXT_PUBLIC_SCAN_BRIDGE_URL ?? "http://localhost:7317";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  `img-src 'self' data: blob: ${supabase}`,
  `media-src 'self' blob:`,
  `connect-src 'self' ${supabase} ${wss} ${bridge}`,
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["pdf-lib", "docxtemplater", "pizzip"],
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      ],
    }];
  },
};
export default config;
