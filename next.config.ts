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
  // Remove the X-Powered-By: Next.js header so the technology stack is not
  // advertised to potential attackers scanning for known framework CVEs.
  poweredByHeader: false,
  turbopack: {
    root: path.resolve(__dirname),
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : []),
        "twilio",
      ];
    }
    return config;
  },
  async headers() {
    // Content-Security-Policy is set per-request in src/proxy.ts with a
    // cryptographic nonce — do not add a static CSP here or it will override
    // the nonce-based header and break inline script allowance.
    //
    // CORS headers are intentionally NOT set here. Static CORS headers conflict
    // with the per-request origin reflection in withCors() (cors.ts), which
    // validates each origin against ALLOWED_ORIGINS and reflects a single
    // matched origin — the only CORS-spec-compliant approach. Static headers
    // cannot set a single origin value when multiple origins are allowed, and
    // having both causes duplicate / conflicting CORS headers.
    const securityHeaders = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=(self)",
      },
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      },
      // Cross-origin isolation headers (mirrored in proxy.ts for per-request
      // accuracy; duplicating here ensures they are set even for static assets
      // that bypass the proxy layer).
      // COOP: allow-popups required for Google OAuth window.open flows.
      // COEP: unsafe-none avoids blocking R2 images without CORP headers.
      // CORP: same-origin prevents other origins embedding our HTML responses.
      {
        key: "Cross-Origin-Opener-Policy",
        value: "same-origin-allow-popups",
      },
      { key: "Cross-Origin-Embedder-Policy", value: "unsafe-none" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    ];
    return [
      // Security headers for all routes
      { source: "/(.*)", headers: securityHeaders },
      // Stricter Referrer-Policy for pages that carry tokens in the URL.
      // Overrides the global strict-origin-when-cross-origin to no-referrer so
      // that token query params cannot leak via the Referer header to any
      // third-party resource (analytics, fonts, etc.) on the same page.
      {
        source: "/(verify-email|reset-password|forgot-password)(.*)",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      // Explicit Cache-Control for the public liveness probe.
      // Short public TTL lets uptime monitors and CDNs reuse recent responses
      // without hammering the database on every poll.
      {
        source: "/api/health",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=10, s-maxage=60, stale-while-revalidate=60",
          },
        ],
      },
      // No-store for all authenticated API endpoints — prevents any proxy or
      // CDN from caching responses that may contain user-specific data.
      {
        source: "/api/(v1|admin)/(.*)",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      // /_next/image serves optimised images from external origins (Unsplash).
      // CORP must be 'cross-origin' here — the global 'same-origin' in
      // securityHeaders would block cross-origin image loads from this endpoint.
      // X-Content-Type-Options is repeated explicitly as a defence-in-depth
      // reminder (already inherited from the global rule, but stated here so
      // intent is clear when reading the image-specific block).
      {
        source: "/_next/image",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        ],
      },
      // Static build assets: long-lived immutable cache + open CORS so that
      // browsers on any origin (e.g. PWA shell, mobile webview) can load them.
      // This does NOT conflict with the API-level CORS handling in cors.ts — that
      // code only runs for /api/ routes, not for /_next/static/ paths.
      {
        source: "/_next/static/(.*)",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      // PWA manifest — daily revalidation is sufficient.
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
      // robots.txt — daily revalidation; search bots respect this TTL.
      {
        source: "/robots.txt",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
      // sitemap.xml — hourly revalidation; new listings appear within an hour.
      {
        source: "/sitemap.xml",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/admin/lists",
        destination: "/admin/platform-content",
        permanent: true,
      },
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
        hostname: "pub-2617903b3bbb49de8c16c6d5d59ca3ef.r2.dev",
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
