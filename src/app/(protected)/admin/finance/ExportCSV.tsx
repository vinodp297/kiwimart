'use client';
// src/app/(protected)/admin/finance/ExportCSV.tsx

const BOM = '\uFEFF';

function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface TransactionRow {
  id: string;
  completedAt: Date | null;
  listingTitle: string;
  buyerName: string | null;
  sellerName: string | null;
  totalNzd: number;
  payoutStatus?: string | null;
}

interface PayoutRow {
  id: string;
  amountNzd: number;
  status: string;
  initiatedAt: Date | null;
  stripeTransferId: string | null;
  sellerName: string | null;
  sellerEmail: string | null;
  listingTitle: string;
}

interface RefundRow {
  id: string;
  updatedAt: Date;
  listingTitle: string;
  buyerName: string | null;
  sellerName: string | null;
  totalNzd: number;
}

interface Props {
  transactions: TransactionRow[];
  payouts: PayoutRow[];
  refunds: RefundRow[];
}

export default function ExportCSV({ transactions, payouts, refunds }: Props) {
  function exportTransactions() {
    const headers = ['Order ID', 'Date', 'Item', 'Buyer', 'Seller', 'Amount (NZD)', 'Payout Status'];
    const rows = transactions.map(r => [
      r.id,
      r.completedAt ? new Date(r.completedAt).toLocaleDateString('en-NZ') : '',
      `"${(r.listingTitle ?? '').replace(/"/g, '""')}"`,
      r.buyerName ?? '',
      r.sellerName ?? '',
      (r.totalNzd / 100).toFixed(2),
      r.payoutStatus ?? 'N/A',
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    downloadCSV(csv, `kiwimart-transactions-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  function exportPayouts() {
    const headers = ['Payout ID', 'Seller', 'Email', 'Item', 'Amount (NZD)', 'Status', 'Initiated', 'Stripe Transfer ID'];
    const rows = payouts.map(p => [
      p.id,
      p.sellerName ?? '',
      p.sellerEmail ?? '',
      `"${p.listingTitle.replace(/"/g, '""')}"`,
      (p.amountNzd / 100).toFixed(2),
      p.status,
      p.initiatedAt ? new Date(p.initiatedAt).toLocaleDateString('en-NZ') : '',
      p.stripeTransferId ?? '',
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    downloadCSV(csv, `kiwimart-payouts-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  function exportRefunds() {
    const headers = ['Order ID', 'Refunded Date', 'Item', 'Buyer', 'Seller', 'Amount (NZD)'];
    const rows = refunds.map(r => [
      r.id,
      new Date(r.updatedAt).toLocaleDateString('en-NZ'),
      `"${(r.listingTitle ?? '').replace(/"/g, '""')}"`,
      r.buyerName ?? '',
      r.sellerName ?? '',
      (r.totalNzd / 100).toFixed(2),
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    downloadCSV(csv, `kiwimart-refunds-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={exportTransactions}
        className="px-3 py-1.5 border border-[#E3E0D9] rounded-xl text-[12px] font-medium hover:bg-[#F2EFE8] transition-colors"
      >
        ↓ Transactions
      </button>
      <button
        onClick={exportPayouts}
        className="px-3 py-1.5 border border-[#E3E0D9] rounded-xl text-[12px] font-medium hover:bg-[#F2EFE8] transition-colors"
      >
        ↓ Payouts
      </button>
      <button
        onClick={exportRefunds}
        className="px-3 py-1.5 border border-[#E3E0D9] rounded-xl text-[12px] font-medium hover:bg-[#F2EFE8] transition-colors"
      >
        ↓ Refunds
      </button>
    </div>
  );
}
