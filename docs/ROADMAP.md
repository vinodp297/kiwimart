# Product Roadmap

## Launched Features (Complete)

- Full marketplace loop (browse, list, buy, sell)
- Escrow payments via Stripe Connect
- Dispute resolution with auto-scoring
- Pickup OTP verification
- Seller verification tiers (L1/L2/L3)
- Performance tiers (Bronze/Silver/Gold)
- Two-way review system
- Real-time messaging via Pusher
- Admin panel with RBAC (7 roles)
- Mobile API with Bearer token auth

## In Testing Phase

- Architecture refactor (repository pattern, clean layers)
- God file decomposition (6 files split into focused components)
- Security hardening (CSP, HSTS, pwned passwords)

## Planned — Next 90 Days

- Saved search / search alerts
- Multi-seller cart
- Recently sold on seller profile
- Safe meeting spots for pickup
- Verified purchase badge on reviews
- Push notifications (iOS/Android)
- React Native mobile app (Expo)

## Planned — 6 Months

- Multi-country support (internationalisation)
- Country-specific tax engine (admin-configurable)
- Additional payment methods
- Seller analytics dashboard v2
- Third-party API marketplace

## Post-Launch Technical Improvements

- Move finance dashboard aggregates to dedicated metrics service with caching (see architectural review 27-Mar-2026)
- Centralize listing lifecycle operations (reserve/release/markSold) into a dedicated `listingLifecycleService` (see architectural review 27-Mar-2026)
- Add `PushToken` model to Prisma schema to persist device push tokens; replace in-memory logger stub in `/api/v1/notifications/push` with `db.pushToken.upsert()`
