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
    ];
    return [
      // Security headers for all routes
      { source: "/(.*)", headers: securityHeaders },
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
