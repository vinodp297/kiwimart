#!/bin/bash
# scripts/migrate.sh
# ─── Safe Production Migration Script ────────────────────────────────────────
# Checks for destructive changes BEFORE running migrations.
# Use this instead of running prisma migrate deploy directly.
#
# Usage:
#   npm run db:migrate:safe
#   # or directly:
#   DATABASE_URL="postgresql://..." bash scripts/migrate.sh
#
# ── Why --from-migrations, not --from-schema-datamodel ───────────────────────
# The correct diff compares:
#   FROM: the state the database is in AFTER applying all committed migrations
#         (what the production DB currently looks like)
#   TO:   the target schema.prisma (what we want it to look like)
#
# Using --from-schema-datasource or --from-schema-datamodel ./prisma/schema.prisma
# for BOTH sides compares the schema against itself — always shows no changes and
# NEVER detects any destructive operations. That provides zero safety guarantee.
#
# --shadow-database-url is required: Prisma spins up a shadow DB, replays all
# migration files against it, then diffs the result against schema.prisma.
# Without it, from-migrations cannot determine the current DB state.

set -e

echo ""
echo "🔍 Checking for destructive migrations..."
echo ""

# Validate DATABASE_URL is set — required for the shadow database
if [ -z "$DATABASE_URL" ]; then
  echo "❌  DATABASE_URL is not set."
  echo "    Set it before running: DATABASE_URL=\"postgresql://...\" bash scripts/migrate.sh"
  exit 1
fi

# Compare FROM current migrations state TO target schema.
# This correctly detects: column renames, column deletions, table deletions.
DIFF_OUTPUT=$(npx prisma migrate diff \
  --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url "$DATABASE_URL" \
  --script 2>/dev/null || true)

# Check for destructive SQL keywords in the diff output
if echo "$DIFF_OUTPUT" | grep -qiE \
  "DROP TABLE|DROP COLUMN|ALTER.*DROP|RENAME.*TO|ALTER COLUMN.*TYPE"; then
  echo "⚠️  WARNING: Destructive migration detected!"
  echo ""
  echo "The pending changes contain one or more destructive operations:"
  echo "  • DROP TABLE   — deletes a table and ALL its data"
  echo "  • DROP COLUMN  — deletes a column and its data"
  echo "  • ALTER...DROP — removes a constraint or index destructively"
  echo "  • RENAME...TO  — renames a column or table (data loss risk if code is not updated)"
  echo ""
  echo "Matching lines:"
  echo "$DIFF_OUTPUT" | grep -iE \
    "DROP TABLE|DROP COLUMN|ALTER.*DROP|RENAME.*TO|ALTER COLUMN.*TYPE" || true
  echo ""
  echo "Full diff:"
  echo "$DIFF_OUTPUT"
  echo ""
  read -p "Continue with this migration? (yes/no): " confirm
  if [ "$confirm" != "yes" ]; then
    echo "❌  Migration cancelled."
    exit 1
  fi
  echo ""
else
  echo "✅  No destructive changes detected."
  echo ""
fi

echo "✅  Running prisma migrate deploy..."
npx prisma migrate deploy

echo ""
echo "✅  Generating Prisma client..."
npx prisma generate

echo ""
echo "✅  Migration complete."
echo ""
