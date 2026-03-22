import { Suspense } from 'react';
import type { Metadata } from 'next';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import LoadingSkeleton from '@/components/LoadingSkeleton';
import SearchPageClient from './SearchPageClient';
import { searchListings } from '@/server/actions/search';
import type { SortOption } from '@/types';

export const metadata: Metadata = {
  title: 'Search Listings — KiwiMart',
  description: 'Search and filter thousands of listings from verified New Zealand sellers.',
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q : undefined;
  const category = typeof sp.category === 'string' ? sp.category : undefined;
  const subcategory = typeof sp.subcategory === 'string' ? sp.subcategory : undefined;
  const condition = typeof sp.condition === 'string' ? sp.condition : undefined;
  const region = typeof sp.region === 'string' ? sp.region : undefined;
  const priceMin = typeof sp.priceMin === 'string' && sp.priceMin ? Number(sp.priceMin) : undefined;
  const priceMax = typeof sp.priceMax === 'string' && sp.priceMax ? Number(sp.priceMax) : undefined;
  const sort = (typeof sp.sort === 'string' ? sp.sort : 'newest') as SortOption;
  const page = typeof sp.page === 'string' ? Math.max(1, parseInt(sp.page, 10) || 1) : 1;

  let initialResults;
  try {
    initialResults = await searchListings({
      query: q, category, subcategory, condition, region,
      priceMin, priceMax, sort, page, pageSize: 24,
    });
  } catch {
    initialResults = { listings: [], totalCount: 0, page: 1, pageSize: 24, totalPages: 0, hasNextPage: false };
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
          <SearchPageClient initialResults={initialResults} />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}

