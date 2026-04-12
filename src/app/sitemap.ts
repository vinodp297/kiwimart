import { MetadataRoute } from "next";
import {
  getSitemapListings,
  getSitemapSellers,
} from "@/modules/listings/listing.repository";

export const revalidate = 86400; // 24 hours

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://buyzi.co.nz";

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
    getSitemapListings(),
    getSitemapSellers(),
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
