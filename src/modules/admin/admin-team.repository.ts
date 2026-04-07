// src/modules/admin/admin-team.repository.ts
// ─── Admin Team Repository — data access for admin invitation management ──────

import db from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { AdminRole } from "@prisma/client";

type DbClient = Prisma.TransactionClient | typeof db;

export const adminTeamRepository = {
  /** Upsert an admin invitation (replaces any existing pending invite for the email).
   * @source src/server/actions/adminTeam.ts — inviteAdmin */
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
    const client = tx ?? db;
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
