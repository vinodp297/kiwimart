// src/server/services/listing-review/banned-keywords.ts
// ─── Banned & Risk Keyword Lists for Listing Auto-Review ───────────────────
// BANNED_KEYWORDS → auto-reject (prohibited content)
// RISK_KEYWORDS   → adds risk score but does NOT auto-reject

/**
 * Keywords that cause an immediate auto-reject.
 * Matched case-insensitively as whole words against title + description.
 */
export const BANNED_KEYWORDS: string[] = [
  // Weapons
  "gun",
  "firearm",
  "pistol",
  "rifle",
  "ammunition",
  "ammo",
  "silencer",
  "suppressor",
  "explosive",
  "grenade",
  "bomb",

  // Drugs
  "cocaine",
  "meth",
  "heroin",
  "fentanyl",
  "mdma",
  "ecstasy",
  "narcotics",

  // Counterfeit signals
  "replica",
  "fake",
  "knockoff",
  "counterfeit",
  "imitation",
  "copy of",
  "bootleg",

  // Prohibited services
  "escort",
  "prostitution",
  "adult service",

  // Scam signals
  "western union",
  "moneygram",
  "wire transfer only",
  "gift card payment",
  "bitcoin payment only",

  // Personal contact bypass
  "whatsapp me",
  "call me on",
  "text me on",
  "dm me",
  "message me outside",
];

/**
 * Keywords that add risk score but do NOT auto-reject.
 * Some NZ regions have legal uses for cannabis-related products.
 */
export const RISK_KEYWORDS: string[] = [
  "cannabis",
  "weed",
  "marijuana",
  "drug",
];
