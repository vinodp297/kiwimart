// src/app/api/images/[...key]/route.ts
// ─── R2 Image Proxy with Prefix-Based Authorisation ─────────────────────────
// Serves files from Cloudflare R2. File access is gated by the R2 key prefix:
//
//   PUBLIC — no authentication required:
//     listings/   Listing images — buyers must be able to see them.
//     profiles/   User profile / avatar photos.
//
//   PROTECTED — requires authentication and authorisation:
//     disputes/  ORDER_PARTY_OR_ADMIN  Dispute evidence photos.
//     dispatch/  ORDER_PARTY_OR_ADMIN  Dispatch confirmation photos.
//     delivery/  ORDER_PARTY_OR_ADMIN  Delivery confirmation photos.
//     exports/   OWNER_ONLY           Personal data export files.
//     verification/ ADMIN_ONLY        KYC identity documents.
//
//   UNKNOWN prefix → 404 (fail closed — do not reveal that the path exists).
//
// Key path structure:
//   {prefix}/{resourceId}/{filename}
//   For ORDER_PARTY_OR_ADMIN: resourceId is the orderId.
//   For OWNER_ONLY:           resourceId is the userId.
//   For ADMIN_ONLY:           resourceId is the userId (admin sees all).
//
// URL format: /api/images/listings/user123/uuid-full.webp

import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { r2, R2_BUCKET } from "@/infrastructure/storage/r2";
import { auth } from "@/lib/auth";
import { orderRepository } from "@/modules/orders/order.repository";
import { logger } from "@/shared/logger";
import { apiError } from "@/app/api/v1/_helpers/response";

// ── Prefix classifications ────────────────────────────────────────────────────

const PUBLIC_PREFIXES = new Set(["listings/", "profiles/"]);

type AuthType = "ORDER_PARTY_OR_ADMIN" | "OWNER_ONLY" | "ADMIN_ONLY";

const PROTECTED_PREFIXES: Record<string, AuthType> = {
  "disputes/": "ORDER_PARTY_OR_ADMIN",
  "dispatch/": "ORDER_PARTY_OR_ADMIN",
  "delivery/": "ORDER_PARTY_OR_ADMIN",
  "exports/": "OWNER_ONLY",
  "verification/": "ADMIN_ONLY",
};

// ── MIME types for common extensions ─────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  json: "application/json",
  pdf: "application/pdf",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function unauthorized(): Response {
  return apiError("Unauthorised", 401);
}

function forbidden(): Response {
  return apiError("Forbidden", 403);
}

function notFound(): Response {
  return apiError("Not found", 404);
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  try {
    const { key } = await params;
    const r2Key = key.join("/");

    // Path traversal guard — must come before any prefix check.
    if (r2Key.includes("..")) {
      return notFound();
    }

    // ── Determine prefix ──────────────────────────────────────────────────
    const prefix = Object.keys(PROTECTED_PREFIXES).find((p) =>
      r2Key.startsWith(p),
    );
    const isPublic = [...PUBLIC_PREFIXES].some((p) => r2Key.startsWith(p));

    if (!isPublic && !prefix) {
      // Unknown prefix — fail closed. Do not reveal existence of the path.
      return notFound();
    }

    // ── Authorisation for protected prefixes ──────────────────────────────
    if (prefix) {
      const authType = PROTECTED_PREFIXES[prefix]!;
      const session = await auth();

      if (!session?.user?.id) {
        return unauthorized();
      }

      const userId = session.user.id;
      const isAdmin = !!(session.user as { isAdmin?: boolean }).isAdmin;

      // Segments: [prefix-without-slash, resourceId, ...rest]
      // key is already split by '/' so segments = key array
      // e.g. disputes/order-abc/evidence.jpg → segments[1] = "order-abc"
      const resourceId = key[1];

      if (!resourceId) {
        return notFound();
      }

      switch (authType) {
        case "ORDER_PARTY_OR_ADMIN": {
          if (!isAdmin) {
            const isParty = await orderRepository.isUserPartyToOrder(
              resourceId,
              userId,
            );
            if (!isParty) {
              return forbidden();
            }
          }
          break;
        }

        case "OWNER_ONLY": {
          // resourceId is the userId of the export owner
          if (userId !== resourceId) {
            return forbidden();
          }
          break;
        }

        case "ADMIN_ONLY": {
          if (!isAdmin) {
            return forbidden();
          }
          break;
        }
      }
    }

    // ── Serve the file from R2 ────────────────────────────────────────────
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
    });

    const response = await r2.send(command);

    if (!response.Body) {
      return notFound();
    }

    // Stream directly — no buffering into memory.
    // transformToWebStream() returns a ReadableStream that pipes R2 bytes to
    // the client as they arrive, avoiding Node.js heap pressure under load.
    const stream = (
      response.Body as { transformToWebStream(): ReadableStream }
    ).transformToWebStream();

    const ext = r2Key.split(".").pop()?.toLowerCase() ?? "";
    const contentType =
      response.ContentType ?? MIME_TYPES[ext] ?? "application/octet-stream";

    // Public files get long-lived cache headers; protected files must not be cached.
    const cacheControl = isPublic
      ? "public, max-age=3600, s-maxage=86400, immutable"
      : "private, no-store";

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
    };
    if (response.ContentLength) {
      headers["Content-Length"] = String(response.ContentLength);
    }
    if (response.ETag) {
      headers["ETag"] = response.ETag;
    }

    return new NextResponse(stream, { status: 200, headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("NoSuchKey") ||
      msg.includes("The specified key does not exist")
    ) {
      return notFound();
    }
    // Never log the key value — it may contain user IDs or order IDs
    logger.error("image_proxy.r2_fetch_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return apiError("Failed to load file", 500);
  }
}
