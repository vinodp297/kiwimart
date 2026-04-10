import "server-only";
import { env } from "@/env";
// src/lib/db.ts
// ─── Prisma Client Singleton ──────────────────────────────────────────────────
// Prisma 7 requires a driver adapter — url is no longer passed in schema.prisma.
// Next.js hot-reload creates new module instances in development, which would
// exhaust the Neon connection pool. The global singleton pattern prevents this.

import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// ── Shared repository types ────────────────────────────────────────────────
// Every repository that supports optional transaction clients should use these
// rather than re-declaring the same type and helper locally.

/** A Prisma interactive-transaction client OR the root PrismaClient. */
export type DbClient = Prisma.TransactionClient | PrismaClient;

/** Return `tx` if provided, otherwise the singleton `db` instance. */
export function getClient(tx?: DbClient): DbClient {
  return tx ?? db;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
  });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

export default db;
