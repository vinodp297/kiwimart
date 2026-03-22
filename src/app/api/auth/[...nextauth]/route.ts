// src/app/api/auth/[...nextauth]/route.ts
// ─── Auth.js Route Handler ────────────────────────────────────────────────────
// Next.js App Router convention for Auth.js v5.
// This single file handles all /api/auth/* endpoints:
//   GET/POST /api/auth/signin
//   GET/POST /api/auth/signout
//   GET/POST /api/auth/callback/[provider]
//   GET      /api/auth/session
//   GET      /api/auth/csrf
//   GET      /api/auth/providers

import { handlers } from '@/lib/auth';

export const { GET, POST } = handlers;

// Use Edge Runtime for lowest latency on auth checks
// Note: Argon2id runs in the Credentials authorize() callback which
// uses the Node.js provider — this route itself is Edge-compatible.
export const runtime = 'nodejs';

