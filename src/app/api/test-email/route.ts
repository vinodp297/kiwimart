// src/app/api/test-email/route.ts
// ─── Email System Diagnostic Endpoint ────────────────────────────────────────
// Returns configuration status and sends two test emails to Resend's safe test
// addresses (delivered@resend.dev / bounced@resend.dev).  Safe to leave
// deployed — never spams a real inbox.
//
// Test 1 — raw Resend client: verifies the API key and transport layer.
// Test 2 — sendPasswordResetEmail(): exercises the full template + transport
//          stack used by the forgot-password flow.

import { NextResponse } from 'next/server'
import { getEmailClient, EMAIL_FROM } from '@/infrastructure/email/client'
import { sendPasswordResetEmail } from '@/server/email'

export const dynamic = 'force-dynamic'

export async function GET() {
  const results: Record<string, unknown> = {}

  // ── Configuration checks ───────────────────────────────────────────────────
  results.resend_api_key_exists = !!process.env.RESEND_API_KEY
  results.resend_api_key_length = process.env.RESEND_API_KEY?.length ?? 0
  results.resend_api_key_prefix = process.env.RESEND_API_KEY?.slice(0, 10) ?? 'NOT SET'
  results.email_from = process.env.EMAIL_FROM ?? 'NOT SET (will use onboarding@resend.dev)'
  results.node_env = process.env.NODE_ENV
  results.next_public_app_url = process.env.NEXT_PUBLIC_APP_URL ?? 'NOT SET'

  // ── Client initialization ──────────────────────────────────────────────────
  const resend = getEmailClient()
  results.client_initialised = !!resend

  if (!resend) {
    results.client_null_reason =
      'getEmailClient() returned null — RESEND_API_KEY is missing or set to a placeholder value'
    return NextResponse.json(results, { headers: { 'Cache-Control': 'no-store' } })
  }

  // ── Test 1: raw Resend client ──────────────────────────────────────────────
  // Verifies the API key + transport layer at the lowest level.
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

  // ── Test 2: sendPasswordResetEmail() template ──────────────────────────────
  // Exercises the full path used by the forgot-password flow:
  //   requestPasswordReset → sendPasswordResetEmail → sendTransactionalEmail → Resend
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
}
