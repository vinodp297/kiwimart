import { z } from "zod";

export const tokenRequestSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Enter a valid email address")
    .max(254)
    .toLowerCase()
    .trim(),
  password: z.string().min(1, "Password is required").max(128),
});
export type TokenRequestInput = z.infer<typeof tokenRequestSchema>;
