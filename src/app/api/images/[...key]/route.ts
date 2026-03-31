// src/app/api/images/[...key]/route.ts
// ─── R2 Image Proxy ─────────────────────────────────────────────────────────
// Serves images from Cloudflare R2 without requiring public bucket access.
// This route acts as a proxy: browser → Next.js API → R2 → response.
//
// URL format: /api/images/listings/user123/uuid-full.webp
// The [...key] catch-all param captures the full R2 key path.
//
// Caching: 1 hour browser cache, 24 hour CDN cache (Vercel Edge).
// This is safe because processed images are immutable (content-addressed).

import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { r2, R2_BUCKET } from "@/infrastructure/storage/r2";

// MIME types for common image extensions
const MIME_TYPES: Record<string, string> = {
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  svg: "image/svg+xml",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  try {
    const { key } = await params;
    const r2Key = key.join("/");

    // Basic validation: prevent path traversal, limit to known prefixes.
    // listings/{userId}/{filename}            — listing images
    // profiles/{userId}/{type}/{filename}     — avatar / cover images
    // dispatch/{userId}/{filename}            — dispatch evidence photos
    // delivery/{userId}/{filename}            — delivery evidence photos
    // disputes/{userId}/{filename}            — dispute evidence photos
    if (
      r2Key.includes("..") ||
      !r2Key.match(
        /^(listings|profiles|dispatch|delivery|disputes)\/[a-zA-Z0-9_-]+(\/[a-zA-Z0-9._-]+)+$/,
      )
    ) {
      return NextResponse.json(
        { error: "Invalid image path" },
        { status: 400 },
      );
    }

    const command = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
    });

    const response = await r2.send(command);

    if (!response.Body) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }

    // Convert stream to buffer — cast Body to AsyncIterable for Node.js iteration
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Determine content type from extension or R2 metadata
    const ext = r2Key.split(".").pop()?.toLowerCase() ?? "";
    const contentType =
      response.ContentType ?? MIME_TYPES[ext] ?? "application/octet-stream";

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        // Cache: 1 hour browser, 24 hours CDN (immutable processed images)
        "Cache-Control": "public, max-age=3600, s-maxage=86400, immutable",
        // Security: prevent sniffing
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // NoSuchKey = image doesn't exist in R2
    if (
      msg.includes("NoSuchKey") ||
      msg.includes("The specified key does not exist")
    ) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }
    console.error("[Image Proxy] Error:", msg);
    return NextResponse.json(
      { error: "Failed to load image" },
      { status: 500 },
    );
  }
}
