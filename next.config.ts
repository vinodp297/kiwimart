import type { NextConfig } from "next";
import path from "path";

// Extract hostname from NEXT_PUBLIC_R2_PUBLIC_URL so the Image component
// can load objects from the configured R2 public URL domain.
function r2Hostname(): string | null {
  const raw = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? "";
  try {
    return raw ? new URL(raw).hostname : null;
  } catch {
    return null;
  }
}

const r2Host = r2Hostname();

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    const allowedOrigins =
      process.env.ALLOWED_ORIGINS || "https://kiwimart.vercel.app";
    const corsHeaders = [
      { key: "Access-Control-Allow-Origin", value: allowedOrigins },
      {
        key: "Access-Control-Allow-Methods",
        value: "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      },
      {
        key: "Access-Control-Allow-Headers",
        value: "Content-Type, Authorization, X-Request-ID",
      },
      { key: "Access-Control-Allow-Credentials", value: "true" },
      { key: "Access-Control-Max-Age", value: "86400" },
    ];
    return [
      // CORS for versioned public API — safe for external consumers
      { source: "/api/v1/:path*", headers: corsHeaders },
      // CORS for non-auth API routes (health, cart, notifications, etc.)
      // Exclude /api/auth/* — Auth.js manages its own headers/cookies
      // Exclude /api/webhooks/* — server-to-server, no CORS needed
      { source: "/api/docs/:path*", headers: corsHeaders },
      { source: "/api/health", headers: corsHeaders },
      { source: "/api/cart", headers: corsHeaders },
      { source: "/api/notifications", headers: corsHeaders },
      { source: "/api/seller/:path*", headers: corsHeaders },
      { source: "/api/metrics", headers: corsHeaders },
      { source: "/api/pusher/:path*", headers: corsHeaders },
    ];
  },
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 3600,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.cloudflare.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.cloudflarestorage.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.r2.cloudflarestorage.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "pub-*.r2.dev",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "r2.kiwimart.co.nz",
        pathname: "/**",
      },
      // Dynamically allow whatever domain NEXT_PUBLIC_R2_PUBLIC_URL points to
      ...(r2Host
        ? [{ protocol: "https" as const, hostname: r2Host, pathname: "/**" }]
        : []),
    ],
  },
};

export default nextConfig;
