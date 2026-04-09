import db, { getClient, type DbClient } from "@/lib/db";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// User repository — data access only, no business logic.
// Every db.user.* call from the 7 server action files is migrated here.
// ---------------------------------------------------------------------------

// ── Select-shape types ─────────────────────────────────────────────────────

const dashboardSelect = {
  id: true,
  displayName: true,
  email: true,
  username: true,
  avatarKey: true,
  createdAt: true,
  isSellerEnabled: true,
  idVerified: true,
  isPhoneVerified: true,
  emailVerified: true,
  region: true,
  bio: true,
  onboardingIntent: true,
  isOnboardingCompleted: true,
  isStripeOnboarded: true,
  sellerTermsAcceptedAt: true,
} as const;

export type DashboardUser = Prisma.UserGetPayload<{
  select: typeof dashboardSelect;
}>;

export type UserPublicProfile = Prisma.UserGetPayload<{
  select: {
    id: true;
    displayName: true;
    username: true;
    avatarKey: true;
    region: true;
    bio: true;
    isSellerEnabled: true;
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
    isSellerEnabled: true;
    isAdmin: true;
  };
}>;

export type UserForSeller = Prisma.UserGetPayload<{
  select: {
    id: true;
    isSellerEnabled: true;
    sellerTermsAcceptedAt: true;
    stripeAccountId: true;
    isStripeOnboarded: true;
    idVerified: true;
    idSubmittedAt: true;
    phone: true;
  };
}>;

// ── Repository ─────────────────────────────────────────────────────────────

export const userRepository = {
  // -------------------------------------------------------------------------
  // Existence checks (registration)
  // -------------------------------------------------------------------------

  /** Check if an email is already registered. */
  async existsByEmail(email: string): Promise<boolean> {
    const found = await db.user.findUnique({
      where: { email },
      select: { id: true },
    });
    return found !== null;
  },

  /** Check if a username is already taken. */
  async existsByUsername(username: string): Promise<boolean> {
    const found = await db.user.findUnique({
      where: { username },
      select: { id: true },
    });
    return found !== null;
  },

  // -------------------------------------------------------------------------
  // Single-user finders (by id)
  // -------------------------------------------------------------------------

  /** Fetch password hash for verification. */
  async findPasswordHash(
    id: string,
  ): Promise<{ passwordHash: string | null } | null> {
    return db.user.findUnique({
      where: { id },
      select: { passwordHash: true },
    });
  },

  /** Fetch emailVerified flag only (lightweight check). */
  async findEmailVerified(
    id: string,
  ): Promise<{ emailVerified: Date | null } | null> {
    return db.user.findUnique({
      where: { id },
      select: { emailVerified: true },
    });
  },

  /** Fetch fields needed before creating a listing. */
  async findForListingAuth(id: string): Promise<{
    emailVerified: Date | null;
    isSellerEnabled: boolean;
    sellerTermsAcceptedAt: Date | null;
    displayName: string;
  } | null> {
    return db.user.findUnique({
      where: { id },
      select: {
        emailVerified: true,
        isSellerEnabled: true,
        sellerTermsAcceptedAt: true,
        displayName: true,
      },
    });
  },

  /** Fetch seller profile for auto-review engine. */
  async findForAutoReview(id: string): Promise<{
    id: string;
    isBanned: boolean;
    isPhoneVerified: boolean;
    idVerified: boolean;
    displayName: string;
  } | null> {
    return db.user.findUnique({
      where: { id },
      select: {
        id: true,
        isBanned: true,
        isPhoneVerified: true,
        idVerified: true,
        displayName: true,
      },
    });
  },

  /** Fetch display name only (for admin notifications in listings). */
  async findDisplayName(id: string): Promise<string | null> {
    const user = await db.user.findUnique({
      where: { id },
      select: { displayName: true },
    });
    return user?.displayName ?? null;
  },

  /** Fetch email + displayName (for notification/email flows). */
  async findEmailInfo(
    id: string,
  ): Promise<{ email: string; displayName: string } | null> {
    return db.user.findUnique({
      where: { id },
      select: { email: true, displayName: true },
    });
  },

  /** Fetch display info for cart/checkout UI. */
  async findDisplayInfo(
    id: string,
  ): Promise<{ displayName: string; username: string } | null> {
    return db.user.findUnique({
      where: { id },
      select: { displayName: true, username: true },
    });
  },

  /** Fetch Stripe info for a seller (checkout/payment flows). */
  async findWithStripe(id: string): Promise<{
    stripeAccountId: string | null;
    isStripeOnboarded: boolean;
    displayName: string;
    email: string;
  } | null> {
    return db.user.findUnique({
      where: { id },
      select: {
        stripeAccountId: true,
        isStripeOnboarded: true,
        displayName: true,
        email: true,
      },
    });
  },

  /** Fetch dashboard profile data (buyer or seller dashboard). */
  async findForDashboard(id: string): Promise<DashboardUser | null> {
    return db.user.findUnique({
      where: { id },
      select: dashboardSelect,
    });
  },

  /** Fetch ID verification status. */
  async findIdVerificationStatus(
    id: string,
  ): Promise<{ idVerified: boolean; idSubmittedAt: Date | null } | null> {
    return db.user.findUnique({
      where: { id },
      select: { idVerified: true, idSubmittedAt: true },
    });
  },

  /** Fetch fields needed for admin ID approval/rejection. */
  async findForIdApproval(id: string): Promise<{
    id: string;
    email: string;
    idVerified: boolean;
    idSubmittedAt: Date | null;
  } | null> {
    return db.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        idVerified: true,
        idSubmittedAt: true,
      },
    });
  },

  // -------------------------------------------------------------------------
  // Single-user finders (by email)
  // -------------------------------------------------------------------------

  /** Fetch a user by email with profile fields (forgot password, login). */
  async findByEmail(email: string): Promise<{
    id: string;
    email: string;
    displayName: string;
  } | null> {
    return db.user.findUnique({
      where: { email },
      select: { id: true, email: true, displayName: true },
    });
  },

  /** Fetch for resend-verification flow (needs emailVerified + profile). */
  async findForEmailVerification(id: string): Promise<{
    id: string;
    email: string;
    displayName: string;
    emailVerified: Date | null;
  } | null> {
    return db.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        displayName: true,
        emailVerified: true,
      },
    });
  },

  // -------------------------------------------------------------------------
  // Multi-user finders
  // -------------------------------------------------------------------------

  /** Find admin/trust-safety users for notifications. */
  async findAdmins(roles?: string[]): Promise<{ id: string }[]> {
    return db.user.findMany({
      where: {
        isAdmin: true,
        isBanned: false,
        ...(roles
          ? {
              adminRole: {
                in: roles as Prisma.EnumAdminRoleFilter<"User">["in"],
              },
            }
          : {}),
      },
      select: { id: true },
    });
  },

  /** Find email contacts for many users (bulk email recipients). */
  async findManyEmailContactsByIds(
    ids: string[],
  ): Promise<{ id: string; email: string; displayName: string }[]> {
    if (ids.length === 0) return [];
    return db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true, displayName: true },
    });
  },

  /** Find many users by IDs (thread participant lookup, email batches). */
  async findManyByIds(ids: string[]): Promise<
    {
      id: string;
      displayName: string;
      username: string;
      avatarKey: string | null;
    }[]
  > {
    if (ids.length === 0) return [];
    return db.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        displayName: true,
        username: true,
        avatarKey: true,
      },
    });
  },

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  /** Create a new user (registration). */
  async create(
    data: Prisma.UserCreateInput,
  ): Promise<{ id: string; email: string; displayName: string }> {
    return db.user.create({
      data,
      select: { id: true, email: true, displayName: true },
    });
  },

  /** Generic update — accepts any UserUpdateInput.
   * Pass `tx` when called inside a transaction. */
  async update(
    id: string,
    data: Prisma.UserUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.user.update({ where: { id }, data });
  },

  /** Clear all sessions for a user (password change, ban, delete account). */
  async deleteAllSessions(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.session.deleteMany({ where: { userId } });
  },

  /** Set ban state for a user (single method for ban + unban).
   * When isBanned=true, sets bannedAt=now and bannedReason=reason.
   * When isBanned=false, clears bannedAt + bannedReason. */
  async setBanState(
    id: string,
    isBanned: boolean,
    reason: string | null,
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.user.update({
      where: { id },
      data: isBanned
        ? { isBanned: true, bannedAt: new Date(), bannedReason: reason }
        : { isBanned: false, bannedAt: null, bannedReason: null },
    });
  },

  /** Fetch the current isSellerEnabled flag. */
  async findSellerEnabled(
    id: string,
    tx?: DbClient,
  ): Promise<{ isSellerEnabled: boolean } | null> {
    const client = getClient(tx);
    return client.user.findUnique({
      where: { id },
      select: { isSellerEnabled: true },
    });
  },

  /** Set the isSellerEnabled flag. */
  async setSellerEnabled(
    id: string,
    value: boolean,
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.user.update({
      where: { id },
      data: { isSellerEnabled: value },
    });
  },

  // -------------------------------------------------------------------------
  // Additional finders (batch 3b — remaining server action files)
  // -------------------------------------------------------------------------

  /** Check if a user with this email is already an admin. */
  async findIsAdminByEmail(
    email: string,
  ): Promise<{ isAdmin: boolean } | null> {
    return db.user.findUnique({
      where: { email },
      select: { isAdmin: true },
    });
  },

  /** Check if an NZBN is already registered to another user. */
  async existsByNzbn(nzbn: string, excludeUserId: string): Promise<boolean> {
    const found = await db.user.findFirst({
      where: { nzbn, id: { not: excludeUserId } },
      select: { id: true },
    });
    return found !== null;
  },

  /** Fetch minimal profile (id + displayName) for block/unblock flows. */
  async findBasicProfile(
    id: string,
  ): Promise<{ id: string; displayName: string } | null> {
    return db.user.findUnique({
      where: { id },
      select: { id: true, displayName: true },
    });
  },

  /** Fetch onboarding status fields. */
  async findOnboardingStatus(id: string): Promise<{
    isOnboardingCompleted: boolean;
    onboardingIntent: string | null;
    region: string | null;
    bio: string | null;
    displayName: string;
    emailVerified: Date | null;
    isStripeOnboarded: boolean;
  } | null> {
    return db.user.findUnique({
      where: { id },
      select: {
        isOnboardingCompleted: true,
        onboardingIntent: true,
        region: true,
        bio: true,
        displayName: true,
        emailVerified: true,
        isStripeOnboarded: true,
      },
    });
  },

  /** Fetch MFA-related fields (enabled status + email for QR code). */
  async findMfaInfo(
    id: string,
  ): Promise<{ isMfaEnabled: boolean; email: string } | null> {
    return db.user.findUnique({
      where: { id },
      select: { isMfaEnabled: true, email: true },
    });
  },

  /** Fetch profile image keys for cleanup on upload. */
  async findImageKeys(id: string): Promise<{
    avatarKey: string | null;
    coverImageKey: string | null;
  } | null> {
    return db.user.findUnique({
      where: { id },
      select: { avatarKey: true, coverImageKey: true },
    });
  },

  /** Admin support lookup — search by email/username/displayName. */
  async findForSupport(query: string) {
    return db.user.findFirst({
      where: {
        OR: [
          { email: { contains: query, mode: "insensitive" as const } },
          { username: { contains: query, mode: "insensitive" as const } },
          { displayName: { contains: query, mode: "insensitive" as const } },
        ],
      },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        emailVerified: true,
        isPhoneVerified: true,
        idVerified: true,
        isSellerEnabled: true,
        isStripeOnboarded: true,
        isBanned: true,
        createdAt: true,
        region: true,
        _count: {
          select: {
            listings: true,
            buyerOrders: true,
            sellerOrders: true,
          },
        },
      },
    });
  },

  /** Fetch Stripe Connect account info for onboarding. */
  async findForStripeConnect(id: string): Promise<{
    id: string;
    stripeAccountId: string | null;
    isStripeOnboarded: boolean;
    isSellerEnabled: boolean;
    email: string;
    displayName: string;
  } | null> {
    return db.user.findUnique({
      where: { id },
      select: {
        id: true,
        stripeAccountId: true,
        isStripeOnboarded: true,
        isSellerEnabled: true,
        email: true,
        displayName: true,
      },
    });
  },

  /** Fetch Stripe onboarding status only. */
  async findStripeStatus(id: string): Promise<{
    stripeAccountId: string | null;
    isStripeOnboarded: boolean;
  } | null> {
    return db.user.findUnique({
      where: { id },
      select: { stripeAccountId: true, isStripeOnboarded: true },
    });
  },

  /** Fetch fields needed to check verification application eligibility. */
  async findForVerificationApplication(id: string) {
    return db.user.findUnique({
      where: { id },
      select: {
        isVerifiedSeller: true,
        phone: true,
        verificationApplication: { select: { status: true } },
        _count: {
          select: {
            sellerOrders: { where: { status: "COMPLETED" } },
            reviewsAbout: {
              where: { reviewerRole: "BUYER", isApproved: true },
            },
          },
        },
      },
    });
  },

  /** Fetch ID verification + seller status for document submission. */
  async findVerificationDocStatus(
    id: string,
  ): Promise<{ idVerified: boolean; isSellerEnabled: boolean } | null> {
    return db.user.findUnique({
      where: { id },
      select: { idVerified: true, isSellerEnabled: true },
    });
  },

  /** Fetch fields for admin seller tier override. */
  async findForTierOverride(id: string): Promise<{
    id: string;
    sellerTierOverride: string | null;
    displayName: string;
  } | null> {
    return db.user.findUnique({
      where: { id },
      select: { id: true, sellerTierOverride: true, displayName: true },
    });
  },

  // -------------------------------------------------------------------------
  // User service helpers (phone verification + transactions)
  // -------------------------------------------------------------------------

  /** Fetch phone field only. */
  async findPhone(id: string): Promise<{ phone: string | null } | null> {
    return db.user.findUnique({
      where: { id },
      select: { phone: true },
    });
  },

  /** Delete all phone verification tokens for a user. */
  async deletePhoneTokens(userId: string, tx?: DbClient): Promise<void> {
    const client = getClient(tx);
    await client.phoneVerificationToken.deleteMany({ where: { userId } });
  },

  /** Create a phone verification token. */
  async createPhoneToken(
    data: {
      userId: string;
      codeHash: string;
      phone: string;
      expiresAt: Date;
    },
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.phoneVerificationToken.create({ data });
  },

  /** Find the latest valid (unused, non-expired) phone verification token. */
  async findActivePhoneToken(
    userId: string,
    tx?: DbClient,
  ): Promise<{
    id: string;
    codeHash: string;
    phone: string;
    attempts: number;
  } | null> {
    const client = getClient(tx);
    return client.phoneVerificationToken.findFirst({
      where: {
        userId,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  /** Increment the attempt counter on a phone verification token. */
  async incrementPhoneTokenAttempts(
    tokenId: string,
    tx?: DbClient,
  ): Promise<void> {
    const client = getClient(tx);
    await client.phoneVerificationToken.update({
      where: { id: tokenId },
      data: { attempts: { increment: 1 } },
    });
  },

  /** Mark a phone verification token as used. */
  async markPhoneTokenUsed(tokenId: string, tx?: DbClient): Promise<void> {
    const client = getClient(tx);
    await client.phoneVerificationToken.update({
      where: { id: tokenId },
      data: { usedAt: new Date() },
    });
  },

  // ── Stripe Connect helpers ────────────────────────────────────────────────

  /** Update Stripe onboarding fields for a user identified by their Stripe account ID. */
  async updateByStripeAccountId(
    stripeAccountId: string,
    data: Prisma.UserUpdateInput,
  ): Promise<void> {
    await db.user.updateMany({ where: { stripeAccountId }, data });
  },

  // ── Erasure helpers ──────────────────────────────────────────────────────

  // findEmailAndDisplayName — consolidated into findEmailInfo (identical select)

  // ── Password-reset token helpers ─────────────────────────────────────────

  /** Invalidate all unused password-reset tokens for a user (prevents token reuse). */
  async invalidatePendingResetTokens(userId: string): Promise<void> {
    await db.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
  },

  /** Create a new password-reset token record. */
  async createResetToken(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    requestIp: string | null;
    userAgent: string | null;
  }): Promise<void> {
    await db.passwordResetToken.create({ data });
  },

  /** Fetch a password-reset token with its associated user (for reset validation). */
  async findResetTokenWithUser(tokenHash: string): Promise<{
    id: string;
    userId: string;
    usedAt: Date | null;
    expiresAt: Date;
    user: { id: string; email: string; displayName: string | null };
  } | null> {
    return db.passwordResetToken.findUnique({
      where: { tokenHash },
      include: {
        user: { select: { id: true, email: true, displayName: true } },
      },
    });
  },

  // ── MFA helpers ───────────────────────────────────────────────────────────

  /** Store encrypted MFA secret and backup codes during setup (MFA not yet enabled). */
  async storeMfaSetup(
    userId: string,
    data: { mfaSecret: string; mfaBackupCodes: string },
  ): Promise<void> {
    await db.user.update({
      where: { id: userId },
      data: { ...data, isMfaEnabled: false },
    });
  },

  /** Fetch MFA secret and email for TOTP verification during setup or disable. */
  async findForMfaVerify(
    userId: string,
  ): Promise<{ mfaSecret: string | null; email: string } | null> {
    return db.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, email: true },
    });
  },

  /** Enable MFA after successful TOTP verification. */
  async enableMfa(userId: string): Promise<void> {
    await db.user.update({
      where: { id: userId },
      data: { isMfaEnabled: true },
    });
  },

  /** Fetch MFA fields needed to verify a login attempt. */
  async findForMfaLogin(userId: string): Promise<{
    mfaSecret: string | null;
    mfaBackupCodes: string | null;
    email: string;
  } | null> {
    return db.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaBackupCodes: true, email: true },
    });
  },

  /** Persist updated backup codes after one has been consumed during login. */
  async updateMfaBackupCodes(
    userId: string,
    encryptedCodes: string,
  ): Promise<void> {
    await db.user.update({
      where: { id: userId },
      data: { mfaBackupCodes: encryptedCodes },
    });
  },

  /** Clear all MFA fields when MFA is disabled. */
  async clearMfa(userId: string): Promise<void> {
    await db.user.update({
      where: { id: userId },
      data: { mfaSecret: null, isMfaEnabled: false, mfaBackupCodes: null },
    });
  },

  /** Check whether MFA is enabled for a user. */
  async findIsMfaEnabled(userId: string): Promise<boolean> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { isMfaEnabled: true },
    });
    return user?.isMfaEnabled ?? false;
  },

  /** Fetch encrypted backup codes to count remaining uses. */
  async findMfaBackupCodes(
    userId: string,
  ): Promise<{ mfaBackupCodes: string | null } | null> {
    return db.user.findUnique({
      where: { id: userId },
      select: { mfaBackupCodes: true },
    });
  },

  /** Upsert a block relationship (idempotent). */
  async upsertBlock(blockerId: string, blockedId: string): Promise<void> {
    await db.blockedUser.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {},
    });
  },

  /** Remove a block relationship. */
  async removeBlock(blockerId: string, blockedId: string): Promise<void> {
    await db.blockedUser.deleteMany({
      where: { blockerId, blockedId },
    });
  },

  /** Run an array of operations inside a transaction. */
  async transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return db.$transaction(fn);
  },

  // ── API route helpers ────────────────────────────────────────────────────

  /** Fetch fields for requireApiUser() — session cookie or Bearer token path. */
  async findForApiAuth(id: string): Promise<{
    id: string;
    email: string;
    isAdmin: boolean;
    isBanned: boolean;
    isSellerEnabled: boolean;
    isStripeOnboarded: boolean;
  } | null> {
    return db.user.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        email: true,
        isAdmin: true,
        isBanned: true,
        isSellerEnabled: true,
        isStripeOnboarded: true,
      },
    });
  },

  /** Fetch fields for mobile token authentication. */
  async findForMobileAuth(email: string): Promise<{
    id: string;
    email: string;
    passwordHash: string | null;
    isAdmin: boolean;
    isBanned: boolean;
    displayName: string;
  } | null> {
    return db.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        isAdmin: true,
        isBanned: true,
        displayName: true,
      },
    });
  },

  /** Look up a user by their email verification token (not expired). */
  async findByVerificationToken(token: string): Promise<{
    id: string;
    email: string;
    displayName: string;
    emailVerified: Date | null;
  } | null> {
    return db.user.findFirst({
      where: {
        emailVerifyToken: token,
        emailVerifyExpires: { gt: new Date() },
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        emailVerified: true,
      },
    });
  },

  /** Mark email as verified and clear the token. */
  async markEmailVerified(id: string): Promise<void> {
    await db.user.update({
      where: { id },
      data: {
        emailVerified: new Date(),
        emailVerifyToken: null,
        emailVerifyExpires: null,
      },
    });
  },

  /** Fetch navbar summary fields. */
  async findForNavSummary(id: string): Promise<{
    id: string;
    displayName: string;
    email: string;
    avatarKey: string | null;
    isAdmin: boolean;
    isSellerEnabled: boolean;
    isMfaEnabled: boolean;
  } | null> {
    return db.user.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        displayName: true,
        email: true,
        avatarKey: true,
        isAdmin: true,
        isSellerEnabled: true,
        isMfaEnabled: true,
      },
    });
  },

  /** Fetch full API profile for /api/v1/users/me. */
  async findForApiProfile(id: string): Promise<{
    id: string;
    username: string;
    displayName: string;
    email: string;
    avatarKey: string | null;
    region: string | null;
    bio: string | null;
    isSellerEnabled: boolean;
    isStripeOnboarded: boolean;
    idVerified: boolean;
    isPhoneVerified: boolean;
    createdAt: Date;
  } | null> {
    return db.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        avatarKey: true,
        region: true,
        bio: true,
        isSellerEnabled: true,
        isStripeOnboarded: true,
        idVerified: true,
        isPhoneVerified: true,
        createdAt: true,
      },
    });
  },
};
