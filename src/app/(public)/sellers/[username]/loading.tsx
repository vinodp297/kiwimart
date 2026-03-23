// src/app/(public)/sellers/[username]/loading.tsx

export default function SellerProfileLoading() {
  return (
    <div className="bg-[#FAFAF8] min-h-screen animate-pulse">
      <div className="h-14 bg-white border-b border-[#E3E0D9]" />

      {/* Hero band skeleton */}
      <div className="bg-[#141414] h-48" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Seller info bar */}
        <div className="flex items-center gap-4 mb-8 -mt-12">
          <div className="w-20 h-20 rounded-full bg-[#E3E0D9] ring-4 ring-white shrink-0" />
          <div className="space-y-2">
            <div className="h-6 w-40 bg-[#E3E0D9] rounded-full" />
            <div className="h-4 w-24 bg-[#E3E0D9] rounded-full" />
          </div>
        </div>

        {/* Listing card grid skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-[#E3E0D9] overflow-hidden">
              <div className="aspect-square bg-[#E3E0D9]" />
              <div className="p-3 space-y-2">
                <div className="h-3 w-16 bg-[#E3E0D9] rounded-full" />
                <div className="h-4 w-full bg-[#E3E0D9] rounded-full" />
                <div className="h-4 w-3/4 bg-[#E3E0D9] rounded-full" />
                <div className="h-5 w-20 bg-[#E3E0D9] rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
