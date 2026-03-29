// src/lib/review-tags.ts
// ─── Review Strength Tags — user-selectable chips ────────────────────────────
// Maps the ReviewTagType enum to display labels and colours.
// Pure function safe for client + server.

/** Matches the Prisma ReviewTagType enum */
export type ReviewTagType =
  | "FAST_SHIPPING"
  | "GREAT_PACKAGING"
  | "ACCURATE_DESCRIPTION"
  | "QUICK_COMMUNICATION"
  | "FAIR_PRICING"
  | "AS_DESCRIBED";

export const REVIEW_TAG_OPTIONS: {
  value: ReviewTagType;
  label: string;
  emoji: string;
  colour: string;
}[] = [
  {
    value: "FAST_SHIPPING",
    label: "Fast shipping",
    emoji: "\u{1F680}",
    colour: "bg-sky-50 text-sky-700 border-sky-200",
  },
  {
    value: "GREAT_PACKAGING",
    label: "Great packaging",
    emoji: "\u{1F4E6}",
    colour: "bg-violet-50 text-violet-700 border-violet-200",
  },
  {
    value: "ACCURATE_DESCRIPTION",
    label: "Accurate description",
    emoji: "\u2705",
    colour: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  {
    value: "QUICK_COMMUNICATION",
    label: "Quick comms",
    emoji: "\u{1F4AC}",
    colour: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
  {
    value: "FAIR_PRICING",
    label: "Fair pricing",
    emoji: "\u{1F4B0}",
    colour: "bg-amber-50 text-amber-700 border-amber-200",
  },
  {
    value: "AS_DESCRIBED",
    label: "Item as described",
    emoji: "\u{1F3AF}",
    colour: "bg-teal-50 text-teal-700 border-teal-200",
  },
];

/** Get display config for a tag type */
export function getTagConfig(tag: ReviewTagType) {
  return REVIEW_TAG_OPTIONS.find((o) => o.value === tag);
}
