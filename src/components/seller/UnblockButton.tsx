'use client';
// src/components/seller/UnblockButton.tsx

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { unblockUser } from '@/server/actions/blocks';

interface Props {
  targetUserId: string;
}

export function UnblockButton({ targetUserId }: Props) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleUnblock = async () => {
    setLoading(true);
    await unblockUser(targetUserId);
    router.refresh();
    setLoading(false);
  };

  return (
    <button
      onClick={handleUnblock}
      disabled={loading}
      className="text-[12px] px-3 py-1.5 rounded-lg border border-[#E3E0D9]
        text-[#73706A] hover:border-red-200 hover:text-red-500
        transition-colors disabled:opacity-50"
    >
      {loading ? '...' : 'Unblock'}
    </button>
  );
}
