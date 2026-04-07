"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/onboarding.ts
// ─── Onboarding Server Actions ────────────────────────────────────────────────

import { requireUser } from "@/server/lib/requireUser";
import { userRepository } from "@/modules/users/user.repository";
import { getListValues } from "@/lib/dynamic-lists";
import type { ActionResult } from "@/types";
import {
  completeOnboardingSchema,
  type CompleteOnboardingInput,
} from "@/server/validators";

export type { CompleteOnboardingInput };

// ── completeOnboarding ────────────────────────────────────────────────────────

export async function completeOnboarding(
  input: CompleteOnboardingInput,
): Promise<ActionResult<void>> {
  try {
    const user = await requireUser();

    const parsed = completeOnboardingSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: "Please complete all required onboarding fields.",
      };
    }

    const { intent, region } = parsed.data;

    const validRegions = await getListValues("NZ_REGIONS");

    await userRepository.update(user.id, {
      isOnboardingCompleted: true,
      onboardingIntent: intent,
      ...(region && validRegions.includes(region) ? { region } : {}),
    });

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't complete your onboarding. Please try again.",
      ),
    };
  }
}

// ── getOnboardingStatus ───────────────────────────────────────────────────────

export interface OnboardingStatus {
  isOnboardingCompleted: boolean;
  onboardingIntent: string | null;
  region: string | null;
  bio: string | null;
  displayName: string;
  emailVerified: Date | null;
  isStripeOnboarded: boolean;
}

export async function getOnboardingStatus(): Promise<
  ActionResult<OnboardingStatus>
> {
  try {
    const authedUser = await requireUser();

    const user = await userRepository.findOnboardingStatus(authedUser.id);

    if (!user) {
      return { success: false, error: "User not found." };
    }

    return { success: true, data: user };
  } catch (err) {
    return {
      success: false,
      error: safeActionError(
        err,
        "We couldn't load your onboarding status. Please refresh the page.",
      ),
    };
  }
}
