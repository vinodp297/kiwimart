// src/app/api/test-email/route.ts
// ─── Email System Diagnostic Endpoint ────────────────────────────────────────
// Returns configuration status and sends a test email to Resend's test address.
// Safe to leave deployed — sends only to delivered@resend.dev (always succeeds,
// never spams a real inbox).

import { NextResponse } from 'next/server'
import { getEmailClient, EMAIL_FROM } from '@/infrastructure/email/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  const results: Record<string, unknown> = {}

  // ── Configuration checks ───────────────────────────────────────────────────
  results.resend_api_key_exists = !!process.env.RESEND_API_KEY
  results.resend_api_key_length = process.env.RESEND_API_KEY?.length ?? 0
  results.resend_api_key_prefix = process.env.RESEND_API_KEY?.slice(0, 10) ?? 'NOT SET'
  results.email_from = process.env.EMAIL_FROM ?? 'NOT SET'
  results.node_env = process.env.NODE_ENV
  results.next_public_app_url = process.env.NEXT_PUBLIC_APP_URL ?? 'NOT SET'

  // ── Client initialization ──────────────────────────────────────────────────
  const resend = getEmailClient()
  results.client_initialised = !!resend

  // ── Test send ──────────────────────────────────────────────────────────────
  if (resend) {
    try {
      const { data, error } = await resend.emails.send({
        from: EMAIL_FROM,
        to: 'delivered@resend.dev',
        subject: 'KiwiMart Email Test',
        html: `<p>Test sent at ${new Date().toISOString()}</p>`,
      })
      results.test_send_success = !error
      results.test_send_id = data?.id ?? null
      results.test_send_error = error ? String(error) : null
    } catch (err) {
      results.test_send_exception = err instanceof Error ? err.message : String(err)
    }
  } else {
    results.client_null_reason =
      'getEmailClient() returned null — RESEND_API_KEY is missing or set to a placeholder value'
  }

  return NextResponse.json(results, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
