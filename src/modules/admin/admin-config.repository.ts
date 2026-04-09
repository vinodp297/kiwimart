// src/modules/admin/admin-config.repository.ts
// ─── Admin Config Repository — data access for platform configuration ─────────

import { getClient, type DbClient } from "@/lib/db";

export const adminConfigRepository = {
  /** Fetch all platform config records with updater info. */
  async findAll(tx?: DbClient) {
    const client = getClient(tx);
    return client.platformConfig.findMany({
      orderBy: [{ category: "asc" }, { key: "asc" }],
      include: {
        updater: { select: { displayName: true } },
      },
    });
  },

  /** Fetch a single config record by key. */
  async findByKey(key: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.platformConfig.findUnique({ where: { key } });
  },

  /** Update a config value and record who changed it. */
  async updateValue(
    key: string,
    value: string,
    updatedById: string,
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.platformConfig.update({
      where: { key },
      data: { value, updatedById },
    });
  },
};
