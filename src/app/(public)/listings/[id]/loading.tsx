// src/app/(public)/listings/[id]/loading.tsx
// Skeleton matching the 2-column listing detail layout

export default function ListingDetailLoading() {
  return (
    <div className="bg-[#FAFAF8] min-h-screen animate-pulse">
      {/* NavBar placeholder */}
      <div className="h-14 bg-white border-b border-[#E3E0D9]" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Breadcrumb */}
        <div className="h-4 w-64 bg-[#E3E0D9] rounded-full mb-6" />

        <div className="mt-5 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8">
          {/* Left column */}
          <div className="min-w-0">
            {/* Main image */}
            <div className="aspect-square rounded-2xl bg-[#E3E0D9] w-full" />

            {/* Thumbnail strip */}
            <div className="flex gap-2 mt-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="w-16 h-16 rounded-xl bg-[#E3E0D9] shrink-0" />
              ))}
            </div>

            {/* Description skeleton */}
            <div className="mt-8 bg-white rounded-2xl border border-[#E3E0D9] p-6 space-y-3">
              <div className="h-5 w-32 bg-[#E3E0D9] rounded-full" />
              <div className="h-4 w-full bg-[#E3E0D9] rounded-full" />
              <div className="h-4 w-5/6 bg-[#E3E0D9] rounded-full" />
              <div className="h-4 w-4/6 bg-[#E3E0D9] rounded-full" />
              <div className="h-4 w-3/4 bg-[#E3E0D9] rounded-full" />
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-4">
            {/* Title */}
            <div className="h-8 w-3/4 bg-[#E3E0D9] rounded-full" />
            <div className="h-6 w-1/2 bg-[#E3E0D9] rounded-full" />

            {/* Price */}
            <div className="h-10 w-40 bg-[#E3E0D9] rounded-full" />

            {/* Buy button */}
            <div className="h-12 w-full bg-[#E3E0D9] rounded-full" />

            {/* Offer button */}
            <div className="h-12 w-full bg-[#E3E0D9] rounded-full" />

            {/* Seller panel */}
            <div className="bg-white rounded-2xl border border-[#E3E0D9] p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#E3E0D9]" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 w-32 bg-[#E3E0D9] rounded-full" />
                  <div className="h-3 w-24 bg-[#E3E0D9] rounded-full" />
                </div>
              </div>
            </div>

            {/* Meta card */}
            <div className="bg-white rounded-2xl border border-[#E3E0D9] p-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex justify-between">
                  <div className="h-3 w-20 bg-[#E3E0D9] rounded-full" />
                  <div className="h-3 w-16 bg-[#E3E0D9] rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
