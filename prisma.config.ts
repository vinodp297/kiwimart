// prisma.config.ts
// Prisma 7 requires database connection config here (not in schema.prisma).
import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

const directUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL!;

export default defineConfig({
  earlyAccess: true,
  datasource: {
    url: directUrl,
  },
  migrate: {
    async adapter() {
      return new PrismaPg({ connectionString: directUrl });
    },
  },
});
