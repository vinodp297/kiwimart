-- Shopping Cart: Cart, CartItem, OrderItem tables + AuditAction expansion
-- Safe to re-run: all statements use IF NOT EXISTS guards.

-- ── Cart table ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Cart" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "sellerId"  TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Cart_userId_key" ON "Cart"("userId");
CREATE INDEX IF NOT EXISTS "Cart_userId_idx" ON "Cart"("userId");
CREATE INDEX IF NOT EXISTS "Cart_expiresAt_idx" ON "Cart"("expiresAt");

ALTER TABLE "Cart" DROP CONSTRAINT IF EXISTS "Cart_userId_fkey";
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── CartItem table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CartItem" (
    "id"          TEXT NOT NULL,
    "cartId"      TEXT NOT NULL,
    "listingId"   TEXT NOT NULL,
    "priceNzd"    INTEGER NOT NULL,
    "shippingNzd" INTEGER NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CartItem_cartId_listingId_key" ON "CartItem"("cartId", "listingId");
CREATE INDEX IF NOT EXISTS "CartItem_cartId_idx" ON "CartItem"("cartId");
CREATE INDEX IF NOT EXISTS "CartItem_listingId_idx" ON "CartItem"("listingId");

ALTER TABLE "CartItem" DROP CONSTRAINT IF EXISTS "CartItem_cartId_fkey";
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey"
    FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CartItem" DROP CONSTRAINT IF EXISTS "CartItem_listingId_fkey";
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── OrderItem table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "OrderItem" (
    "id"          TEXT NOT NULL,
    "orderId"     TEXT NOT NULL,
    "listingId"   TEXT NOT NULL,
    "priceNzd"    INTEGER NOT NULL,
    "shippingNzd" INTEGER NOT NULL DEFAULT 0,
    "title"       TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX IF NOT EXISTS "OrderItem_listingId_idx" ON "OrderItem"("listingId");

ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_orderId_fkey";
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Expand AuditAction enum ─────────────────────────────────────────────────
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CART_CHECKOUT';
