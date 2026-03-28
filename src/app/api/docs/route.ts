// src/app/api/docs/route.ts
// ─── OpenAPI 3.0 Spec for KiwiMart API ──────────────────────────────────────
// Serves the OpenAPI spec as JSON. Protected in production (admin only).

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "KiwiMart API",
    version: "1.0.0",
    description:
      "Marketplace API for KiwiMart — NZ second-hand goods marketplace.",
  },
  servers: [
    { url: "https://kiwimart.vercel.app", description: "Production" },
    { url: "http://localhost:3000", description: "Local development" },
  ],
  paths: {
    "/api/v1/search": {
      get: {
        summary: "Search listings",
        tags: ["Search"],
        parameters: [
          {
            name: "q",
            in: "query",
            schema: { type: "string" },
            description: "Search query",
          },
          { name: "category", in: "query", schema: { type: "string" } },
          { name: "region", in: "query", schema: { type: "string" } },
          {
            name: "minPrice",
            in: "query",
            schema: { type: "integer" },
            description: "Min price in NZD cents",
          },
          {
            name: "maxPrice",
            in: "query",
            schema: { type: "integer" },
            description: "Max price in NZD cents",
          },
          {
            name: "condition",
            in: "query",
            schema: {
              type: "string",
              enum: ["NEW", "LIKE_NEW", "GOOD", "FAIR", "POOR"],
            },
          },
          {
            name: "sort",
            in: "query",
            schema: {
              type: "string",
              enum: ["relevance", "price_asc", "price_desc", "newest"],
            },
          },
          {
            name: "page",
            in: "query",
            schema: { type: "integer", default: 1 },
          },
          {
            name: "pageSize",
            in: "query",
            schema: { type: "integer", default: 20 },
          },
        ],
        responses: {
          "200": {
            description: "Paginated listing results",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "object",
                      properties: {
                        listings: {
                          type: "array",
                          items: { $ref: "#/components/schemas/ListingCard" },
                        },
                        total: { type: "integer" },
                        page: { type: "integer" },
                        pageSize: { type: "integer" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/listings": {
      get: {
        summary: "List recent listings",
        tags: ["Listings"],
        parameters: [
          {
            name: "page",
            in: "query",
            schema: { type: "integer", default: 1 },
          },
          {
            name: "pageSize",
            in: "query",
            schema: { type: "integer", default: 20 },
          },
        ],
        responses: {
          "200": { description: "Paginated listings" },
        },
      },
    },
    "/api/v1/notifications": {
      get: {
        summary: "Get user notifications",
        tags: ["Notifications"],
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Latest notifications",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "object",
                      properties: {
                        notifications: {
                          type: "array",
                          items: { $ref: "#/components/schemas/Notification" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      patch: {
        summary: "Mark all notifications as read",
        tags: ["Notifications"],
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Notifications marked as read" },
          "401": { description: "Unauthorised" },
        },
      },
    },
    "/api/v1/cart": {
      get: {
        summary: "Get cart item count",
        tags: ["Cart"],
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Cart count",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { count: { type: "integer" } },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/users/me": {
      get: {
        summary: "Get current authenticated user",
        tags: ["Users"],
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Current user profile" },
          "401": { description: "Not authenticated" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Auth.js session token",
      },
    },
    schemas: {
      ListingCard: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          priceNzd: { type: "integer", description: "Price in NZD cents" },
          condition: { type: "string" },
          region: { type: "string" },
          suburb: { type: "string" },
          thumbnailUrl: { type: "string" },
          sellerUsername: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Notification: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          read: { type: "boolean" },
          link: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Error: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          error: { type: "string" },
          code: { type: "string" },
        },
      },
    },
  },
};

export async function GET() {
  // In production, require admin auth
  if (process.env.NODE_ENV === "production") {
    const session = await auth();
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  return NextResponse.json(openApiSpec, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
