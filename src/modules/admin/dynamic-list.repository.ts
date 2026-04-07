// src/modules/admin/dynamic-list.repository.ts
// ─── Dynamic List Repository — data access for admin-managed dynamic lists ────

import db from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { DynamicListType } from "@prisma/client";

type DbClient = Prisma.TransactionClient | typeof db;

export const dynamicListRepository = {
  /** Fetch all items for a list type, ordered by sortOrder.
   * @source src/server/actions/admin-lists.ts — getListItems */
  async findByType(listType: DynamicListType, tx?: DbClient) {
    const client = tx ?? db;
    return client.dynamicListItem.findMany({
      where: { listType },
      orderBy: { sortOrder: "asc" },
      include: {
        updater: { select: { displayName: true } },
      },
    });
  },

  /** Count items by list type for the admin sidebar.
   * @source src/server/actions/admin-lists.ts — getListTypeCounts */
  async countByType(tx?: DbClient) {
    const client = tx ?? db;
    return client.dynamicListItem.groupBy({
      by: ["listType"],
      _count: { id: true },
    });
  },

  /** Find the highest sort order for a list type.
   * @source src/server/actions/admin-lists.ts — createListItem */
  async findMaxSortOrder(listType: DynamicListType, tx?: DbClient) {
    const client = tx ?? db;
    return client.dynamicListItem.findFirst({
      where: { listType },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
  },

  /** Create a new list item.
   * @source src/server/actions/admin-lists.ts — createListItem */
  async create(
    data: Prisma.DynamicListItemUncheckedCreateInput,
    tx?: DbClient,
  ) {
    const client = tx ?? db;
    return client.dynamicListItem.create({ data });
  },

  /** Fetch a single list item by id.
   * @source src/server/actions/admin-lists.ts — updateListItem, deleteListItem */
  async findById(id: string, tx?: DbClient) {
    const client = tx ?? db;
    return client.dynamicListItem.findUnique({
      where: { id },
      select: { listType: true, value: true },
    });
  },

  /** Update a list item.
   * @source src/server/actions/admin-lists.ts — updateListItem */
  async update(
    id: string,
    data: Record<string, unknown>,
    tx?: DbClient,
  ): Promise<void> {
    const client = tx ?? db;
    await client.dynamicListItem.update({ where: { id }, data });
  },

  /** Delete a list item by id.
   * @source src/server/actions/admin-lists.ts — deleteListItem */
  async delete(id: string, tx?: DbClient): Promise<void> {
    const client = tx ?? db;
    await client.dynamicListItem.delete({ where: { id } });
  },

  /** Batch-update sort orders for reordering.
   * @source src/server/actions/admin-lists.ts — reorderListItems */
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
