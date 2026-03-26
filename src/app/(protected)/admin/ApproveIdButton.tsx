'use client'
// src/app/(protected)/admin/ApproveIdButton.tsx

import { useState } from 'react'
import { approveIdVerification } from '@/server/actions/seller'

export default function ApproveIdButton({ userId }: { userId: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function handleApprove() {
    setState('loading')
    setErrorMsg(null)
    const result = await approveIdVerification(userId)
    if (result.success) {
      setState('done')
    } else {
      setState('error')
      setErrorMsg(result.error ?? 'Approval failed.')
    }
  }

  if (state === 'done') {
    return (
      <span className="text-[12px] text-green-700 font-medium bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg">
        ✓ Approved
      </span>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleApprove}
        disabled={state === 'loading'}
        className="text-[12px] font-semibold bg-[#141414] text-white px-3 py-1.5 rounded-lg
          hover:bg-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {state === 'loading' ? 'Approving…' : 'Approve'}
      </button>
      {state === 'error' && errorMsg && (
        <span className="text-[11.5px] text-red-600">{errorMsg}</span>
      )}
    </div>
  )
}
