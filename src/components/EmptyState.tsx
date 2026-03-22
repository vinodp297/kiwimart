interface EmptyStateProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export default function EmptyState({
  title = 'No listings found',
  description = 'Try adjusting your search or filters to find what you\'re looking for.',
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center py-16 px-6
        bg-[#F8F7F4] rounded-2xl border border-dashed border-[#C9C5BC] ${className}`}
    >
      {/* Illustration */}
      <div className="w-16 h-16 rounded-full bg-[#EFEDE8] flex items-center
        justify-center text-3xl mb-4 select-none" aria-hidden>
        🔍
      </div>

      <h3 className="text-[17px] font-semibold text-[#141414] font-[family-name:var(--font-playfair)]">
        {title}
      </h3>
      <p className="mt-1.5 text-[13.5px] text-[#73706A] max-w-xs leading-relaxed">
        {description}
      </p>

      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

