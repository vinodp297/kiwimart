interface LoadingSkeletonProps {
  count?: number;
  className?: string;
}

function SkeletonCard() {
  return (
    <div className="flex flex-col bg-white rounded-2xl overflow-hidden border border-[#E3E0D9] shadow-sm">
      {/* Image placeholder */}
      <div className="aspect-square bg-[#EFEDE8] animate-pulse" />

      {/* Content */}
      <div className="p-3.5 flex flex-col gap-2">
        <div className="h-3 w-16 bg-[#EFEDE8] rounded-full animate-pulse" />
        <div className="h-4 w-full bg-[#EFEDE8] rounded-full animate-pulse" />
        <div className="h-4 w-4/5 bg-[#EFEDE8] rounded-full animate-pulse" />
        <div className="h-6 w-24 bg-[#EFEDE8] rounded-full animate-pulse mt-1" />
        <div className="h-3 w-28 bg-[#EFEDE8] rounded-full animate-pulse" />
        <div className="border-t border-[#EFEDE8] pt-2 mt-1 flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-[#EFEDE8] animate-pulse shrink-0" />
          <div className="h-3 w-20 bg-[#EFEDE8] rounded-full animate-pulse" />
        </div>
      </div>
    </div>
  );
}

export default function LoadingSkeleton({ count = 8, className = '' }: LoadingSkeletonProps) {
  return (
    <div
      className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 ${className}`}
      aria-busy="true"
      aria-label="Loading listings…"
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

