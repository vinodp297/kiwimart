// src/modules/users/user.repository.ts (barrel — under 50 lines)
// ─── Re-exports from focused sub-files ───────────────────────────────────────

export type {
  DashboardUser,
  UserPublicProfile,
  UserForAuth,
  UserForSeller,
} from "./user-query.repository";

import { userQueryRepository } from "./user-query.repository";
import { userAuthRepository } from "./user-auth.repository";
import { userMutationRepository } from "./user-mutation.repository";

export const userRepository = {
  ...userQueryRepository,
  ...userAuthRepository,
  ...userMutationRepository,
};
