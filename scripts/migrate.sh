#!/bin/bash
# scripts/migrate.sh
# ─── Safe Production Migration Script ────────────────────────────────────────
# Checks for destructive changes before running migrations.
# Use this instead of running prisma migrate deploy directly.
#
# Usage:
#   npm run db:migrate:safe
#   # or directly:
#   bash scripts/migrate.sh

set -e

echo ""
echo "🔍 Checking for destructive migrations..."
echo ""

# Attempt to detect destructive SQL statements in the pending migration diff
DIFF_OUTPUT=$(npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script 2>/dev/null || true)

if echo "$DIFF_OUTPUT" | grep -qiE "DROP TABLE|DROP COLUMN|ALTER COLUMN.*DROP|ALTER TABLE.*DROP"; then
  echo "⚠️  WARNING: Destructive migration detected!"
  echo ""
  echo "The migration contains one or more of:"
  echo "  • DROP TABLE"
  echo "  • DROP COLUMN"
  echo "  • ALTER COLUMN ... DROP"
  echo ""
  echo "$DIFF_OUTPUT" | grep -iE "DROP TABLE|DROP COLUMN|ALTER COLUMN.*DROP|ALTER TABLE.*DROP" || true
  echo ""
  read -p "Continue with this migration? (yes/no): " confirm
  if [ "$confirm" != "yes" ]; then
    echo "❌  Migration cancelled."
    exit 1
  fi
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
