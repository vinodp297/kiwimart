import { Suspense } from "react";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import LoadingSkeleton from "@/components/LoadingSkeleton";
import SearchPageClient from "./SearchPageClient";
import { searchListings } from "@/server/actions/search";
import { getRegionsWithCoords } from "@/lib/dynamic-lists";
import CATEGORIES from "@/data/categories";
import type { SortOption } from "@/types";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Search Listings",
  description:
    "Search and filter thousands of listings from verified New Zealand sellers.",
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  // ── Input sanitisation ────────────────────────────────────────────────────
  // React JSX automatically escapes values in attributes and text content, so
  // neither `q` nor `category` can inject HTML when rendered.  These guards
  // are a defence-in-depth measure: they prevent excessively long values from
  // reaching the database layer and restrict `category` to known IDs so that
  // arbitrary strings are never reflected into SQL WHERE clauses.
  //
  // ZAP flags /search?q=… and /search?category=… as potential XSS vectors.
  // Those findings are false positives — React escapes all JSX attribute
  // values automatically — but the validation below eliminates the
  // theoretical risk at the input boundary regardless.

  // Limit search query to 200 characters to prevent excessively long DB queries.
  const rawQ = typeof sp.q === "string" ? sp.q : undefined;
  const q = rawQ?.slice(0, 200) || undefined;

  // Validate category against the known allowlist derived from CATEGORIES data.
  // An unrecognised category is silently dropped rather than passed to the DB.
  const ALLOWED_CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));
  const rawCategory = typeof sp.category === "string" ? sp.category : undefined;
  const category =
    rawCategory && ALLOWED_CATEGORY_IDS.has(rawCategory)
      ? rawCategory
      : undefined;
  const subcategory =
    typeof sp.subcategory === "string" ? sp.subcategory : undefined;
  const condition = typeof sp.condition === "string" ? sp.condition : undefined;
  const region = typeof sp.region === "string" ? sp.region : undefined;
  const priceMin =
    typeof sp.priceMin === "string" && sp.priceMin
      ? Number(sp.priceMin)
      : undefined;
  const priceMax =
    typeof sp.priceMax === "string" && sp.priceMax
      ? Number(sp.priceMax)
      : undefined;
  const sort = (typeof sp.sort === "string" ? sp.sort : "newest") as SortOption;
  const page =
    typeof sp.page === "string" ? Math.max(1, parseInt(sp.page, 10) || 1) : 1;
  // Quick-filter chips
  const isUrgent = sp.isUrgent === "true";
  const isNegotiable = sp.isNegotiable === "true";
  const shipsNationwide = sp.shipsNationwide === "true";
  const verifiedOnly = sp.verifiedOnly === "true";
  const radiusKm =
    typeof sp.radiusKm === "string" && sp.radiusKm
      ? Number(sp.radiusKm)
      : undefined;

  // Resolve region to lat/lng for radius search
  const regions = await getRegionsWithCoords();
  const regionCenter = region
    ? regions.find((r) => r.value === region)
    : undefined;
  const searchLat = regionCenter?.lat;
  const searchLng = regionCenter?.lng;

  let initialResults;
  try {
    initialResults = await searchListings({
      query: q,
      category,
      subcategory,
      condition,
      region,
      priceMin,
      priceMax,
      sort,
      page,
      pageSize: 24,
      isUrgent: isUrgent || undefined,
      isNegotiable: isNegotiable || undefined,
      shipsNationwide: shipsNationwide || undefined,
      verifiedOnly: verifiedOnly || undefined,
      searchLat: radiusKm ? searchLat : undefined,
      searchLng: radiusKm ? searchLng : undefined,
      radiusKm: radiusKm || undefined,
    });
  } catch {
    initialResults = {
      listings: [],
      totalCount: 0,
      page: 1,
      pageSize: 24,
      totalPages: 0,
      hasNextPage: false,
    };
  }

  return (
    <>
      <NavBar />
      <main className="min-h-[70vh] bg-[#FAFAF8]">
        <Suspense
          fallback={
            <div className="max-w-7xl mx-auto px-6 py-10">
              <LoadingSkeleton count={12} />
            </div>
          }
        >
          <SearchPageClient
            initialResults={initialResults}
            regionNames={regions.map((r) => r.value)}
          />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}
