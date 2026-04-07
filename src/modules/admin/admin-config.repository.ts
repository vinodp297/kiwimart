// src/modules/admin/admin-config.repository.ts
// ─── Admin Config Repository — data access for platform configuration ─────────

import db from "@/lib/db";
import { Prisma } from "@prisma/client";

type DbClient = Prisma.TransactionClient | typeof db;

export const adminConfigRepository = {
  /** Fetch all platform config records with updater info.
   * @source src/server/actions/admin-config.ts — getAllConfigs */
  async findAll(tx?: DbClient) {
    const client = tx ?? db;
    return client.platformConfig.findMany({
      orderBy: [{ category: "asc" }, { key: "asc" }],
      include: {
        updater: { select: { displayName: true } },
      },
    });
  },

  /** Fetch a single config record by key.
   * @source src/server/actions/admin-config.ts — updateConfig */
  async findByKey(key: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.platformConfig.findUnique({ where: { key } });
  },

  /** Update a config value and record who changed it.
   * @source src/server/actions/admin-config.ts — updateConfig */
  async updateValue(
    key: string,
    value: string,
    updatedById: string,
    tx?: DbClient,
  ): Promise<void> {
    const client = tx ?? db;
    await client.platformConfig.update({
      where: { key },
      data: { value, updatedById },
    });
  },
};
