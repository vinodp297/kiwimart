import { MetadataRoute } from "next";
// eslint-disable-next-line no-restricted-imports -- pre-existing page-level DB access, migrate to repository in a dedicated sprint
import db from "@/lib/db";

export const revalidate = 86400; // 24 hours

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://kiwimart.co.nz";

  const staticPages = [
    { url: baseUrl, priority: 1.0 },
    { url: `${baseUrl}/search`, priority: 0.9 },
    { url: `${baseUrl}/safety`, priority: 0.7 },
    { url: `${baseUrl}/trust`, priority: 0.7 },
    { url: `${baseUrl}/fees`, priority: 0.6 },
    { url: `${baseUrl}/about`, priority: 0.6 },
    { url: `${baseUrl}/terms`, priority: 0.5 },
    { url: `${baseUrl}/privacy`, priority: 0.5 },
  ].map((page) => ({
    ...page,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
  }));

  const [listings, sellers] = await Promise.all([
    db.listing.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      select: { id: true, updatedAt: true },
      orderBy: { watcherCount: "desc" },
      take: 1000,
    }),
    db.user.findMany({
      where: { isSellerEnabled: true, isBanned: false },
      select: { username: true, updatedAt: true },
    }),
  ]);

  const listingPages = listings.map((l) => ({
    url: `${baseUrl}/listings/${l.id}`,
    lastModified: l.updatedAt,
    changeFrequency: "daily" as const,
    priority: 0.8,
  }));

  const sellerPages = sellers.map((s) => ({
    url: `${baseUrl}/sellers/${s.username}`,
    lastModified: s.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  return [...staticPages, ...listingPages, ...sellerPages];
}
