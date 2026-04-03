import "server-only";
// src/lib/db.ts
// ─── Prisma Client Singleton ──────────────────────────────────────────────────
// Prisma 7 requires a driver adapter — url is no longer passed in schema.prisma.
// Next.js hot-reload creates new module instances in development, which would
// exhaust the Neon connection pool. The global singleton pattern prevents this.

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
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
