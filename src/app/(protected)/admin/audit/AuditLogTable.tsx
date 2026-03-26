'use client';
// src/app/(protected)/admin/audit/AuditLogTable.tsx

import { useState } from 'react';

interface AuditEntry {
  id: string;
  createdAt: Date;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  user: { displayName: string | null; email: string | null; adminRole: string | null } | null;
}

interface Props {
  entries: AuditEntry[];
  actionTypes: { action: string; count: number }[];
}

const ACTION_COLORS: Record<string, string> = {
  ADMIN_ACTION: 'bg-violet-50 text-violet-700',
  USER_REGISTER: 'bg-emerald-50 text-emerald-700',
  USER_LOGIN: 'bg-sky-50 text-sky-700',
  DISPUTE_RESOLVED: 'bg-red-50 text-red-700',
  PAYMENT_COMPLETED: 'bg-emerald-50 text-emerald-700',
  PAYMENT_FAILED: 'bg-red-50 text-red-700',
};

export default function AuditLogTable({ entries, actionTypes }: Props) {
  const [filter, setFilter] = useState('');

  const filtered = filter ? entries.filter(e => e.action === filter) : entries;

  return (
    <div className="bg-white rounded-2xl border border-[#E3E0D9]">
      <div className="flex items-center justify-between p-5 border-b border-[#F0EDE8] gap-4">
        <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] shrink-0">
          Activity Log
        </h2>
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="ml-auto text-[12px] border border-[#E3E0D9] rounded-lg px-3 py-2 bg-white text-[#141414] focus:outline-none focus:ring-1 focus:ring-[#D4A843]"
        >
          <option value="">All actions ({entries.length})</option>
          {actionTypes.map(at => (
            <option key={at.action} value={at.action}>
              {at.action.replace(/_/g, ' ')} ({at.count})
            </option>
          ))}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-[#F0EDE8] bg-[#FAFAF8]">
              {['Timestamp', 'Actor', 'Role', 'Action', 'Entity Type', 'Entity ID', 'IP'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-[#9E9A91] uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F8F7F4]">
            {filtered.map(log => (
              <tr key={log.id} className="hover:bg-[#FAFAF8]">
                <td className="px-4 py-3 text-[#9E9A91] whitespace-nowrap text-[11px]">
                  {new Date(log.createdAt).toLocaleString('en-NZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-4 py-3">
                  <p className="font-semibold text-[#141414]">{log.user?.displayName ?? 'System'}</p>
                  <p className="text-[#9E9A91] text-[11px]">{log.user?.email ?? ''}</p>
                </td>
                <td className="px-4 py-3 text-[#9E9A91] text-[11px]">{log.user?.adminRole ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${ACTION_COLORS[log.action] ?? 'bg-[#F8F7F4] text-[#73706A]'}`}>
                    {log.action.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 text-[#73706A]">{log.entityType ?? '—'}</td>
                <td className="px-4 py-3 font-mono text-[11px] text-[#9E9A91] max-w-[100px] truncate">{log.entityId ?? '—'}</td>
                <td className="px-4 py-3 font-mono text-[11px] text-[#9E9A91]">{log.ip ?? '—'}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-[#9E9A91]">No matching audit logs</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
