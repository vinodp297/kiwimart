// src/modules/listings/listing.service.ts
// ─── Barrel — re-exports all listing sub-services ───────────────────────────
// All existing imports from this file continue to work unchanged.
//
// Sub-services:
//   listing-create.service.ts      — creation, drafts, API creation
//   listing-lifecycle.service.ts   — update, delete, status transitions
//   listing-engagement.service.ts  — watchlist, view tracking
//   listing-queries.service.ts     — read-only operations (browse, edit form)
//   listing-review.service.ts      — auto-review flow, price-drop notifications

// ── Re-export types ─────────────────────────────────────────────────────────

export type {
  CreateListingInput,
  SaveDraftInput,
  CreateResult,
  DraftResult,
} from "./listing-create.service";

export type {
  UpdateListingInput,
  UpdateResult,
} from "./listing-lifecycle.service";

// ── Import all functions ────────────────────────────────────────────────────

import {
  createListing,
  createListingViaApi,
  saveDraft,
} from "./listing-create.service";

import {
  deleteListing,
  updateListing,
  patchListingViaApi,
} from "./listing-lifecycle.service";

import { toggleWatch, getListingById } from "./listing-engagement.service";

import {
  getBrowseListings,
  getListingForEdit,
} from "./listing-queries.service";

// ── listingService — backwards-compatible object export ─────────────────────
// Callers use `listingService.createListing(...)` etc. This preserves that API.

export const listingService = {
  createListing,
  createListingViaApi,
  saveDraft,
  deleteListing,
  updateListing,
  patchListingViaApi,
  toggleWatch,
  getListingById,
  getBrowseListings,
  getListingForEdit,
};
