// src/app/api/test-email/route.ts
// ─── Temporary Email Diagnostic Endpoint ─────────────────────────────────────
// DELETE THIS FILE after diagnosing the issue.

import { NextResponse } from 'next/server'
import { getEmailClient, EMAIL_FROM } from '@/infrastructure/email/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  const results: Record<string, unknown> = {}

  // Check env var exists
  results.resend_api_key_exists = !!process.env.RESEND_API_KEY
  results.resend_api_key_prefix = process.env.RESEND_API_KEY?.slice(0, 8) ?? 'NOT SET'
  results.resend_api_key_length = process.env.RESEND_API_KEY?.length ?? 0
  results.email_from = process.env.EMAIL_FROM ?? 'NOT SET'
  results.node_env = process.env.NODE_ENV

  // Check client initialises
  const resend = getEmailClient()
  results.client_initialised = !!resend

  // Try sending a real test email
  if (resend) {
    try {
      const { data, error } = await resend.emails.send({
        from: EMAIL_FROM,
        to: 'delivered@resend.dev',
        subject: 'KiwiMart email diagnostic test',
        html: '<p>Email system working.</p>',
      })
      results.test_send_data = data
      results.test_send_error = error
    } catch (err) {
      results.test_send_exception = err instanceof Error ? err.message : String(err)
    }
  } else {
    results.test_send_skipped = 'Client is null — RESEND_API_KEY missing or placeholder'
  }

  return NextResponse.json(results, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}
