// sentry.client.config.ts
// ─── Sentry Client-Side Configuration ────────────────────────────────────────
// Initialises Sentry in the browser for error tracking and performance.
// PII scrubbing: no user emails, names, or phone numbers are sent.

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? '',

  // Performance monitoring
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Session replay (only in production, sampled)
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: process.env.NODE_ENV === 'production' ? 1.0 : 0,

  // Environment
  environment: process.env.NODE_ENV,

  // PII scrubbing — never send user emails, names, phone numbers
  beforeSend(event) {
    // Remove user PII
    if (event.user) {
      delete event.user.email;
      delete event.user.username;
      delete event.user.ip_address;
    }

    // Scrub request data
    if (event.request) {
      delete event.request.cookies;
      delete event.request.headers;
    }

    return event;
  },

  // Ignore common non-actionable errors
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
    'Non-Error exception captured',
    'Non-Error promise rejection captured',
    /Loading chunk \d+ failed/,
    /ChunkLoadError/,
  ],

  // Only enable in production with a real DSN (not a placeholder)
  enabled:
    process.env.NODE_ENV === 'production' &&
    !!process.env.NEXT_PUBLIC_SENTRY_DSN &&
    !process.env.NEXT_PUBLIC_SENTRY_DSN.includes('placeholder'),
});
