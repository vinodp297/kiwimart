'use client';
// src/components/admin/OrderVolumeChart.tsx

interface Props {
  data: { date: string; count: number }[];
  title?: string;
}

export function OrderVolumeChart({ data, title = 'Order Volume — Last 30 Days' }: Props) {
  const maxCount = Math.max(...data.map(d => d.count), 1);
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div className="bg-white border border-[#E3E0D9] rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-semibold text-[#141414] text-[15px]">{title}</h3>
        <span className="text-[12px] text-[#73706A]">
          Total: {total.toLocaleString('en-NZ')} orders
        </span>
      </div>

      {/* Bar chart */}
      <div className="flex items-end gap-1 h-40 overflow-hidden">
        {data.map((day, i) => {
          const height = maxCount > 0 ? (day.count / maxCount) * 100 : 0;
          const isToday = i === data.length - 1;
          return (
            <div key={day.date} className="flex-1 flex flex-col items-center gap-1 group relative">
              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-[#141414] text-white text-[10px] px-2 py-1 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                {new Date(day.date).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                <br />
                {day.count} order{day.count !== 1 ? 's' : ''}
              </div>
              {/* Bar */}
              <div
                className={`w-full rounded-t-sm transition-all ${
                  isToday
                    ? 'bg-[#D4A843]'
                    : 'bg-[#141414]/20 group-hover:bg-[#141414]/40'
                }`}
                style={{ height: `${Math.max(height, 2)}%` }}
              />
            </div>
          );
        })}
      </div>

      {/* X-axis labels */}
      <div className="flex justify-between mt-2 text-[10px] text-[#C9C5BC]">
        <span>
          {new Date(data[0]?.date ?? '').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
        </span>
        <span>Today</span>
      </div>
    </div>
  );
}
