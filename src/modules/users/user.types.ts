// src/modules/users/user.types.ts
// ─── User Domain Types ──────────────────────────────────────────────────────

export interface UpdateProfileInput {
  displayName: string
  region?: string
  bio?: string
}

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}

export interface RegisterInput {
  firstName: string
  lastName: string
  email: string
  password: string
  agreeMarketing: boolean
  turnstileToken?: string
}

export interface ResetPasswordInput {
  token: string
  password: string
}
