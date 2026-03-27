import type { NextConfig } from "next";
import path from "path";

// Extract hostname from NEXT_PUBLIC_R2_PUBLIC_URL so the Image component
// can load objects from the configured R2 public URL domain.
function r2Hostname(): string | null {
  const raw = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? '';
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
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 3600,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: '*.cloudflare.com',
      },
      {
        protocol: 'https',
        hostname: '*.cloudflarestorage.com',
      },
      {
        protocol: 'https',
        hostname: '*.r2.cloudflarestorage.com',
      },
      {
        protocol: 'https',
        hostname: 'pub-*.r2.dev',
      },
      {
        protocol: 'https',
        hostname: 'r2.kiwimart.co.nz',
      },
      // Dynamically allow whatever domain NEXT_PUBLIC_R2_PUBLIC_URL points to
      ...(r2Host ? [{ protocol: 'https' as const, hostname: r2Host }] : []),
    ],
  },
};

export default nextConfig;
