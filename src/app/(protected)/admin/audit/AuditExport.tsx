'use client';
// src/app/(protected)/admin/audit/AuditExport.tsx

interface Entry {
  id: string;
  createdAt: Date;
  action: string;
  entityType: string;
  entityId: string;
  userEmail: string;
  ip: string;
}

export default function AuditExport({ entries }: { entries: Entry[] }) {
  function handleExport() {
    const header = ['ID', 'Timestamp', 'Actor Email', 'Action', 'Entity Type', 'Entity ID', 'IP'];
    const rows = entries.map(e => [
      e.id,
      new Date(e.createdAt).toISOString(),
      e.userEmail,
      e.action,
      e.entityType,
      e.entityId,
      e.ip,
    ]);
    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kiwimart-audit-${new Date().toISOString().slice(0, 10)}.csv`;
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
