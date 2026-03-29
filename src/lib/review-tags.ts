// src/lib/review-tags.ts
// ─── Review Strength Tags — computed from review text + rating ────────────────
// Pure function safe for client + server.

export interface ReviewTag {
  label: string;
  colour: string; // Tailwind classes for bg + text
}

const TAG_RULES: {
  keywords: RegExp;
  label: string;
  colour: string;
}[] = [
  {
    keywords: /\b(fast|quick|speedy|prompt|same.?day|next.?day)\b/i,
    label: "Fast shipping",
    colour: "bg-sky-50 text-sky-700",
  },
  {
    keywords:
      /\b(great.?condition|perfect.?condition|like.?new|mint|brand.?new|immaculate|pristine)\b/i,
    label: "Great condition",
    colour: "bg-emerald-50 text-emerald-700",
  },
  {
    keywords: /\b(well.?packed|packag|bubble.?wrap|protected|secure.?pack)\b/i,
    label: "Well packed",
    colour: "bg-violet-50 text-violet-700",
  },
  {
    keywords: /\b(friend(ly)?|helpful|kind|nice|pleasant|polite|lovely)\b/i,
    label: "Friendly seller",
    colour: "bg-amber-50 text-amber-700",
  },
  {
    keywords: /\b(communicat|responsive|repli|respond|messag|quick.?reply)\b/i,
    label: "Great communication",
    colour: "bg-indigo-50 text-indigo-700",
  },
  {
    keywords: /\b(bargain|deal|value|worth|cheap|affordable|good.?price)\b/i,
    label: "Great value",
    colour: "bg-rose-50 text-rose-700",
  },
  {
    keywords: /\b(as.?described|accurate|exactly|match|true.?to)\b/i,
    label: "As described",
    colour: "bg-teal-50 text-teal-700",
  },
  {
    keywords: /\b(recommend|again|return|come.?back|buy.?again)\b/i,
    label: "Would buy again",
    colour: "bg-orange-50 text-orange-700",
  },
];

/**
 * Generate strength tags from a review comment and rating.
 * Returns up to 3 tags (most relevant first).
 */
export function getReviewTags(comment: string, rating: number): ReviewTag[] {
  const tags: ReviewTag[] = [];

  for (const rule of TAG_RULES) {
    if (tags.length >= 3) break;
    if (rule.keywords.test(comment)) {
      tags.push({ label: rule.label, colour: rule.colour });
    }
  }

  // If the review is 5 stars and we have room, add a "Top rated" tag
  if (rating >= 5 && tags.length < 3) {
    tags.push({ label: "Top rated", colour: "bg-yellow-50 text-yellow-700" });
  }

  return tags;
}
