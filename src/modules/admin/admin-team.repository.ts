// src/modules/admin/admin-team.repository.ts
// ─── Admin Team Repository — data access for admin invitation management ──────

import { getClient, type DbClient } from "@/lib/db";
import type { AdminRole } from "@prisma/client";

export const adminTeamRepository = {
  /** Upsert an admin invitation (replaces any existing pending invite for the email). */
  async upsertInvitation(
    data: {
      email: string;
      adminRole: AdminRole;
      invitedById: string;
      tokenHash: string;
      expiresAt: Date;
    },
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.adminInvitation.upsert({
      where: { email: data.email },
      create: data,
      update: {
        adminRole: data.adminRole,
        invitedById: data.invitedById,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        acceptedAt: null,
      },
    });
  },
};
