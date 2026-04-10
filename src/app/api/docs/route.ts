// src/app/api/docs/route.ts
// ─── OpenAPI 3.0 Spec for Buyzi API ─────────────────────────────────────────
// Serves the OpenAPI spec as JSON. Protected in production (admin only).

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { apiError } from "@/app/api/v1/_helpers/response";

export const dynamic = "force-dynamic";

const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Buyzi API",
    version: "2.0.0",
    description: [
      "REST API for Buyzi (formerly KiwiMart) — NZ second-hand goods marketplace.",
      "",
      "## Authentication",
      "",
      "Two authentication modes are supported. Most endpoints accept either.",
      "",
      "### Session Cookie (web clients)",
      "Browser clients authenticate via the HTTP-only session cookie set by the",
      "Auth.js sign-in flow (`authjs.session-token`). The cookie is sent automatically",
      "with each same-origin request. No `Authorization` header is required.",
      "",
      "### Bearer Token (mobile clients)",
      "Mobile clients exchange credentials for a 7-day JWT via",
      "`POST /api/v1/auth/token`, then pass it as `Authorization: Bearer <token>`.",
      "Tokens can be refreshed before expiry via `POST /api/v1/auth/refresh` and",
      "revoked on sign-out via `POST /api/v1/auth/logout`.",
      "",
      "The `/api/v1/auth/*` endpoints (token, refresh, logout) are **mobile-only**",
      "and only accept Bearer authentication (or no auth for the token exchange).",
      "The `/api/v1/me/nav-summary` endpoint is **web-only** and only accepts the",
      "session cookie.",
      "",
      "### Response Envelope",
      "Every response uses a consistent JSON envelope:",
      "```",
      'Success: { "success": true,  "data": {...},    "timestamp": "<ISO-8601>" }',
      'Error:   { "success": false, "error": "...", "code": "ERROR_CODE", "timestamp": "<ISO-8601>" }',
      "```",
    ].join("\n"),
  },
  servers: [
    { url: "https://kiwimart.co.nz", description: "Production" },
    { url: "http://localhost:3000", description: "Local development" },
  ],
  tags: [
    {
      name: "Auth",
      description: "Mobile authentication — token exchange, refresh, logout",
    },
    {
      name: "Account",
      description: "Account management — profile update, data export, deletion",
    },
    { name: "Users", description: "Public user profile endpoints" },
    { name: "Me", description: "Authenticated user summary endpoints" },
    {
      name: "Listings",
      description: "Listing creation, retrieval, update and deletion",
    },
    { name: "Search", description: "Full-text listing search" },
    { name: "Offers", description: "Offer creation and responses" },
    { name: "Orders", description: "Order history" },
    { name: "Disputes", description: "Dispute management" },
    { name: "Reviews", description: "Buyer and seller reviews" },
    { name: "Messages", description: "Buyer/seller messaging threads" },
    { name: "Cart", description: "Cart management" },
    { name: "Notifications", description: "In-app and push notifications" },
    { name: "Pickup", description: "In-person pickup scheduling" },
  ],
  paths: {
    // ── Auth (mobile only) ───────────────────────────────────────────────────

    "/api/v1/auth/token": {
      post: {
        summary: "Exchange credentials for a Bearer token (mobile)",
        description:
          "Authenticates with email and password and returns a 7-day JWT for use" +
          " as a Bearer token on all subsequent API requests. Rate limited per IP.",
        tags: ["Auth"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string", minLength: 1 },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Token issued successfully",
            content: {
              "application/json": {
                schema: {
                  allOf: [{ $ref: "#/components/schemas/SuccessEnvelope" }],
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        token: { type: "string", description: "7-day JWT" },
                        expiresAt: { type: "string", format: "date-time" },
                        user: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            email: { type: "string", format: "email" },
                            role: { type: "string", enum: ["user", "admin"] },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/InvalidCredentials" },
          "403": { $ref: "#/components/responses/Banned" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/v1/auth/refresh": {
      post: {
        summary: "Refresh a Bearer token (mobile)",
        description:
          "Validates the current Bearer token and issues a new one with a fresh" +
          " 7-day expiry. The old token remains valid until its original expiry.",
        tags: ["Auth"],
        security: [{ mobileBearer: [] }],
        responses: {
          "200": {
            description: "New token issued",
            content: {
              "application/json": {
                schema: {
                  allOf: [{ $ref: "#/components/schemas/SuccessEnvelope" }],
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        token: { type: "string" },
                        expiresAt: { type: "string", format: "date-time" },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorised" },
        },
      },
    },

    "/api/v1/auth/logout": {
      post: {
        summary: "Revoke the current Bearer token (mobile)",
        description:
          "Revokes the JWT by adding its `jti` claim to the blocklist in Redis." +
          " After this call the token is immediately invalid. Only accepts Bearer" +
          " authentication — session-cookie callers do not have a `jti` to revoke.",
        tags: ["Auth"],
        security: [{ mobileBearer: [] }],
        responses: {
          "200": {
            description: "Token revoked",
            content: {
              "application/json": {
                schema: {
                  allOf: [{ $ref: "#/components/schemas/SuccessEnvelope" }],
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        message: {
                          type: "string",
                          example: "Logged out successfully",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorised" },
        },
      },
    },

    // ── Account ──────────────────────────────────────────────────────────────

    "/api/v1/account": {
      patch: {
        summary: "Update account profile",
        description:
          "Updates the authenticated user's display name, region, and bio.",
        tags: ["Account"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  displayName: { type: "string", minLength: 2, maxLength: 40 },
                  region: { type: "string", maxLength: 100, nullable: true },
                  bio: { type: "string", maxLength: 500, nullable: true },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Profile updated",
            content: {
              "application/json": {
                schema: {
                  allOf: [{ $ref: "#/components/schemas/SuccessEnvelope" }],
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        user: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            displayName: { type: "string" },
                            region: { type: "string", nullable: true },
                            bio: { type: "string", nullable: true },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorised" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/v1/account/delete": {
      post: {
        summary: "Delete account (NZ Privacy Act 2020)",
        description:
          "Permanently anonymises the account. Requires current password for" +
          " confirmation. Creates an immutable ErasureLog record for compliance." +
          " Social-login accounts (no password hash) cannot use this endpoint" +
          " and must contact support.",
        tags: ["Account"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["password"],
                properties: {
                  password: {
                    type: "string",
                    description: "Current account password",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Account deleted",
            content: {
              "application/json": {
                schema: {
                  allOf: [{ $ref: "#/components/schemas/SuccessEnvelope" }],
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        success: { type: "boolean", example: true },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorised" },
        },
      },
    },

    "/api/v1/account/export-data": {
      post: {
        summary: "Request a personal data export (NZ Privacy Act 2020)",
        description:
          "Compiles all personal data for the authenticated user and emails it to" +
          " their verified address. Rate limited to once per 30 days.",
        tags: ["Account"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
        responses: {
          "200": {
            description:
              "Export queued — email will arrive within a few minutes",
            content: {
              "application/json": {
                schema: {
                  allOf: [{ $ref: "#/components/schemas/SuccessEnvelope" }],
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        message: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorised" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    // ── Me ───────────────────────────────────────────────────────────────────

    "/api/v1/me/nav-summary": {
      get: {
        summary: "Batched navbar data (web only)",
        description:
          "Returns cart count, unread notification count, latest notifications," +
          " and the authenticated user profile in a single request." +
          " Intended for the browser navbar — session-cookie only.",
        tags: ["Me"],
        security: [{ sessionCookie: [] }],
        responses: {
          "200": {
            description: "Navbar summary",
            content: {
              "application/json": {
                schema: {
                  allOf: [{ $ref: "#/components/schemas/SuccessEnvelope" }],
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        cartCount: {
                          type: "integer",
                          description:
                            "Number of active items in the cart (0 if expired or empty)",
                        },
                        unreadNotificationCount: { type: "integer" },
                        notifications: {
                          type: "array",
                          description: "Latest 10 notifications",
                          items: { $ref: "#/components/schemas/Notification" },
                        },
                        user: {
                          nullable: true,
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            name: { type: "string", nullable: true },
                            email: { type: "string", format: "email" },
                            role: { type: "string", enum: ["USER", "ADMIN"] },
                            avatarUrl: { type: "string", nullable: true },
                            isAdmin: { type: "boolean" },
                            isSellerEnabled: { type: "boolean" },
                            isMfaEnabled: { type: "boolean" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorised" },
        },
      },
    },

    // ── Users ────────────────────────────────────────────────────────────────

    "/api/v1/users/me": {
      get: {
        summary: "Get current user profile",
        description:
          "Returns the full profile for the authenticated user including" +
          " seller and verification status.",
        tags: ["Users"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
        responses: {
          "200": {
            description: "User profile",
            content: {
              "application/json": {
                schema: {
                  allOf: [{ $ref: "#/components/schemas/SuccessEnvelope" }],
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        username: { type: "string", nullable: true },
                        displayName: { type: "string", nullable: true },
                        email: { type: "string", format: "email" },
                        avatarKey: { type: "string", nullable: true },
                        region: { type: "string", nullable: true },
                        bio: { type: "string", nullable: true },
                        isSellerEnabled: { type: "boolean" },
                        isStripeOnboarded: { type: "boolean" },
                        idVerified: { type: "boolean" },
                        isPhoneVerified: { type: "boolean" },
                        createdAt: { type: "string", format: "date-time" },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorised" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    // ── Listings ─────────────────────────────────────────────────────────────

    "/api/v1/listings": {
      get: {
        summary: "Browse listings (cursor-paginated)",
        description: "Returns a cursor-paginated feed of active listings.",
        tags: ["Listings"],
        parameters: [
          {
            name: "cursor",
            in: "query",
            schema: { type: "string" },
            description:
              "Opaque cursor from a previous response's `nextCursor`",
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 20, minimum: 1, maximum: 48 },
          },
          {
            name: "q",
            in: "query",
            schema: { type: "string" },
            description: "Optional keyword filter",
          },
          {
            name: "category",
            in: "query",
            schema: { type: "string" },
            description: "Filter by category ID",
          },
        ],
        responses: {
          "200": {
            description: "Paginated listings",
            content: {
              "application/json": {
                schema: {
                  allOf: [{ $ref: "#/components/schemas/SuccessEnvelope" }],
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        listings: {
                          type: "array",
                          items: { $ref: "#/components/schemas/ListingCard" },
                        },
                        nextCursor: { type: "string", nullable: true },
                        hasMore: { type: "boolean" },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
        },
      },
      post: {
        summary: "Create a listing",
        description:
          "Creates a new listing. Seller must be enabled and Stripe-onboarded.",
        tags: ["Listings"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateListingBody" },
            },
          },
        },
        responses: {
          "201": {
            description: "Listing created",
            content: {
              "application/json": {
                schema: {
                  allOf: [{ $ref: "#/components/schemas/SuccessEnvelope" }],
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        listing: { $ref: "#/components/schemas/ListingCard" },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorised" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/v1/listings/{id}": {
      patch: {
        summary: "Update a listing (owner only)",
        description:
          "Partially updates a listing. Only the fields provided are changed." +
          " Owner must be the authenticated user.",
        tags: ["Listings"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateListingBody" },
            },
          },
        },
        responses: {
          "200": {
            description: "Listing updated",
            content: {
              "application/json": {
                schema: {
                  allOf: [{ $ref: "#/components/schemas/SuccessEnvelope" }],
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        listing: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            title: { type: "string" },
                            status: { type: "string" },
                            priceNzd: { type: "integer" },
                            updatedAt: { type: "string", format: "date-time" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorised" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        summary: "Delete a listing (soft delete)",
        description:
          "Soft-deletes the listing by setting `deletedAt` and status to `REMOVED`." +
          " Owner or admin may delete. The listing is no longer publicly visible.",
        tags: ["Listings"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Listing deleted",
            content: {
              "application/json": {
                schema: {
                  allOf: [{ $ref: "#/components/schemas/SuccessEnvelope" }],
                  properties: {
                    data: {
                      type: "object",
                      properties: { message: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorised" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    "/api/v1/listings/{id}/watch": {
      post: {
        summary: "Toggle watchlist for a listing",
        description:
          "Adds the listing to the authenticated user's watchlist if not already" +
          " watching, or removes it if already watching.",
        tags: ["Listings"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Watchlist toggled",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessEnvelope" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorised" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    // ── Search ───────────────────────────────────────────────────────────────

    "/api/v1/search": {
      get: {
        summary: "Full-text listing search",
        description:
          "Offset-paginated full-text search using Postgres `tsvector`." +
          " Supports keyword, category, condition, region, price range, and sort filters.",
        tags: ["Search"],
        parameters: [
          {
            name: "q",
            in: "query",
            schema: { type: "string", maxLength: 200 },
            description: "Full-text search query",
          },
          {
            name: "category",
            in: "query",
            schema: { type: "string", maxLength: 100 },
          },
          {
            name: "subcategory",
            in: "query",
            schema: { type: "string", maxLength: 100 },
          },
          {
            name: "region",
            in: "query",
            schema: { type: "string", maxLength: 100 },
          },
          {
            name: "condition",
            in: "query",
            schema: {
              type: "string",
              enum: ["NEW", "LIKE_NEW", "GOOD", "FAIR", "PARTS"],
            },
            description: "Listing condition",
          },
          {
            name: "priceMin",
            in: "query",
            schema: { type: "number", minimum: 0 },
            description: "Minimum price in NZD (dollars, not cents)",
          },
          {
            name: "priceMax",
            in: "query",
            schema: { type: "number", minimum: 0 },
            description: "Maximum price in NZD (dollars, not cents)",
          },
          {
            name: "sort",
            in: "query",
            schema: {
              type: "string",
              enum: [
                "newest",
                "oldest",
                "price-asc",
                "price-desc",
                "most-watched",
              ],
            },
            description: "Sort order (default: newest)",
          },
          {
            name: "page",
            in: "query",
            schema: { type: "integer", minimum: 1, default: 1 },
          },
          {
            name: "pageSize",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 48, default: 24 },
          },
        ],
        responses: {
          "200": {
            description: "Search results",
            content: {
              "application/json": {
                schema: {
                  allOf: [{ $ref: "#/components/schemas/SuccessEnvelope" }],
                  properties: {
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
                        pageSize: { type: "integer" },
                        hasMore: { type: "boolean" },
                        total: {
                          type: "integer",
                          description: "Total matching listings",
                        },
                        totalPages: { type: "integer" },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
        },
      },
    },

    // ── Offers ───────────────────────────────────────────────────────────────

    "/api/v1/offers": {
      get: {
        summary: "List offers for the authenticated user",
        description:
          "Returns cursor-paginated offers where the user is buyer or seller.",
        tags: ["Offers"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 20, minimum: 1, maximum: 50 },
          },
          {
            name: "role",
            in: "query",
            schema: { type: "string", enum: ["buyer", "seller"] },
            description:
              "Filter to offers where the user is buyer or seller. Omit for both.",
          },
        ],
        responses: {
          "200": {
            description: "Paginated offers",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessEnvelope" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorised" },
        },
      },
      post: {
        summary: "Create an offer on a listing",
        description:
          "Submits a price offer to the seller. The listing must be active and" +
          " have offers enabled. The buyer must not be the seller.",
        tags: ["Offers"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
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
          "201": {
            description: "Offer created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessEnvelope" },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorised" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/v1/offers/{id}": {
      patch: {
        summary: "Accept or decline an offer (seller only)",
        description:
          "Responds to an offer as the seller. Accepting an offer creates an order" +
          " and sets the listing to `RESERVED`.",
        tags: ["Offers"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["action"],
                properties: {
                  action: { type: "string", enum: ["ACCEPT", "DECLINE"] },
                  declineReason: { type: "string", maxLength: 300 },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Offer response recorded",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessEnvelope" },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorised" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    // ── Orders ───────────────────────────────────────────────────────────────

    "/api/v1/orders": {
      get: {
        summary: "List orders for the authenticated buyer",
        description:
          "Returns cursor-paginated purchase orders for the authenticated user.",
        tags: ["Orders"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 20, minimum: 1, maximum: 50 },
          },
        ],
        responses: {
          "200": {
            description: "Paginated orders",
            content: {
              "application/json": {
                schema: {
                  allOf: [{ $ref: "#/components/schemas/SuccessEnvelope" }],
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        orders: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              id: { type: "string" },
                              status: {
                                type: "string",
                                enum: [
                                  "AWAITING_PAYMENT",
                                  "PAYMENT_HELD",
                                  "AWAITING_PICKUP",
                                  "DISPATCHED",
                                  "DELIVERED",
                                  "COMPLETED",
                                  "DISPUTED",
                                  "REFUNDED",
                                  "CANCELLED",
                                ],
                              },
                              totalNzd: {
                                type: "integer",
                                description: "Total in NZD cents",
                              },
                              createdAt: {
                                type: "string",
                                format: "date-time",
                              },
                              listing: {
                                type: "object",
                                properties: {
                                  id: { type: "string" },
                                  title: { type: "string" },
                                },
                              },
                            },
                          },
                        },
                        nextCursor: { type: "string", nullable: true },
                        hasMore: { type: "boolean" },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorised" },
        },
      },
    },

    // ── Disputes ─────────────────────────────────────────────────────────────

    "/api/v1/disputes": {
      post: {
        summary: "Open a dispute on an order (buyer only)",
        description:
          "Opens a formal dispute for an order. Requires the order to be in a" +
          " disputable state (dispatched or delivered). Rate limited per user.",
        tags: ["Disputes"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
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
          "201": {
            description: "Dispute opened",
            content: {
              "application/json": {
                schema: {
                  allOf: [{ $ref: "#/components/schemas/SuccessEnvelope" }],
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        opened: { type: "boolean", example: true },
                        orderId: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorised" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    // ── Reviews ───────────────────────────────────────────────────────────────

    "/api/v1/reviews": {
      get: {
        summary: "List reviews (public)",
        description:
          "Returns cursor-paginated reviews. Filter by seller or buyer ID.",
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
          "200": {
            description: "Paginated reviews",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessEnvelope" },
              },
            },
          },
        },
      },
      post: {
        summary: "Create a review for a completed order",
        description:
          "Submits a buyer or seller review. The order must be completed and the" +
          " reviewer must not have already reviewed this order in the same role.",
        tags: ["Reviews"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["orderId", "rating"],
                properties: {
                  orderId: { type: "string" },
                  rating: {
                    type: "number",
                    minimum: 1,
                    maximum: 5,
                    description: "Rating from 1 to 5",
                  },
                  comment: { type: "string", maxLength: 1000 },
                  reviewerRole: { type: "string", enum: ["BUYER", "SELLER"] },
                  tags: {
                    type: "array",
                    items: {
                      type: "string",
                      enum: [
                        "FAST_SHIPPING",
                        "GREAT_PACKAGING",
                        "ACCURATE_DESCRIPTION",
                        "QUICK_COMMUNICATION",
                        "FAIR_PRICING",
                        "AS_DESCRIBED",
                      ],
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Review created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessEnvelope" },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorised" },
        },
      },
    },

    // ── Messages ─────────────────────────────────────────────────────────────

    "/api/v1/messages": {
      get: {
        summary: "List message threads",
        description:
          "Returns cursor-paginated message threads for the authenticated user.",
        tags: ["Messages"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 20, minimum: 1, maximum: 50 },
          },
        ],
        responses: {
          "200": {
            description: "Paginated threads",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessEnvelope" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorised" },
        },
      },
      post: {
        summary: "Send a message",
        description:
          "Sends a message to another user, optionally in the context of a listing.",
        tags: ["Messages"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["recipientId", "body"],
                properties: {
                  recipientId: { type: "string" },
                  body: { type: "string", minLength: 1, maxLength: 2000 },
                  listingId: {
                    type: "string",
                    description: "Optional — links the message to a listing",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Message sent",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessEnvelope" },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorised" },
        },
      },
    },

    // ── Cart ──────────────────────────────────────────────────────────────────

    "/api/v1/cart": {
      get: {
        summary: "Get cart item count",
        description:
          "Returns the number of active items in the cart." +
          " Returns `{ count: 0 }` for unauthenticated requests or an expired cart.",
        tags: ["Cart"],
        responses: {
          "200": {
            description: "Cart item count",
            content: {
              "application/json": {
                schema: {
                  allOf: [{ $ref: "#/components/schemas/SuccessEnvelope" }],
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        count: { type: "integer", minimum: 0 },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        summary: "Add a listing to the cart",
        description:
          "Adds a listing to the authenticated user's cart. The cart expires after 30 minutes of inactivity.",
        tags: ["Cart"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
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
          "200": {
            description: "Item added",
            content: {
              "application/json": {
                schema: {
                  allOf: [{ $ref: "#/components/schemas/SuccessEnvelope" }],
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        cartItemCount: { type: "integer" },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorised" },
        },
      },
    },

    // ── Notifications ─────────────────────────────────────────────────────────

    "/api/v1/notifications": {
      get: {
        summary: "Get notifications (cursor-paginated)",
        description:
          "Returns cursor-paginated in-app notifications for the authenticated user." +
          " Returns an empty list for unauthenticated requests rather than a 401.",
        tags: ["Notifications"],
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 20, minimum: 1, maximum: 50 },
          },
        ],
        responses: {
          "200": {
            description: "Notifications",
            content: {
              "application/json": {
                schema: {
                  allOf: [{ $ref: "#/components/schemas/SuccessEnvelope" }],
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        notifications: {
                          type: "array",
                          items: { $ref: "#/components/schemas/Notification" },
                        },
                        nextCursor: { type: "string", nullable: true },
                        hasMore: { type: "boolean" },
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
        description:
          "Sets `isRead = true` on every unread notification for the authenticated user.",
        tags: ["Notifications"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
        responses: {
          "200": {
            description: "All notifications marked as read",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessEnvelope" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorised" },
        },
      },
    },

    "/api/v1/notifications/push": {
      post: {
        summary: "Register a device push token",
        description:
          "Registers or refreshes an FCM/APNs push token for the authenticated" +
          " user's device. Existing tokens for the same device are updated in place.",
        tags: ["Notifications"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["token", "platform"],
                properties: {
                  token: { type: "string", maxLength: 512 },
                  platform: { type: "string", enum: ["ios", "android", "web"] },
                  deviceId: {
                    type: "string",
                    maxLength: 255,
                    description:
                      "Optional stable device identifier for deduplication",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Token registered",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessEnvelope" },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorised" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
      delete: {
        summary: "Unregister a device push token",
        description:
          "Deactivates a push token on sign-out so the device no longer receives" +
          " push notifications.",
        tags: ["Notifications"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["token"],
                properties: {
                  token: { type: "string", maxLength: 512 },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Token unregistered",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessEnvelope" },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorised" },
        },
      },
    },

    // ── Pickup ────────────────────────────────────────────────────────────────

    "/api/v1/pickup/propose": {
      post: {
        summary: "Propose a pickup time",
        description:
          "Either party (buyer or seller) proposes a time for in-person pickup.",
        tags: ["Pickup"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["orderId", "proposedTime"],
                properties: {
                  orderId: { type: "string" },
                  proposedTime: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Pickup time proposed",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessEnvelope" },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorised" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    "/api/v1/pickup/accept": {
      post: {
        summary: "Accept a proposed pickup time",
        description:
          "Accepts the proposed pickup time. Optionally references a reschedule" +
          " request ID when accepting a rescheduled time.",
        tags: ["Pickup"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["orderId"],
                properties: {
                  orderId: { type: "string" },
                  rescheduleRequestId: {
                    type: "string",
                    description: "Required when accepting a rescheduled time",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Pickup time accepted",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessEnvelope" },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorised" },
        },
      },
    },

    "/api/v1/pickup/cancel": {
      post: {
        summary: "Cancel a pickup order",
        description:
          "Cancels the pickup arrangement for an order." +
          " A reason of at least 5 characters is required.",
        tags: ["Pickup"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["orderId", "reason"],
                properties: {
                  orderId: { type: "string" },
                  reason: { type: "string", minLength: 5 },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Pickup cancelled",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessEnvelope" },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorised" },
        },
      },
    },

    "/api/v1/pickup/reschedule": {
      post: {
        summary: "Request a pickup reschedule",
        description:
          "Either party requests a new pickup time, providing a reason and" +
          " a proposed replacement time.",
        tags: ["Pickup"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["orderId", "proposedTime"],
                properties: {
                  orderId: { type: "string" },
                  proposedTime: { type: "string", format: "date-time" },
                  sellerReason: {
                    type: "string",
                    description: "Reason enum for seller-initiated reschedules",
                  },
                  buyerReason: {
                    type: "string",
                    description: "Reason enum for buyer-initiated reschedules",
                  },
                  reasonNote: { type: "string", maxLength: 500 },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Reschedule requested",
            content: {
              "application/json": {
                schema: {
                  allOf: [{ $ref: "#/components/schemas/SuccessEnvelope" }],
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        rescheduled: { type: "boolean" },
                        forceCancelAvailable: {
                          type: "boolean",
                          description:
                            "True if the party may now force-cancel the order",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorised" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    "/api/v1/pickup/reschedule/respond": {
      post: {
        summary: "Respond to a reschedule request",
        description:
          "Accepts, declines, or counter-proposes an alternative time in response" +
          " to a reschedule request.",
        tags: ["Pickup"],
        security: [{ sessionCookie: [] }, { mobileBearer: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["orderId", "rescheduleRequestId", "response"],
                properties: {
                  orderId: { type: "string" },
                  rescheduleRequestId: { type: "string" },
                  response: {
                    type: "string",
                    enum: ["ACCEPT", "DECLINE", "PROPOSE_ALTERNATIVE"],
                  },
                  alternativeTime: {
                    type: "string",
                    format: "date-time",
                    description:
                      "Required when response is PROPOSE_ALTERNATIVE",
                  },
                  responseNote: { type: "string", maxLength: 500 },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Response recorded",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessEnvelope" },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorised" },
        },
      },
    },
  },

  components: {
    securitySchemes: {
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "authjs.session-token",
        description:
          "Auth.js HTTP-only session cookie set during sign-in (web clients)." +
          " Sent automatically by the browser — no manual header required.",
      },
      mobileBearer: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "7-day JWT issued by POST /api/v1/auth/token (mobile clients)." +
          " 7-day TTL balances security with UX — weekly re-authentication is acceptable for a marketplace mobile app." +
          " Pass as `Authorization: Bearer <token>`.",
      },
    },
    schemas: {
      SuccessEnvelope: {
        type: "object",
        description: "Standard success response wrapper used by all endpoints",
        properties: {
          success: { type: "boolean", example: true },
          data: { type: "object" },
          timestamp: {
            type: "string",
            format: "date-time",
            description: "Server time at response generation",
          },
        },
      },
      Error: {
        type: "object",
        description: "Standard error response wrapper",
        properties: {
          success: { type: "boolean", example: false },
          error: {
            type: "string",
            description: "Human-readable error message",
          },
          code: {
            type: "string",
            description:
              "Machine-readable error code (e.g. VALIDATION_ERROR, NOT_FOUND)",
          },
          timestamp: { type: "string", format: "date-time" },
        },
      },
      ListingCard: {
        type: "object",
        description:
          "Summary listing shape returned by browse and search endpoints",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          priceNzd: { type: "integer", description: "Price in NZD cents" },
          condition: {
            type: "string",
            enum: ["NEW", "LIKE_NEW", "GOOD", "FAIR", "PARTS"],
          },
          categoryId: { type: "string" },
          region: { type: "string", nullable: true },
          suburb: { type: "string", nullable: true },
          shippingOption: { type: "string" },
          isOffersEnabled: { type: "boolean" },
          status: { type: "string", enum: ["ACTIVE", "RESERVED", "SOLD"] },
          viewCount: { type: "integer" },
          watcherCount: { type: "integer" },
          createdAt: { type: "string", format: "date-time" },
          images: {
            type: "array",
            items: {
              type: "object",
              properties: {
                r2Key: { type: "string" },
                thumbnailKey: { type: "string", nullable: true },
              },
            },
          },
          seller: {
            type: "object",
            properties: {
              id: { type: "string" },
              username: { type: "string", nullable: true },
              displayName: { type: "string", nullable: true },
              idVerified: { type: "boolean" },
            },
          },
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
          listingId: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      CreateListingBody: {
        type: "object",
        description: "Fields for creating or updating a listing",
        properties: {
          title: { type: "string", minLength: 3, maxLength: 100 },
          description: { type: "string", maxLength: 5000 },
          price: { type: "number", description: "Price in NZD (dollars)" },
          condition: {
            type: "string",
            enum: ["NEW", "LIKE_NEW", "GOOD", "FAIR", "PARTS"],
          },
          categoryId: { type: "string" },
          subcategoryName: { type: "string", nullable: true },
          region: { type: "string" },
          suburb: { type: "string", nullable: true },
          shippingOption: {
            type: "string",
            enum: ["PICKUP", "SHIPPING", "BOTH"],
          },
          shippingPrice: {
            type: "number",
            description: "Shipping cost in NZD (dollars)",
            nullable: true,
          },
          isOffersEnabled: { type: "boolean" },
          isGstIncluded: { type: "boolean" },
          isUrgent: { type: "boolean" },
          isNegotiable: { type: "boolean" },
          shipsNationwide: { type: "boolean" },
          pickupAddress: { type: "string", nullable: true },
        },
      },
    },
    responses: {
      ValidationError: {
        description:
          "Validation error — request body or query parameters failed validation",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: {
              success: false,
              error: "Validation failed",
              code: "VALIDATION_ERROR",
              timestamp: "2026-04-07T00:00:00.000Z",
            },
          },
        },
      },
      Unauthorised: {
        description: "Unauthorised — missing or invalid authentication",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: {
              success: false,
              error: "Unauthorised",
              code: "UNAUTHENTICATED",
              timestamp: "2026-04-07T00:00:00.000Z",
            },
          },
        },
      },
      Forbidden: {
        description:
          "Forbidden — authenticated but not permitted to perform this action",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: {
              success: false,
              error: "Not your listing",
              code: "FORBIDDEN",
              timestamp: "2026-04-07T00:00:00.000Z",
            },
          },
        },
      },
      NotFound: {
        description: "Not found",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: {
              success: false,
              error: "Not found",
              code: "NOT_FOUND",
              timestamp: "2026-04-07T00:00:00.000Z",
            },
          },
        },
      },
      RateLimited: {
        description: "Too many requests — rate limit exceeded",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: {
              success: false,
              error: "Too many requests",
              code: "RATE_LIMITED",
              timestamp: "2026-04-07T00:00:00.000Z",
            },
          },
        },
      },
      InvalidCredentials: {
        description: "Invalid email or password",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: {
              success: false,
              error: "Invalid credentials",
              code: "INVALID_CREDENTIALS",
              timestamp: "2026-04-07T00:00:00.000Z",
            },
          },
        },
      },
      Banned: {
        description: "Account is suspended",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: {
              success: false,
              error: "Account is suspended",
              code: "ACCOUNT_BANNED",
              timestamp: "2026-04-07T00:00:00.000Z",
            },
          },
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
      return apiError("Not found", 404);
    }
  }

  return NextResponse.json(openApiSpec, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
