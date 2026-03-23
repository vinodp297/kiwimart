// src/app/(public)/search/loading.tsx

export default function SearchLoading() {
  return (
    <div className="bg-[#FAFAF8] min-h-screen animate-pulse">
      <div className="h-14 bg-white border-b border-[#E3E0D9]" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Filter bar skeleton */}
        <div className="flex gap-3 mb-6">
          <div className="h-10 flex-1 max-w-xs bg-[#E3E0D9] rounded-xl" />
          <div className="h-10 w-28 bg-[#E3E0D9] rounded-xl" />
          <div className="h-10 w-28 bg-[#E3E0D9] rounded-xl" />
          <div className="h-10 w-28 bg-[#E3E0D9] rounded-xl" />
        </div>

        {/* Results count */}
        <div className="h-4 w-32 bg-[#E3E0D9] rounded-full mb-5" />

        {/* Listing card grid skeleton — 2x4 (8 cards) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-[#E3E0D9] overflow-hidden">
              <div className="aspect-square bg-[#E3E0D9]" />
              <div className="p-3 space-y-2">
                <div className="h-3 w-16 bg-[#E3E0D9] rounded-full" />
                <div className="h-4 w-full bg-[#E3E0D9] rounded-full" />
                <div className="h-4 w-3/4 bg-[#E3E0D9] rounded-full" />
                <div className="h-5 w-20 bg-[#E3E0D9] rounded-full" />
                <div className="flex justify-between pt-1">
                  <div className="h-3 w-16 bg-[#E3E0D9] rounded-full" />
                  <div className="h-3 w-12 bg-[#E3E0D9] rounded-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
