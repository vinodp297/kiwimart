// src/server/actions/auth/index.ts
// Barrel re-export — preserves the public API of the old auth.ts actions file.
// No "use server" here — each implementation file has its own directive.

export { registerUser } from "./register";
export {
  requestPasswordReset,
  resetPassword,
  resendVerificationEmail,
} from "./password";
