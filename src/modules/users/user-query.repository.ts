// src/modules/users/user-query.repository.ts
// ─── All findXxx, existsXxx, countXxx methods for real-time flows ─────────────

import db, { getClient, type DbClient } from "@/lib/db";
import { Prisma } from "@prisma/client";

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

export const userQueryRepository = {
  async existsByEmail(email: string): Promise<boolean> {
    const found = await db.user.findUnique({
      where: { email },
      select: { id: true },
    });
    return found !== null;
  },

  async existsByUsername(username: string): Promise<boolean> {
    const found = await db.user.findUnique({
      where: { username },
      select: { id: true },
    });
    return found !== null;
  },

  async findPasswordHash(
    id: string,
  ): Promise<{ passwordHash: string | null } | null> {
    return db.user.findUnique({
      where: { id },
      select: { passwordHash: true },
    });
  },

  async findEmailVerified(
    id: string,
  ): Promise<{ emailVerified: Date | null } | null> {
    return db.user.findUnique({
      where: { id },
      select: { emailVerified: true },
    });
  },

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

  async findDisplayName(id: string): Promise<string | null> {
    const user = await db.user.findUnique({
      where: { id },
      select: { displayName: true },
    });
    return user?.displayName ?? null;
  },

  async findEmailInfo(
    id: string,
  ): Promise<{ email: string; displayName: string } | null> {
    return db.user.findUnique({
      where: { id },
      select: { email: true, displayName: true },
    });
  },

  async findDisplayInfo(
    id: string,
  ): Promise<{ displayName: string; username: string } | null> {
    return db.user.findUnique({
      where: { id },
      select: { displayName: true, username: true },
    });
  },

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

  async findForDashboard(id: string): Promise<DashboardUser | null> {
    return db.user.findUnique({
      where: { id },
      select: dashboardSelect,
    });
  },

  async findIdVerificationStatus(
    id: string,
  ): Promise<{ idVerified: boolean; idSubmittedAt: Date | null } | null> {
    return db.user.findUnique({
      where: { id },
      select: { idVerified: true, idSubmittedAt: true },
    });
  },

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

  async findManyEmailContactsByIds(
    ids: string[],
  ): Promise<{ id: string; email: string; displayName: string }[]> {
    if (ids.length === 0) return [];
    return db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true, displayName: true },
    });
  },

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

  async findIsAdminByEmail(
    email: string,
  ): Promise<{ isAdmin: boolean } | null> {
    return db.user.findUnique({
      where: { email },
      select: { isAdmin: true },
    });
  },

  async existsByNzbn(nzbn: string, excludeUserId: string): Promise<boolean> {
    const found = await db.user.findFirst({
      where: { nzbn, id: { not: excludeUserId } },
      select: { id: true },
    });
    return found !== null;
  },

  async findBasicProfile(
    id: string,
  ): Promise<{ id: string; displayName: string } | null> {
    return db.user.findUnique({
      where: { id },
      select: { id: true, displayName: true },
    });
  },

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

  async findMfaInfo(
    id: string,
  ): Promise<{ isMfaEnabled: boolean; email: string } | null> {
    return db.user.findUnique({
      where: { id },
      select: { isMfaEnabled: true, email: true },
    });
  },

  async findImageKeys(id: string): Promise<{
    avatarKey: string | null;
    coverImageKey: string | null;
  } | null> {
    return db.user.findUnique({
      where: { id },
      select: { avatarKey: true, coverImageKey: true },
    });
  },

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

  async findStripeStatus(id: string): Promise<{
    stripeAccountId: string | null;
    isStripeOnboarded: boolean;
  } | null> {
    return db.user.findUnique({
      where: { id },
      select: { stripeAccountId: true, isStripeOnboarded: true },
    });
  },

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

  async findVerificationDocStatus(
    id: string,
  ): Promise<{ idVerified: boolean; isSellerEnabled: boolean } | null> {
    return db.user.findUnique({
      where: { id },
      select: { idVerified: true, isSellerEnabled: true },
    });
  },

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

  async findSellerForPayout(id: string): Promise<{
    sellerTierOverride: string | null;
    email: string;
    displayName: string | null;
  } | null> {
    return db.user.findUnique({
      where: { id },
      select: {
        sellerTierOverride: true,
        email: true,
        displayName: true,
      },
    });
  },

  async findPhone(id: string): Promise<{ phone: string | null } | null> {
    return db.user.findUnique({
      where: { id },
      select: { phone: true },
    });
  },

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

  async countActive(): Promise<number> {
    return db.user.count({ where: { deletedAt: null } });
  },

  async findBusinessInfo(
    id: string,
  ): Promise<{ nzbn: string | null; isGstRegistered: boolean } | null> {
    return db.user.findUnique({
      where: { id },
      select: { nzbn: true, isGstRegistered: true },
    });
  },

  async findForSettings(id: string): Promise<{
    displayName: string;
    username: string;
    email: string;
    emailVerified: Date | null;
    region: string | null;
    bio: string | null;
    hasMarketingConsent: boolean;
  } | null> {
    return db.user.findUnique({
      where: { id },
      select: {
        displayName: true,
        username: true,
        email: true,
        emailVerified: true,
        region: true,
        bio: true,
        hasMarketingConsent: true,
      },
    });
  },

  async findBlockedUsers(blockerId: string) {
    return db.blockedUser.findMany({
      where: { blockerId },
      include: {
        blocked: { select: { id: true, displayName: true, username: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async findForSellerHub(id: string) {
    return db.user.findUnique({
      where: { id },
      select: {
        id: true,
        displayName: true,
        email: true,
        isSellerEnabled: true,
        sellerTermsAcceptedAt: true,
        isPhoneVerified: true,
        idVerified: true,
        idVerifiedAt: true,
        idSubmittedAt: true,
        isStripeOnboarded: true,
        nzbn: true,
        isGstRegistered: true,
        gstNumber: true,
        verificationApplication: {
          select: {
            status: true,
            documentType: true,
            adminNotes: true,
            appliedAt: true,
          },
        },
      },
    });
  },

  async findForMessageRecipient(id: string): Promise<{
    id: string;
    displayName: string;
    username: string;
    avatarKey: string | null;
  } | null> {
    return db.user.findFirst({
      where: { id, deletedAt: null, isBanned: false },
      select: { id: true, displayName: true, username: true, avatarKey: true },
    });
  },

  async findPublicSellerPageData(username: string) {
    return db.user.findFirst({
      where: { username, deletedAt: null, isBanned: false },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarKey: true,
        coverImageKey: true,
        bio: true,
        region: true,
        suburb: true,
        idVerified: true,
        isVerifiedSeller: true,
        avgResponseTimeMinutes: true,
        responseRate: true,
        createdAt: true,
        _count: {
          select: {
            sellerOrders: { where: { status: "COMPLETED" } },
            listings: { where: { status: "ACTIVE", deletedAt: null } },
            reviewsAbout: {
              where: { isApproved: true, reviewerRole: "BUYER" },
            },
          },
        },
        reviewsAbout: {
          where: { isApproved: true, reviewerRole: "BUYER" },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            orderId: true,
            rating: true,
            comment: true,
            createdAt: true,
            reply: true,
            author: {
              select: { displayName: true, username: true, avatarKey: true },
            },
            order: { select: { listing: { select: { title: true } } } },
            tags: { select: { tag: true } },
          },
        },
      },
    });
  },

  async findBlockStatus(
    blockerId: string,
    blockedId: string,
  ): Promise<boolean> {
    const block = await db.blockedUser.findFirst({
      where: { blockerId, blockedId },
      select: { id: true },
    });
    return block !== null;
  },

  async findEmailById(id: string): Promise<{ email: string } | null> {
    return db.user.findUnique({
      where: { id },
      select: { email: true },
    });
  },

  async findIsMfaEnabled(userId: string): Promise<boolean> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { isMfaEnabled: true },
    });
    return user?.isMfaEnabled ?? false;
  },

  async findMfaBackupCodes(
    userId: string,
  ): Promise<{ mfaBackupCodes: string | null } | null> {
    return db.user.findUnique({
      where: { id: userId },
      select: { mfaBackupCodes: true },
    });
  },

  async findForMfaVerify(
    userId: string,
  ): Promise<{ mfaSecret: string | null; email: string } | null> {
    return db.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, email: true },
    });
  },

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
};
