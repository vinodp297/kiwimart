'use client';
// src/components/seller/BlockButton.tsx

import { useState } from 'react';
import { blockUser, unblockUser } from '@/server/actions/blocks';

interface Props {
  targetUserId: string;
  initialBlocked: boolean;
}

export function BlockButton({ targetUserId, initialBlocked }: Props) {
  const [blocked, setBlocked] = useState(initialBlocked);
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    if (!blocked) {
      const confirmed = window.confirm(
        'Block this user? They will not be able to message you and you will not be able to message them.'
      );
      if (!confirmed) return;
    }
    setLoading(true);
    try {
      if (blocked) {
        await unblockUser(targetUserId);
        setBlocked(false);
      } else {
        await blockUser(targetUserId);
        setBlocked(true);
      }
    } catch {
      // silent
    }
    setLoading(false);
  };

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      className="flex items-center gap-2 h-9 px-4 rounded-xl bg-white/5
        hover:bg-red-500/20 text-white/50 hover:text-red-400 text-[12.5px]
        font-semibold transition-colors border border-white/10 disabled:opacity-50"
    >
      {loading ? '...' : blocked ? 'Unblock' : 'Block'}
    </button>
  );
}
