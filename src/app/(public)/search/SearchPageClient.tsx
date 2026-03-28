'use client';

import { useRef, useState, useTransition, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import CATEGORIES from '@/data/categories';
import ListingCard from '@/components/ListingCard';
import EmptyState from '@/components/EmptyState';
import QuickFilterChips from '@/components/QuickFilterChips';
import type { Condition, NZRegion, SortOption, ListingCard as ListingCardType } from '@/types';
import { CONDITION_LABELS } from '@/lib/utils';
import Link from 'next/link';
import type { SearchResult } from '@/server/actions/search';

// ── Constants ─────────────────────────────────────────────────────────────────
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

// ── Filter state type ─────────────────────────────────────────────────────────
type FilterState = {
  query: string;
  category: string;
  subcategory: string;
  condition: string;
  region: string;
  priceMin: string;
  priceMax: string;
  sort: string;
  isUrgent: boolean;
  isNegotiable: boolean;
  shipsNationwide: boolean;
  verifiedOnly: boolean;
  radiusKm: string;
};

const RADIUS_OPTIONS = [
  { value: '', label: 'Any distance' },
  { value: '10', label: '10 km' },
  { value: '25', label: '25 km' },
  { value: '50', label: '50 km' },
  { value: '100', label: '100 km' },
  { value: '200', label: '200 km' },
];

// ── Build URL from filter state ───────────────────────────────────────────────
function buildSearchUrl(f: FilterState, page?: number): string {
  const params = new URLSearchParams();
  if (f.query)           params.set('q',               f.query);
  if (f.category)        params.set('category',         f.category);
  if (f.subcategory)     params.set('subcategory',      f.subcategory);
  if (f.condition)       params.set('condition',        f.condition);
  if (f.region)          params.set('region',           f.region);
  if (f.priceMin)        params.set('priceMin',         f.priceMin);
  if (f.priceMax)        params.set('priceMax',         f.priceMax);
  if (f.sort && f.sort !== 'newest') params.set('sort', f.sort);
  if (f.isUrgent)        params.set('isUrgent',         'true');
  if (f.isNegotiable)    params.set('isNegotiable',     'true');
  if (f.shipsNationwide) params.set('shipsNationwide',  'true');
  if (f.verifiedOnly)    params.set('verifiedOnly',     'true');
  if (f.radiusKm)        params.set('radiusKm',         f.radiusKm);
  if (page && page > 1)  params.set('page',             String(page));
  const qs = params.toString();
  return qs ? `/search?${qs}` : '/search';
}

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

  // ── Delayed pending indicator — only dim grid after 300 ms to avoid flash
  const [showPending, setShowPending] = useState(false);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isPending) {
      pendingTimerRef.current = setTimeout(() => setShowPending(true), 300);
    } else {
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
      setShowPending(false);
    }
    return () => {
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    };
  }, [isPending]);

  // ── Local filter state — initialised from URL params once on mount ──────
  const [filters, setFilters] = useState<FilterState>({
    query:           searchParams.get('q')               ?? '',
    category:        searchParams.get('category')        ?? '',
    subcategory:     searchParams.get('subcategory')     ?? '',
    condition:       searchParams.get('condition')       ?? '',
    region:          searchParams.get('region')          ?? '',
    priceMin:        searchParams.get('priceMin')        ?? '',
    priceMax:        searchParams.get('priceMax')        ?? '',
    sort:            searchParams.get('sort')            ?? 'newest',
    isUrgent:        searchParams.get('isUrgent')        === 'true',
    isNegotiable:    searchParams.get('isNegotiable')    === 'true',
    shipsNationwide: searchParams.get('shipsNationwide') === 'true',
    verifiedOnly:    searchParams.get('verifiedOnly')    === 'true',
    radiusKm:        searchParams.get('radiusKm')        ?? '',
  });

  // Debounce timer for URL sync
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Update one or more filter keys; debounce the URL round-trip ─────────
  // delay=0   → instant URL update (chips, dropdowns, active pill removal)
  // delay=400 → debounced (price inputs)
  // delay=600 → debounced (keyword search input)
  const updateFilter = (updates: Partial<FilterState>, delay = 0) => {
    const next: FilterState = { ...filters, ...updates };
    // Selecting a new category always resets subcategory
    if ('category' in updates) next.subcategory = '';
    // Always reset page when any filter changes (no page key in FilterState;
    // goToPage passes it explicitly to buildSearchUrl)

    setFilters(next);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      startTransition(() => {
        router.replace(buildSearchUrl(next), { scroll: false });
      });
    }, delay);
  };

  // ── Clear all filters at once ────────────────────────────────────────────
  const clearAll = () => {
    const empty: FilterState = {
      query: '', category: '', subcategory: '', condition: '', region: '',
      priceMin: '', priceMax: '', sort: 'newest',
      isUrgent: false, isNegotiable: false, shipsNationwide: false, verifiedOnly: false, radiusKm: '',
    };
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setFilters(empty);
    startTransition(() => {
      router.replace('/search', { scroll: false });
    });
  };

  // ── Pagination — includes current filter state in the URL ────────────────
  const goToPage = (page: number) => {
    startTransition(() => {
      router.replace(buildSearchUrl(filters, page), { scroll: page > 1 });
    });
  };

  const currentPage = initialResults.page;

  // ── Active category object ───────────────────────────────────────────────
  const activeCat = CATEGORIES.find((c) => c.id === filters.category);

  // Results come from server via initialResults (SSR / Next.js page re-render)
  const results = initialResults.listings;

  // ── Active filter count (drives "clear all" visibility) ──────────────────
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
    filters.radiusKm,
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
        {/* Search input — 600ms debounce so typing feels instant */}
        <div className="relative flex-1 min-w-[180px]">
          <input
            type="search"
            value={filters.query}
            onChange={(e) => updateFilter({ query: e.target.value }, 600)}
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

        {/* Category — instant */}
        <FilterSelect
          label="Category"
          value={filters.category}
          onChange={(v) => updateFilter({ category: v })}
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
            onChange={(v) => updateFilter({ subcategory: v })}
            className="min-w-[150px]"
          >
            <option value="">All subcategories</option>
            {activeCat.subcategories.map((sub) => (
              <option key={sub} value={sub}>{sub}</option>
            ))}
          </FilterSelect>
        )}

        {/* Condition — instant */}
        <FilterSelect
          label="Condition"
          value={filters.condition}
          onChange={(v) => updateFilter({ condition: v })}
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

        {/* Region — instant */}
        <FilterSelect
          label="Region"
          value={filters.region}
          onChange={(v) => updateFilter({ region: v })}
          className="min-w-[140px]"
        >
          <option value="">All NZ regions</option>
          {NZ_REGIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </FilterSelect>

        {/* Radius — only shown when a region is selected */}
        {filters.region && (
          <FilterSelect
            label="Distance"
            value={filters.radiusKm}
            onChange={(v) => updateFilter({ radiusKm: v })}
            className="min-w-[120px]"
          >
            {RADIUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </FilterSelect>
        )}

        {/* Price range — 400ms debounce while typing */}
        <div className="flex items-center gap-1.5 min-w-[160px]">
          <PriceInput
            label="Minimum price"
            name="priceMin"
            value={filters.priceMin}
            onChange={(v) => updateFilter({ priceMin: v }, 400)}
            placeholder="Min"
          />
          <span className="text-[#C9C5BC] text-xs">–</span>
          <PriceInput
            label="Maximum price"
            name="priceMax"
            value={filters.priceMax}
            onChange={(v) => updateFilter({ priceMax: v }, 400)}
            placeholder="Max"
          />
        </div>

        {/* Sort — instant */}
        <FilterSelect
          label="Sort by"
          value={filters.sort}
          onChange={(v) => updateFilter({ sort: v as SortOption })}
          className="min-w-[160px] ml-auto"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </FilterSelect>
      </div>

      {/* ── Quick filter chips — instant toggle ──────────────────── */}
      <div className="mb-3">
        <QuickFilterChips
          active={{
            isUrgent:        filters.isUrgent,
            isNegotiable:    filters.isNegotiable,
            shipsNationwide: filters.shipsNationwide,
            verifiedOnly:    filters.verifiedOnly,
          }}
          onToggle={(key, value) =>
            updateFilter({ [key]: value } as Partial<FilterState>)
          }
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
            onClick={() => updateFilter({ subcategory: '' })}
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
              onClick={() =>
                updateFilter({ subcategory: filters.subcategory === sub ? '' : sub })
              }
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
              onRemove={() => updateFilter({ category: '' })}
            />
          )}
          {filters.subcategory && (
            <FilterPill
              label={filters.subcategory}
              onRemove={() => updateFilter({ subcategory: '' })}
            />
          )}
          {filters.condition && (
            <FilterPill
              label={CONDITION_LABELS[filters.condition as Condition]}
              onRemove={() => updateFilter({ condition: '' })}
            />
          )}
          {filters.region && (
            <FilterPill
              label={filters.region}
              onRemove={() => updateFilter({ region: '' })}
            />
          )}
          {(filters.priceMin || filters.priceMax) && (
            <FilterPill
              label={`$${filters.priceMin || '0'} – $${filters.priceMax || '∞'}`}
              onRemove={() => updateFilter({ priceMin: '', priceMax: '' })}
            />
          )}
          {filters.isUrgent && (
            <FilterPill
              label="🔥 Urgent sale"
              onRemove={() => updateFilter({ isUrgent: false })}
            />
          )}
          {filters.isNegotiable && (
            <FilterPill
              label="💬 Negotiable"
              onRemove={() => updateFilter({ isNegotiable: false })}
            />
          )}
          {filters.shipsNationwide && (
            <FilterPill
              label="📦 Ships NZ wide"
              onRemove={() => updateFilter({ shipsNationwide: false })}
            />
          )}
          {filters.verifiedOnly && (
            <FilterPill
              label="Verified sellers"
              onRemove={() => updateFilter({ verifiedOnly: false })}
            />
          )}
          {filters.radiusKm && (
            <FilterPill
              label={`Within ${filters.radiusKm} km`}
              onRemove={() => updateFilter({ radiusKm: '' })}
            />
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

      {/* ── Results grid — dim slightly after 300 ms if still loading ─ */}
      <div
        className={`transition-opacity duration-300 ${
          showPending ? 'opacity-[0.85]' : 'opacity-100'
        }`}
      >
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
      </div>

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
