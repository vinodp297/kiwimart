"use server";
import { safeActionError } from "@/shared/errors";
// src/server/actions/blocks.ts
// ─── Block User Actions ───────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";
import { userRepository } from "@/modules/users/user.repository";
import { requireUser } from "@/server/lib/requireUser";
import type { ActionResult } from "@/types";

export async function blockUser(
  targetUserId: string,
): Promise<ActionResult<{ message: string }>> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Sign in to block users."),
    };
  }

  if (user.id === targetUserId) {
    return { success: false, error: "Cannot block yourself." };
  }

  const target = await userRepository.findBasicProfile(targetUserId);

  if (!target) {
    return { success: false, error: "User not found." };
  }

  await userRepository.upsertBlock(user.id, targetUserId);

  revalidatePath("/account/settings");
  return { success: true, data: { message: `${target.displayName} blocked.` } };
}

export async function unblockUser(
  targetUserId: string,
): Promise<ActionResult<void>> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    return {
      success: false,
      error: safeActionError(err, "Sign in to unblock users."),
    };
  }

  await userRepository.removeBlock(user.id, targetUserId);

  revalidatePath("/account/settings");
  return { success: true, data: undefined };
}
