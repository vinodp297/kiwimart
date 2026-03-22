interface TrustBadgeProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  highlight?: boolean;
}

export default function TrustBadge({ icon, title, description, highlight = false }: TrustBadgeProps) {
  return (
    <div
      className={`flex items-start gap-3.5 p-4 rounded-2xl border transition-all duration-200
        hover:shadow-md group
        ${highlight
          ? 'bg-[#141414] border-[#2a2a2a] text-white'
          : 'bg-white border-[#E3E0D9] text-[#141414]'
        }`}
    >
      {/* Icon container */}
      <div
        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0
          transition-transform duration-200 group-hover:scale-110
          ${highlight
            ? 'bg-[#D4A843]/20 text-[#D4A843]'
            : 'bg-[#F5ECD4] text-[#D4A843]'
          }`}
      >
        {icon}
      </div>

      {/* Text */}
      <div className="min-w-0">
        <p className={`text-[13px] font-semibold leading-tight
          ${highlight ? 'text-white' : 'text-[#141414]'}`}>
          {title}
        </p>
        <p className={`text-[12px] mt-0.5 leading-relaxed
          ${highlight ? 'text-white/60' : 'text-[#73706A]'}`}>
          {description}
        </p>
      </div>
    </div>
  );
}

