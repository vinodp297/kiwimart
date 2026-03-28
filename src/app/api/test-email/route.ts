// src/app/api/test-email/route.ts
// ─── Email System Diagnostic Endpoint ──────────────────────────────────────
// Returns configuration status and sends two test emails to Resend's safe test
// addresses (delivered@resend.dev / bounced@resend.dev).
//
// SECURITY: Requires SUPER_ADMIN authentication (via requireSuperAdmin).
// Reduced metadata — no API key prefix or app URL exposed.

import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/shared/auth/requirePermission'
import { getEmailClient, EMAIL_FROM } from '@/infrastructure/email/client'
import { sendPasswordResetEmail } from '@/server/email'
import { logger } from '@/shared/logger'

export const dynamic = 'force-dynamic'

export async function GET() {
  // ── Auth guard — SUPER_ADMIN only ──────────────────────────────────────────
  try {
    await requireSuperAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const results: Record<string, unknown> = {}

    // ── Configuration checks (reduced — no secrets or values) ──────────────────
    results.resend_api_key_exists = !!process.env.RESEND_API_KEY
    results.resend_api_key_length = process.env.RESEND_API_KEY?.length ?? 0
    results.email_from_configured = !!process.env.EMAIL_FROM
    results.node_env = process.env.NODE_ENV

    // ── Client initialization ────────────────────────────────────────────────
    const resend = getEmailClient()
    results.client_initialised = !!resend

    if (!resend) {
      results.client_null_reason =
        'getEmailClient() returned null — RESEND_API_KEY is missing or set to a placeholder value'
      return NextResponse.json(results, { headers: { 'Cache-Control': 'no-store' } })
    }

    // ── Test 1: raw Resend client ────────────────────────────────────────────
    try {
      const { data, error } = await resend.emails.send({
        from: EMAIL_FROM,
        to: 'delivered@resend.dev',
        subject: 'KiwiMart — raw client test',
        html: `<p>Raw transport test sent at ${new Date().toISOString()}</p>`,
      })
      results.raw_send_success = !error
      results.raw_send_id = data?.id ?? null
      results.raw_send_error = error ? String(error) : null
    } catch (err) {
      results.raw_send_exception = err instanceof Error ? err.message : String(err)
    }

    // ── Test 2: sendPasswordResetEmail() template ────────────────────────────
    try {
      await sendPasswordResetEmail({
        to: 'delivered@resend.dev',
        displayName: 'Test User',
        resetUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://kiwimart.vercel.app'}/reset-password?token=test_diagnostic_token`,
        expiresInMinutes: 60,
      })
      results.template_send_success = true
      results.template_send_error = null
    } catch (err) {
      results.template_send_success = false
      results.template_send_error = err instanceof Error ? err.message : String(err)
    }

    return NextResponse.json(results, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    logger.error('api.error', { path: '/api/test-email', error: e instanceof Error ? e.message : e })
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
