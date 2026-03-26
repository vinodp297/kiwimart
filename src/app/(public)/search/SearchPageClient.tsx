'use client';

import { useCallback, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import CATEGORIES from '@/data/categories';
import ListingCard from '@/components/ListingCard';
import EmptyState from '@/components/EmptyState';
import QuickFilterChips from '@/components/QuickFilterChips';
import type { Condition, NZRegion, SortOption, SearchFilters, ListingCard as ListingCardType } from '@/types';
import { CONDITION_LABELS } from '@/lib/utils';
import Link from 'next/link';
import type { SearchResult } from '@/server/actions/search';

// ── Constants ─────────────────────────────────────────────────────────────────
const CONDITIONS: { value: Condition; label: string }[] = [
  { value: 'new', label: 'Brand New' },
  { value: 'like-new', label: 'Like New' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'parts', label: 'Parts Only' },
];

const NZ_REGIONS: NZRegion[] = [
  'Auckland', 'Wellington', 'Canterbury', 'Waikato', 'Bay of Plenty',
  'Otago', 'Hawke\'s Bay', 'Manawatū-Whanganui', 'Northland', 'Tasman',
  'Nelson', 'Marlborough', 'Southland', 'Taranaki', 'Gisborne', 'West Coast',
];

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'price-asc', label: 'Price: low → high' },
  { value: 'price-desc', label: 'Price: high → low' },
  { value: 'most-watched', label: 'Most watched' },
];

// ── Select helper ─────────────────────────────────────────────────────────────
function FilterSelect({
  label,
  value,
  onChange,
  children,
  className = '',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <label className="sr-only">{label}</label>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 pl-3 pr-8 rounded-lg border border-[#C9C5BC]
          bg-white text-[12.5px] text-[#141414] font-medium
          appearance-none cursor-pointer outline-none
          focus:border-[#D4A843] focus:ring-2 focus:ring-[#D4A843]/20
          transition hover:border-[#9E9A91]
          [background-image:url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%226%22%3E%3Cpath d=%22M1 1l4 4 4-4%22 stroke=%22%239E9A91%22 stroke-width=%221.5%22 fill=%22none%22 stroke-linecap=%22round%22/%3E%3C/svg%3E')]
          [background-repeat:no-repeat] [background-position:right_10px_center]"
      >
        {children}
      </select>
    </div>
  );
}

// ── Price input ───────────────────────────────────────────────────────────────
function PriceInput({
  label,
  name,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <label className="sr-only">{label}</label>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-[#9E9A91] font-medium pointer-events-none">
        $
      </span>
      <input
        type="number"
        name={name}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        min={0}
        className="w-full h-9 pl-6 pr-3 rounded-lg border border-[#C9C5BC]
          bg-white text-[12.5px] text-[#141414] placeholder:text-[#C9C5BC]
          outline-none focus:border-[#D4A843] focus:ring-2 focus:ring-[#D4A843]/20
          transition [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none
          [&::-webkit-inner-spin-button]:appearance-none"
      />
    </div>
  );
}

// ── Active filter pill ────────────────────────────────────────────────────────
function FilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full
        bg-[#141414] text-white text-[11.5px] font-medium"
    >
      {label}
      <button
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        className="hover:text-[#D4A843] transition-colors"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function SearchPageClient({
  initialResults,
}: {
  initialResults: SearchResult;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // ── Read filters from URL ───────────────────────────────────────────────
  const filters: SearchFilters = {
    query: searchParams.get('q') ?? '',
    category: searchParams.get('category') ?? '',
    subcategory: searchParams.get('subcategory') ?? '',
    condition: (searchParams.get('condition') as Condition) ?? '',
    region: (searchParams.get('region') as NZRegion) ?? '',
    priceMin: searchParams.get('priceMin') ?? '',
    priceMax: searchParams.get('priceMax') ?? '',
    sort: (searchParams.get('sort') as SortOption) ?? 'newest',
    // Quick-filter chips (boolean URL params)
    isUrgent:        searchParams.get('isUrgent') === 'true',
    isNegotiable:    searchParams.get('isNegotiable') === 'true',
    shipsNationwide: searchParams.get('shipsNationwide') === 'true',
    verifiedOnly:    searchParams.get('verifiedOnly') === 'true',
  };

  const currentPage = initialResults.page;

  // ── Helper: update URL params ───────────────────────────────────────────
  const setParam = useCallback(
    (key: keyof SearchFilters, value: string) => {
      startTransition(() => {
        const params = new URLSearchParams(searchParams.toString());
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
        // Reset subcategory when category changes
        if (key === 'category') params.delete('subcategory');
        // Reset page when filters change
        params.delete('page');
        router.replace(`/search?${params.toString()}`, { scroll: false });
      });
    },
    [searchParams, router, startTransition]
  );

  // Toggle a boolean URL param (sets 'true' or removes the key)
  const setBoolParam = useCallback(
    (key: string, value: boolean) => {
      startTransition(() => {
        const params = new URLSearchParams(searchParams.toString());
        if (value) {
          params.set(key, 'true');
        } else {
          params.delete(key);
        }
        params.delete('page');
        router.replace(`/search?${params.toString()}`, { scroll: false });
      });
    },
    [searchParams, router, startTransition]
  );

  const clearAll = useCallback(() => {
    startTransition(() => {
      router.replace('/search', { scroll: false });
    });
  }, [router, startTransition]);

  const goToPage = useCallback(
    (page: number) => {
      startTransition(() => {
        const params = new URLSearchParams(searchParams.toString());
        if (page > 1) {
          params.set('page', String(page));
        } else {
          params.delete('page');
        }
        router.replace(`/search?${params.toString()}`, { scroll: true });
      });
    },
    [searchParams, router, startTransition]
  );

  // ── Active category object ──────────────────────────────────────────────
  const activeCat = CATEGORIES.find((c) => c.id === filters.category);

  // Results come from server via initialResults (SSR)
  const results = initialResults.listings;

  // ── Active filter pills ──────────────────────────────────────────────────
  const activeFilterCount = [
    filters.category,
    filters.subcategory,
    filters.condition,
    filters.region,
    filters.priceMin,
    filters.priceMax,
    filters.isUrgent,
    filters.isNegotiable,
    filters.shipsNationwide,
    filters.verifiedOnly,
  ].filter(Boolean).length;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* ── Page header ──────────────────────────────────────────── */}
      <div className="mb-5">
        <h1 className="font-[family-name:var(--font-playfair)] text-[1.5rem] sm:text-[1.75rem]
          font-semibold text-[#141414]">
          {filters.query
            ? <>Results for <em className="not-italic text-[#D4A843]">"{filters.query}"</em></>
            : activeCat
            ? <><span aria-hidden>{activeCat.icon}</span> {activeCat.name}</>
            : 'Browse all listings'}
        </h1>
        <p className="text-[13px] text-[#73706A] mt-1">
          {isPending ? (
            <span className="animate-pulse">Searching…</span>
          ) : initialResults.totalCount === 0
            ? 'No listings match your filters'
            : `${initialResults.totalCount.toLocaleString('en-NZ')} listing${initialResults.totalCount === 1 ? '' : 's'} found`}
        </p>
      </div>

      {/* ── Filter shelf ─────────────────────────────────────────── */}
      <div
        className="bg-white rounded-2xl border border-[#E3E0D9] shadow-sm p-3.5
          mb-4 flex flex-wrap gap-2 items-end"
        role="search"
        aria-label="Search filters"
      >
        {/* Search input */}
        <div className="relative flex-1 min-w-[180px]">
          <input
            type="search"
            value={filters.query}
            onChange={(e) => setParam('query', e.target.value)}
            placeholder="Search listings…"
            aria-label="Keyword search"
            className="w-full h-9 pl-9 pr-4 rounded-lg border border-[#C9C5BC]
              bg-[#F8F7F4] text-[12.5px] text-[#141414] placeholder:text-[#9E9A91]
              outline-none focus:border-[#D4A843] focus:ring-2 focus:ring-[#D4A843]/20
              focus:bg-white transition"
          />
          <svg
            aria-hidden
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9E9A91]"
            width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
        </div>

        {/* Category */}
        <FilterSelect
          label="Category"
          value={filters.category}
          onChange={(v) => setParam('category', v)}
          className="min-w-[140px]"
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
          ))}
        </FilterSelect>

        {/* Subcategory — only shown when a category is active */}
        {activeCat && (
          <FilterSelect
            label="Subcategory"
            value={filters.subcategory}
            onChange={(v) => setParam('subcategory', v)}
            className="min-w-[150px]"
          >
            <option value="">All subcategories</option>
            {activeCat.subcategories.map((sub) => (
              <option key={sub} value={sub}>{sub}</option>
            ))}
          </FilterSelect>
        )}

        {/* Condition */}
        <FilterSelect
          label="Condition"
          value={filters.condition}
          onChange={(v) => setParam('condition', v)}
          className="min-w-[130px]"
        >
          <option value="">Any condition</option>
          <optgroup label="New">
            <option value="new">Brand New</option>
          </optgroup>
          <optgroup label="Used">
            <option value="like-new">Like New</option>
            <option value="good">Good</option>
            <option value="fair">Fair</option>
            <option value="parts">Parts Only</option>
          </optgroup>
        </FilterSelect>

        {/* Region */}
        <FilterSelect
          label="Region"
          value={filters.region}
          onChange={(v) => setParam('region', v)}
          className="min-w-[140px]"
        >
          <option value="">All NZ regions</option>
          {NZ_REGIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </FilterSelect>

        {/* Price range */}
        <div className="flex items-center gap-1.5 min-w-[160px]">
          <PriceInput
            label="Minimum price"
            name="priceMin"
            value={filters.priceMin}
            onChange={(v) => setParam('priceMin', v)}
            placeholder="Min"
          />
          <span className="text-[#C9C5BC] text-xs">–</span>
          <PriceInput
            label="Maximum price"
            name="priceMax"
            value={filters.priceMax}
            onChange={(v) => setParam('priceMax', v)}
            placeholder="Max"
          />
        </div>

        {/* Sort */}
        <FilterSelect
          label="Sort by"
          value={filters.sort}
          onChange={(v) => setParam('sort', v as SortOption)}
          className="min-w-[160px] ml-auto"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </FilterSelect>
      </div>

      {/* ── Quick filter chips ───────────────────────────────────── */}
      <div className="mb-3">
        <QuickFilterChips
          active={{
            isUrgent:        filters.isUrgent,
            isNegotiable:    filters.isNegotiable,
            shipsNationwide: filters.shipsNationwide,
            verifiedOnly:    filters.verifiedOnly,
          }}
          onToggle={(key, value) => setBoolParam(key, value)}
        />
      </div>

      {/* ── Subcategory pills (below filter shelf) ───────────────── */}
      {activeCat && (
        <div
          className="flex gap-2 overflow-x-auto scrollbar-none pb-2 mb-3"
          role="list"
          aria-label="Subcategory pills"
        >
          <button
            role="listitem"
            onClick={() => setParam('subcategory', '')}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-[12px] font-medium
              border transition-all duration-150 whitespace-nowrap
              ${!filters.subcategory
                ? 'bg-[#141414] text-white border-[#141414]'
                : 'bg-white text-[#73706A] border-[#C9C5BC] hover:border-[#141414] hover:text-[#141414]'
              }`}
          >
            All {activeCat.name}
          </button>
          {activeCat.subcategories.map((sub) => (
            <button
              key={sub}
              role="listitem"
              onClick={() => setParam('subcategory', filters.subcategory === sub ? '' : sub)}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-[12px] font-medium
                border transition-all duration-150 whitespace-nowrap
                ${filters.subcategory === sub
                  ? 'bg-[#141414] text-white border-[#141414]'
                  : 'bg-white text-[#73706A] border-[#C9C5BC] hover:border-[#141414] hover:text-[#141414]'
                }`}
            >
              {sub}
            </button>
          ))}
        </div>
      )}

      {/* ── Active filter pills row ───────────────────────────────── */}
      {activeFilterCount > 0 && (
        <div
          className="flex flex-wrap gap-2 mb-4"
          aria-label="Active filters"
        >
          {filters.category && (
            <FilterPill
              label={`${activeCat?.icon ?? ''} ${activeCat?.name}`}
              onRemove={() => setParam('category', '')}
            />
          )}
          {filters.subcategory && (
            <FilterPill
              label={filters.subcategory}
              onRemove={() => setParam('subcategory', '')}
            />
          )}
          {filters.condition && (
            <FilterPill
              label={CONDITION_LABELS[filters.condition]}
              onRemove={() => setParam('condition', '')}
            />
          )}
          {filters.region && (
            <FilterPill
              label={filters.region}
              onRemove={() => setParam('region', '')}
            />
          )}
          {(filters.priceMin || filters.priceMax) && (
            <FilterPill
              label={`$${filters.priceMin || '0'} – $${filters.priceMax || '∞'}`}
              onRemove={() => {
                setParam('priceMin', '');
                setParam('priceMax', '');
              }}
            />
          )}
          {filters.isUrgent && (
            <FilterPill label="🔥 Urgent sale" onRemove={() => setBoolParam('isUrgent', false)} />
          )}
          {filters.isNegotiable && (
            <FilterPill label="💬 Negotiable" onRemove={() => setBoolParam('isNegotiable', false)} />
          )}
          {filters.shipsNationwide && (
            <FilterPill label="📦 Ships NZ wide" onRemove={() => setBoolParam('shipsNationwide', false)} />
          )}
          {filters.verifiedOnly && (
            <FilterPill label="✅ Verified sellers" onRemove={() => setBoolParam('verifiedOnly', false)} />
          )}

          <button
            onClick={clearAll}
            className="text-[11.5px] font-medium text-[#73706A] hover:text-[#141414]
              transition-colors underline-offset-2 hover:underline ml-1"
          >
            Clear all
          </button>
        </div>
      )}

      {/* ── Results grid ─────────────────────────────────────────── */}
      {results.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {results.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No listings found"
          description={
            filters.query
              ? `We couldn't find anything for "${filters.query}". Try different keywords or remove some filters.`
              : 'No listings match your current filters. Try adjusting or clearing them.'
          }
          action={
            <div className="flex gap-3 flex-wrap justify-center">
              <button
                onClick={clearAll}
                className="px-5 py-2.5 rounded-full bg-[#141414] text-white text-[13px]
                  font-semibold hover:bg-[#D4A843] transition-colors duration-150"
              >
                Clear all filters
              </button>
              <Link
                href="/"
                className="px-5 py-2.5 rounded-full border border-[#C9C5BC] text-[#141414]
                  text-[13px] font-semibold hover:border-[#141414] transition-colors"
              >
                Back to home
              </Link>
            </div>
          }
          className="mt-4"
        />
      )}

      {/* ── Pagination ──────────────────────────────────────────── */}
      {initialResults.totalPages > 1 && (
        <div className="mt-10 flex items-center justify-center gap-2">
          <button
            disabled={currentPage <= 1 || isPending}
            onClick={() => goToPage(currentPage - 1)}
            className="h-9 px-4 rounded-lg border border-[#E3E0D9] text-[12.5px]
              text-[#9E9A91] bg-white disabled:opacity-40 disabled:cursor-not-allowed
              hover:border-[#141414] hover:text-[#141414] transition-colors"
          >
            ← Previous
          </button>
          {Array.from({ length: Math.min(initialResults.totalPages, 7) }, (_, i) => {
            const page = i + 1;
            return (
              <button
                key={page}
                onClick={() => goToPage(page)}
                disabled={isPending}
                className={`h-9 w-9 rounded-lg text-[12.5px] font-semibold flex items-center justify-center transition-colors ${
                  page === currentPage
                    ? 'bg-[#141414] text-white'
                    : 'border border-[#E3E0D9] bg-white text-[#73706A] hover:border-[#141414] hover:text-[#141414]'
                }`}
              >
                {page}
              </button>
            );
          })}
          <button
            disabled={!initialResults.hasNextPage || isPending}
            onClick={() => goToPage(currentPage + 1)}
            className="h-9 px-4 rounded-lg border border-[#E3E0D9] text-[12.5px]
              text-[#9E9A91] bg-white disabled:opacity-40 disabled:cursor-not-allowed
              hover:border-[#141414] hover:text-[#141414] transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

