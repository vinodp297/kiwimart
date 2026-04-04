# Dependency Health Report

## Summary

- **Total dependencies:** 33 prod + 19 dev
- **Last audit date:** 2026-04-04
- **Known vulnerabilities:** 9 high, 5 moderate — all resolved via `npm audit fix` (see details below)
- **Next audit:** Monthly recommendation — run `npm audit` before each deployment

## Intentional Beta Dependencies

| Package   | Pinned Version | Reason                                                                                                                                                                                                 | Monitor                                          |
| --------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| next-auth | 5.0.0-beta.30  | Auth.js v5 has no stable release; v5 beta is the only version supporting Next.js App Router natively. Pin intentional — monitor https://authjs.dev/getting-started/migrating-to-v5 for stable release. | https://github.com/nextauthjs/next-auth/releases |

## Packages Removed (Unused)

| Package              | Reason Removed                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| vitest-mock-extended | Flagged by depcheck as unused; confirmed not imported in any source or test file. No indirect config usage found. |

## Packages Retained (False Positives from depcheck)

| Package              | Why Kept                                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| pg                   | Peer dependency of `@prisma/adapter-pg`; `PrismaPg` in `src/lib/db.ts` instantiates the adapter which requires `pg` at runtime.        |
| @types/pg            | Companion TypeScript types for `pg`; required for type-safe usage of the pg driver.                                                    |
| @tailwindcss/postcss | Registered as a PostCSS plugin in `postcss.config.mjs`; depcheck does not parse PostCSS config files.                                  |
| @types/react-dom     | Types for React DOM; implicitly required by Next.js JSX compilation and any component that uses `ReactDOM` APIs.                       |
| @vitest/coverage-v8  | Coverage provider declared in `vitest.config.ts` (`coverage.provider: "v8"`); not imported directly but required at runtime by vitest. |
| prettier             | Used in `lint-staged` config in `package.json` (`prettier --write`); depcheck does not parse the `lint-staged` key.                    |

## Known Vulnerabilities

| Package                     | Severity | CVE / Advisory                                                          | Status                      |
| --------------------------- | -------- | ----------------------------------------------------------------------- | --------------------------- |
| @hono/node-server <1.19.10  | High     | GHSA-wc8c-qw6v-h7f6 (auth bypass via encoded slashes)                   | Resolved by `npm audit fix` |
| defu <=6.1.4                | High     | GHSA-737v-mqg7-c878 (prototype pollution)                               | Resolved by `npm audit fix` |
| effect <3.20.0              | High     | GHSA-38f7-945m-qr2g (AsyncLocalStorage context contamination)           | Resolved by `npm audit fix` |
| hono <=4.12.6               | High     | GHSA-9r54-q6cx-xmh5 + 8 others (XSS, cache deception, IP bypass, etc.)  | Resolved by `npm audit fix` |
| lodash <=4.17.23            | High     | GHSA-xxjr-mmjv-4gpg + 2 others (prototype pollution, code injection)    | Resolved by `npm audit fix` |
| picomatch 4.0.0–4.0.3       | High     | GHSA-3v7f-55p6-f55p + GHSA-c2c7-rcm5-vvqj (glob matching bypass, ReDoS) | Resolved by `npm audit fix` |
| brace-expansion 4.0.0–5.0.4 | Moderate | GHSA-f886-m6hf-6m8v (ReDoS / memory exhaustion)                         | Resolved by `npm audit fix` |

## Upgrade Path — Major Dependencies

| Package    | Current       | Next Major                                               | Known Breaking Changes                                        |
| ---------- | ------------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| next       | 16.2.1        | (monitor nextjs.org/blog)                                | App Router API changes, server action changes                 |
| prisma     | 7.5.0         | (monitor prisma.io/changelog)                            | Migration format changes, client API                          |
| next-auth  | 5.0.0-beta.30 | stable v5                                                | Full rewrite from v4 — config, session, callbacks all changed |
| react      | 19.2.4        | (monitor react.dev/blog)                                 | Server components changes                                     |
| typescript | 5.9.3         | (monitor typescriptlang.org/docs/handbook/release-notes) | Stricter type checking                                        |
| zod        | 4.3.6         | (monitor zod.dev)                                        | Schema API changes                                            |
