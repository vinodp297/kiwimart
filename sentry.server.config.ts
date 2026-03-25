// sentry.server.config.ts
// ─── Sentry Server-Side Configuration ────────────────────────────────────────
// Initialises Sentry on the Node.js server for error tracking.
// PII scrubbing: no user emails, names, or phone numbers are sent.

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? '',

  // Performance monitoring (lower rate on server — high volume)
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 1.0,

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

    // Scrub request cookies and auth headers
    if (event.request) {
      delete event.request.cookies;
      if (event.request.headers) {
        delete event.request.headers['cookie'];
        delete event.request.headers['authorization'];
        delete event.request.headers['x-forwarded-for'];
      }
    }

    return event;
  },

  // Only enable in production with a real DSN (not a placeholder)
  enabled:
    process.env.NODE_ENV === 'production' &&
    !!process.env.NEXT_PUBLIC_SENTRY_DSN &&
    !process.env.NEXT_PUBLIC_SENTRY_DSN.includes('placeholder'),
});
