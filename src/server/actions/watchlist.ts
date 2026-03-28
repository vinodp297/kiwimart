'use server'
import { safeActionError } from '@/shared/errors'
// src/server/actions/watchlist.ts
// ─── Watchlist Actions ──────────────────────────────────────────────────────

import { z } from 'zod'
import db from '@/lib/db'
import { requireUser } from '@/server/lib/requireUser'
import type { ActionResult } from '@/types'

const TogglePriceAlertSchema = z.object({
  listingId: z.string().min(1),
  enabled: z.boolean(),
})

export async function togglePriceAlert(
  raw: unknown
): Promise<ActionResult<{ enabled: boolean }>> {
  try {
    const user = await requireUser()
    const parsed = TogglePriceAlertSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { listingId, enabled } = parsed.data

    const item = await db.watchlistItem.findFirst({
      where: { userId: user.id, listingId },
      select: { id: true },
    })

    if (!item) return { success: false, error: 'Item not in your watchlist.' }

    await db.watchlistItem.update({
      where: { id: item.id },
      data: { priceAlertEnabled: enabled },
    })

    return { success: true, data: { enabled } }
  } catch (err) {
    return { success: false, error: safeActionError(err) }
  }
}
