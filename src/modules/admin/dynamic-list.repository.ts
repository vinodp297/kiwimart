// src/modules/admin/dynamic-list.repository.ts
// ─── Dynamic List Repository — data access for admin-managed dynamic lists ────

import db, { getClient, type DbClient } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { DynamicListType } from "@prisma/client";

export const dynamicListRepository = {
  /** Fetch all items for a list type, ordered by sortOrder. */
  async findByType(listType: DynamicListType, tx?: DbClient) {
    const client = getClient(tx);
    return client.dynamicListItem.findMany({
      where: { listType },
      orderBy: { sortOrder: "asc" },
      include: {
        updater: { select: { displayName: true } },
      },
    });
  },

  /** Count items by list type for the admin sidebar. */
  async countByType(tx?: DbClient) {
    const client = getClient(tx);
    return client.dynamicListItem.groupBy({
      by: ["listType"],
      _count: { id: true },
    });
  },

  /** Find the highest sort order for a list type. */
  async findMaxSortOrder(listType: DynamicListType, tx?: DbClient) {
    const client = getClient(tx);
    return client.dynamicListItem.findFirst({
      where: { listType },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
  },

  /** Create a new list item. */
  async create(
    data: Prisma.DynamicListItemUncheckedCreateInput,
    tx?: DbClient,
  ) {
    const client = getClient(tx);
    return client.dynamicListItem.create({ data });
  },

  /** Fetch a single list item by id. */
  async findById(id: string, tx?: DbClient) {
    const client = getClient(tx);
    return client.dynamicListItem.findUnique({
      where: { id },
      select: { listType: true, value: true },
    });
  },

  /** Update a list item. */
  async update(
    id: string,
    data: Record<string, unknown>,
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.dynamicListItem.update({ where: { id }, data });
  },

  /** Delete a list item by id. */
  async delete(id: string, tx?: DbClient): Promise<void> {
    const client = getClient(tx);
    await client.dynamicListItem.delete({ where: { id } });
  },

  /** Batch-update sort orders for reordering. */
  async reorderItems(orderedIds: string[]): Promise<void> {
    await db.$transaction(
      orderedIds.map((id, index) =>
        db.dynamicListItem.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
  },

  $transaction: db.$transaction.bind(db),
};
