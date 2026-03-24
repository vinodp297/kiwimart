// prisma.config.ts
// Prisma 7 stable — datasource URL only (earlyAccess/migrate keys removed)
import { defineConfig } from 'prisma/config';

const directUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL ?? '';

export default defineConfig({
  datasource: {
    url: directUrl,
  },
});
