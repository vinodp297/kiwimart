'use client';
// src/app/(protected)/admin/finance/ExportCSV.tsx

interface Row {
  id: string;
  completedAt: Date | null;
  listingTitle: string;
  buyerName: string;
  sellerName: string;
  totalNzd: number;
}

export default function ExportCSV({ data }: { data: Row[] }) {
  function handleExport() {
    const header = ['Order ID', 'Date', 'Item', 'Buyer', 'Seller', 'Amount NZD'];
    const rows = data.map(r => [
      r.id,
      r.completedAt ? new Date(r.completedAt).toLocaleDateString('en-NZ') : '',
      `"${r.listingTitle.replace(/"/g, '""')}"`,
      r.buyerName,
      r.sellerName,
      (r.totalNzd / 100).toFixed(2),
    ]);
    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kiwimart-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={handleExport}
      className="px-4 py-2 border border-[#E3E0D9] rounded-xl text-[13px] font-medium hover:bg-[#F2EFE8] transition-colors"
    >
      ↓ Export CSV
    </button>
  );
}
