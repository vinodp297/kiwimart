import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// User repository — data access only, no business logic.
// All stubs will be filled in Phase 2 by migrating calls from:
//   - src/modules/users/user.service.ts
//   - src/server/actions/auth.ts
//   - src/server/actions/account.ts
//   - src/server/actions/seller.ts
//   - src/server/actions/listings.ts (seller check)
// ---------------------------------------------------------------------------

export type UserPublicProfile = Prisma.UserGetPayload<{
  select: {
    id: true;
    displayName: true;
    username: true;
    avatarKey: true;
    region: true;
    bio: true;
    sellerEnabled: true;
    createdAt: true;
    isBanned: true;
  };
}>;

export type UserForAuth = Prisma.UserGetPayload<{
  select: {
    id: true;
    email: true;
    emailVerified: true;
    passwordHash: true;
    isBanned: true;
    sellerEnabled: true;
    isAdmin: true;
  };
}>;

export type UserForSeller = Prisma.UserGetPayload<{
  select: {
    id: true;
    sellerEnabled: true;
    sellerTermsAcceptedAt: true;
    stripeAccountId: true;
    stripeOnboarded: true;
    idVerified: true;
    idSubmittedAt: true;
    phone: true;
  };
}>;

export const userRepository = {
  /** Find a user by ID for auth checks (email verified, banned, etc.).
   * @source src/server/actions/orders.ts, src/server/actions/listings.ts */
  async findByIdForAuth(id: string): Promise<UserForAuth | null> {
    // TODO: move from src/server/actions/orders.ts
    throw new Error("Not implemented");
  },

  /** Find a user by ID for seller operations.
   * @source src/server/actions/seller.ts, src/server/actions/listings.ts */
  async findByIdForSeller(id: string): Promise<UserForSeller | null> {
    // TODO: move from src/server/actions/seller.ts
    throw new Error("Not implemented");
  },

  /** Find a user by ID with public profile fields.
   * @source src/app/(public)/sellers/[username]/page.tsx */
  async findByIdPublic(id: string): Promise<UserPublicProfile | null> {
    // TODO: move from src/app/(public)/sellers/[username]/page.tsx
    throw new Error("Not implemented");
  },

  /** Find a user by username.
   * @source src/app/(public)/sellers/[username]/page.tsx */
  async findByUsername(username: string): Promise<UserPublicProfile | null> {
    // TODO: move from src/app/(public)/sellers/[username]/page.tsx
    throw new Error("Not implemented");
  },

  /** Find a user by email.
   * @source src/server/actions/auth.ts */
  async findByEmail(
    email: string,
  ): Promise<Prisma.UserGetPayload<{
    select: { id: true; email: true; passwordHash: true; isBanned: true };
  }> | null> {
    // TODO: move from src/server/actions/auth.ts
    throw new Error("Not implemented");
  },

  /** Update user profile fields.
   * @source src/modules/users/user.service.ts */
  async updateProfile(id: string, data: Prisma.UserUpdateInput): Promise<void> {
    // TODO: move from src/modules/users/user.service.ts
    throw new Error("Not implemented");
  },

  /** Update user password hash (used in password change).
   * @source src/modules/users/user.service.ts */
  async updatePassword(id: string, passwordHash: string): Promise<void> {
    // TODO: move from src/modules/users/user.service.ts
    throw new Error("Not implemented");
  },

  /** Clear all sessions for a user (used after password change or ban).
   * @source src/modules/users/user.service.ts, src/modules/admin/admin.service.ts */
  async deleteAllSessions(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    // TODO: move from src/modules/users/user.service.ts
    throw new Error("Not implemented");
  },

  /** Ban a user (set isBanned, bannedAt, bannedReason).
   * @source src/modules/admin/admin.service.ts */
  async ban(
    id: string,
    reason: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    // TODO: move from src/modules/admin/admin.service.ts
    throw new Error("Not implemented");
  },

  /** Unban a user.
   * @source src/modules/admin/admin.service.ts */
  async unban(id: string): Promise<void> {
    // TODO: move from src/modules/admin/admin.service.ts
    throw new Error("Not implemented");
  },

  /** Toggle sellerEnabled flag.
   * @source src/modules/admin/admin.service.ts */
  async setSellerEnabled(id: string, enabled: boolean): Promise<void> {
    // TODO: move from src/modules/admin/admin.service.ts
    throw new Error("Not implemented");
  },

  /** Record seller terms acceptance.
   * @source src/server/actions/seller.ts */
  async acceptSellerTerms(id: string, acceptedAt: Date): Promise<void> {
    // TODO: move from src/server/actions/seller.ts
    throw new Error("Not implemented");
  },

  /** Mark ID verification as submitted.
   * @source src/server/actions/seller.ts */
  async setIdSubmitted(id: string, submittedAt: Date): Promise<void> {
    // TODO: move from src/server/actions/seller.ts
    throw new Error("Not implemented");
  },

  /** Approve ID verification.
   * @source src/server/actions/seller.ts */
  async approveId(id: string, verifiedAt: Date): Promise<void> {
    // TODO: move from src/server/actions/seller.ts
    throw new Error("Not implemented");
  },

  /** Find blocked user relationship (bidirectional check).
   * @source src/modules/messaging/message.service.ts */
  async findBlock(
    userA: string,
    userB: string,
  ): Promise<Prisma.BlockedUserGetPayload<{ select: { id: true } }> | null> {
    // TODO: move from src/modules/messaging/message.service.ts
    throw new Error("Not implemented");
  },

  /** Find multiple users by IDs (for admin notifications, emails).
   * @source src/server/actions/orders.ts, src/modules/admin/admin.service.ts */
  async findManyByIds(
    ids: string[],
  ): Promise<
    Prisma.UserGetPayload<{
      select: { id: true; email: true; displayName: true };
    }>[]
  > {
    // TODO: move from src/modules/admin/admin.service.ts
    throw new Error("Not implemented");
  },

  // -------------------------------------------------------------------------
  // Phone verification
  // -------------------------------------------------------------------------

  /** Delete all existing phone verification tokens for a user.
   * @source src/modules/users/user.service.ts */
  async deletePhoneTokens(userId: string): Promise<void> {
    // TODO: move from src/modules/users/user.service.ts
    throw new Error("Not implemented");
  },

  /** Create a phone verification token.
   * @source src/modules/users/user.service.ts */
  async createPhoneToken(
    data: Prisma.PhoneVerificationTokenCreateInput,
  ): Promise<void> {
    // TODO: move from src/modules/users/user.service.ts
    throw new Error("Not implemented");
  },

  /** Find a valid (unused, unexpired) phone verification token.
   * @source src/modules/users/user.service.ts */
  async findValidPhoneToken(
    userId: string,
  ): Promise<Prisma.PhoneVerificationTokenGetPayload<{
    select: {
      id: true;
      codeHash: true;
      phone: true;
      attempts: true;
      expiresAt: true;
    };
  }> | null> {
    // TODO: move from src/modules/users/user.service.ts
    throw new Error("Not implemented");
  },

  /** Increment phone token attempt counter.
   * @source src/modules/users/user.service.ts */
  async incrementPhoneTokenAttempts(tokenId: string): Promise<void> {
    // TODO: move from src/modules/users/user.service.ts
    throw new Error("Not implemented");
  },

  /** Set user's verified phone number.
   * @source src/modules/users/user.service.ts */
  async setPhone(userId: string, encryptedPhone: string): Promise<void> {
    // TODO: move from src/modules/users/user.service.ts
    throw new Error("Not implemented");
  },
};
