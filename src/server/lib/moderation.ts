// src/server/lib/moderation.ts
// ─── Content Moderation ──────────────────────────────────────────────────────
// Runs BEFORE content is saved to the database. All user-generated text
// (listings, messages, reviews, reports) passes through moderateText().
//
// Strategy: layered approach
//   1. Keyword blocklist (instant reject — slurs, scam patterns)
//   2. Pattern matching (phone/email extraction in messages — warn sellers)
//   3. Future: ML-based classification via external API
//
// Returns a ModerationResult — callers decide whether to block or flag.

export interface ModerationResult {
  /** Whether the content is allowed to be saved */
  allowed: boolean;
  /** If not allowed, the reason to show the user */
  reason?: string;
  /** Whether the content should be flagged for admin review (saved but flagged) */
  flagged: boolean;
  /** Internal flag reason for admin dashboard */
  flagReason?: string;
  /** Matched patterns (never exposed to user — admin only) */
  matches: string[];
}

// ── Blocklists ────────────────────────────────────────────────────────────────

// Words that instantly block content (hate speech, scam keywords)
const BLOCKED_PATTERNS: RegExp[] = [
  // Scam patterns
  /\bwire\s*transfer\b/i,
  /\bwestern\s*union\b/i,
  /\bmoney\s*gram\b/i,
  /\bbitcoin\s*(only|payment)\b/i,
  /\bcrypto\s*only\b/i,
  /\bpay\s*outside\b/i,
  /\bdirect\s*deposit\s*only\b/i,
  // Prohibited items (NZ law)
  /\b(buy|sell|trade)\s*(gun|firearm|weapon)s?\b/i,
  /\bcounterfeit\b/i,
  /\bstolen\s*(goods?|item|merch)/i,
];

// Patterns that flag for review but don't block
const FLAGGED_PATTERNS: RegExp[] = [
  // Contact info in messages (potential off-platform transaction)
  /\b0\d{2}[\s-]?\d{3,4}[\s-]?\d{3,4}\b/, // NZ phone number
  /\b\d{2}[\s-]?\d{3,4}[\s-]?\d{4}\b/, // Generic phone
  /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/, // Email address
  // Urgency/pressure tactics
  /\b(act\s*now|limited\s*time|hurry|urgent)\b/i,
  // Cash only requests
  /\bcash\s*only\b/i,
];

// ── Moderate Text ─────────────────────────────────────────────────────────────

/**
 * Moderate user-generated text content before saving to database.
 * Call this in every server action that saves user text.
 *
 * @param text - The text to moderate
 * @param context - Where the text is being used ('listing' | 'message' | 'review' | 'report')
 * @returns ModerationResult
 *
 * @example
 * const mod = moderateText(input.description, 'listing');
 * if (!mod.allowed) {
 *   return { success: false, error: mod.reason ?? 'Content not allowed.' };
 * }
 */
export function moderateText(
  text: string,
  context: 'listing' | 'message' | 'review' | 'report' | 'bio'
): ModerationResult {
  if (!text || text.trim().length === 0) {
    return { allowed: true, flagged: false, matches: [] };
  }

  const matches: string[] = [];
  let blocked = false;
  let flagged = false;
  let reason: string | undefined;
  let flagReason: string | undefined;

  // 1. Check blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      blocked = true;
      matches.push(`blocked:${match[0]}`);
      reason = 'Your content contains prohibited language or patterns. Please review our community guidelines.';
    }
  }

  if (blocked) {
    return { allowed: false, reason, flagged: true, flagReason: 'blocked_content', matches };
  }

  // 2. Check flagged patterns (context-sensitive)
  for (const pattern of FLAGGED_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      flagged = true;
      matches.push(`flagged:${match[0]}`);
      // Only flag contact info in messages (not in listings where email might be okay)
      if (context === 'message') {
        flagReason = 'contact_info_in_message';
      } else {
        flagReason = 'suspicious_pattern';
      }
    }
  }

  // 3. Check for excessive caps (shouting)
  const upperRatio = text.replace(/[^a-zA-Z]/g, '').length > 0
    ? (text.replace(/[^A-Z]/g, '').length / text.replace(/[^a-zA-Z]/g, '').length)
    : 0;
  if (upperRatio > 0.7 && text.length > 20) {
    flagged = true;
    matches.push('flagged:excessive_caps');
    flagReason = flagReason ?? 'excessive_caps';
  }

  // 4. Check for repeated characters (spam indicator)
  if (/(.)\1{9,}/i.test(text)) {
    flagged = true;
    matches.push('flagged:repeated_chars');
    flagReason = flagReason ?? 'repeated_characters';
  }

  return { allowed: true, flagged, flagReason, matches };
}

/**
 * Sanitize text by removing potentially dangerous HTML/script content.
 * Applied after moderation, before database save.
 */
export function sanitizeText(text: string): string {
  return text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}
