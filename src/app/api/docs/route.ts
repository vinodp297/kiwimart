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
                        page: {
                          type: "integer",
                          description: "Current page number (1-based)",
                        },
                        pageSize: {
                          type: "integer",
                          description: "Items per page",
                        },
                        hasMore: {
                          type: "boolean",
                          description: "Whether a next page exists",
                        },
                        total: {
                          type: "integer",
                          description: "Total matching listings",
                        },
                        totalPages: {
                          type: "integer",
                          description: "Total number of pages",
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
    "/api/v1/listings/{id}": {
      delete: {
        summary: "Delete a listing (soft delete)",
        tags: ["Listings"],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "Listing deleted successfully" },
          "403": { description: "Not the owner" },
          "404": { description: "Listing not found" },
        },
      },
    },
    "/api/v1/offers": {
      get: {
        summary: "List offers for the authenticated user",
        tags: ["Offers"],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 20 },
          },
          {
            name: "role",
            in: "query",
            schema: { type: "string", enum: ["buyer", "seller"] },
            description:
              "Filter to offers where user is buyer or seller. Omit for both.",
          },
        ],
        responses: {
          "200": { description: "Paginated offers" },
          "401": { description: "Unauthorised" },
        },
      },
      post: {
        summary: "Create an offer on a listing",
        tags: ["Offers"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["listingId", "amountNzd"],
                properties: {
                  listingId: { type: "string" },
                  amountNzd: {
                    type: "integer",
                    description: "Offer amount in NZD cents",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Offer created" },
          "400": { description: "Validation error" },
          "401": { description: "Unauthorised" },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/api/v1/disputes": {
      post: {
        summary: "Open a dispute on an order",
        tags: ["Disputes"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["orderId", "reason", "buyerStatement"],
                properties: {
                  orderId: { type: "string" },
                  reason: {
                    type: "string",
                    enum: [
                      "ITEM_NOT_RECEIVED",
                      "ITEM_NOT_AS_DESCRIBED",
                      "ITEM_DAMAGED",
                      "WRONG_ITEM_SENT",
                      "COUNTERFEIT_ITEM",
                      "SELLER_UNRESPONSIVE",
                      "SELLER_CANCELLED",
                      "REFUND_NOT_PROCESSED",
                      "OTHER",
                    ],
                  },
                  buyerStatement: {
                    type: "string",
                    minLength: 10,
                    maxLength: 2000,
                    description: "Buyer's description of the issue",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Dispute opened" },
          "400": { description: "Validation error" },
          "401": { description: "Unauthorised" },
        },
      },
    },
    "/api/v1/reviews": {
      get: {
        summary: "List reviews (public)",
        tags: ["Reviews"],
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 20 },
          },
          {
            name: "sellerId",
            in: "query",
            schema: { type: "string" },
            description: "Filter by seller (subjectId)",
          },
          {
            name: "buyerId",
            in: "query",
            schema: { type: "string" },
            description: "Filter by buyer (authorId)",
          },
        ],
        responses: {
          "200": { description: "Paginated reviews" },
        },
      },
      post: {
        summary: "Create a review for a completed order",
        tags: ["Reviews"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["orderId", "rating"],
                properties: {
                  orderId: { type: "string" },
                  rating: { type: "number", minimum: 1, maximum: 5 },
                  comment: { type: "string" },
                  reviewerRole: { type: "string", enum: ["BUYER", "SELLER"] },
                  tags: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Review created" },
          "400": { description: "Validation error" },
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
      post: {
        summary: "Add a listing to the cart",
        tags: ["Cart"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["listingId"],
                properties: {
                  listingId: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Item added, returns cartItemCount" },
          "400": {
            description: "Validation or cart error (e.g. SELLER_MISMATCH)",
          },
          "401": { description: "Unauthorised" },
        },
      },
    },
    "/api/v1/notifications/push": {
      post: {
        summary: "Register a device push token",
        tags: ["Notifications"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["token", "platform", "deviceId"],
                properties: {
                  token: { type: "string", maxLength: 512 },
                  platform: { type: "string", enum: ["ios", "android"] },
                  deviceId: { type: "string", maxLength: 255 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Token registered" },
          "400": { description: "Validation error" },
          "401": { description: "Unauthorised" },
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
          isRead: { type: "boolean" },
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
