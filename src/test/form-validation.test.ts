// src/test/form-validation.test.ts
// ─── Client-Side Form Validation Tests ───────────────────────────────────────
//
// Tests the Zod schemas reused for client-side inline validation on:
//   - Registration form (email format, password strength, submit guard)
//   - Login form (empty/invalid email on submit)
//   - Create listing form (price validation)
//
// All tests are pure schema logic — no React, no jsdom required.

import { describe, it, expect } from "vitest";
import {
  registerSchema,
  loginSchema,
  createListingSchema,
} from "@/server/validators";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Mirror of validateFieldOnBlur used in register/page.tsx */
function validateRegisterField(
  name: string,
  value: unknown,
  password?: string,
): string | null {
  if (name === "confirmPassword") {
    const str = typeof value === "string" ? value : "";
    if (!str.trim()) return "Please confirm your password";
    if (password !== undefined && str !== password)
      return "Passwords do not match";
    return null;
  }
  const shape = registerSchema.shape;
  if (!(name in shape)) return null;
  const fieldSchema = shape[name as keyof typeof shape] as {
    safeParse: (v: unknown) => {
      success: boolean;
      error: { issues: Array<{ message: string }> };
    };
  };
  const result = fieldSchema.safeParse(value);
  if (!result.success)
    return result.error.issues[0]?.message ?? "Please check this field";
  return null;
}

/** Mirror of validate() used in login/page.tsx */
function validateLoginFields(email: string, password: string) {
  const errors: { email?: string; password?: string } = {};
  const emailResult = loginSchema.shape.email.safeParse(email);
  if (!emailResult.success)
    errors.email =
      emailResult.error.issues[0]?.message ?? "Enter a valid email address";
  const pwResult = loginSchema.shape.password.safeParse(password);
  if (!pwResult.success)
    errors.password =
      pwResult.error.issues[0]?.message ?? "Password is required";
  return errors;
}

// ─── 1. Registration — email validation on blur ───────────────────────────────

describe("Registration form — email blur validation", () => {
  it("returns null for a valid NZ email address", () => {
    expect(validateRegisterField("email", "jane@example.co.nz")).toBeNull();
  });

  it("returns an error for a plainly invalid email", () => {
    const msg = validateRegisterField("email", "not-an-email");
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/valid email/i);
  });

  it("returns an error for an empty email", () => {
    const msg = validateRegisterField("email", "");
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/required/i);
  });

  it("returns an error for email missing the domain part", () => {
    const msg = validateRegisterField("email", "jane@");
    expect(msg).toBeTruthy();
  });

  it("accepts mixed-case email (schema normalises to lowercase)", () => {
    // The schema transforms via .toLowerCase() so it parses fine
    expect(validateRegisterField("email", "JANE@EXAMPLE.CO.NZ")).toBeNull();
  });
});

// ─── 2. Registration — password strength on blur ─────────────────────────────

describe("Registration form — password blur validation", () => {
  it("returns null for a strong password meeting all requirements", () => {
    expect(validateRegisterField("password", "StrongPass1!")).toBeNull();
  });

  it("rejects a password shorter than 12 characters", () => {
    const msg = validateRegisterField("password", "Short1A");
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/12 characters/i);
  });

  it("rejects a password with no uppercase letter", () => {
    const msg = validateRegisterField("password", "alllowercase123");
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/uppercase/i);
  });

  it("rejects a password with no lowercase letter", () => {
    const msg = validateRegisterField("password", "ALLUPPERCASE123");
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/lowercase/i);
  });

  it("rejects a password with no number", () => {
    const msg = validateRegisterField("password", "NoNumbersHereAtAll");
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/number/i);
  });

  it("rejects an empty password", () => {
    const msg = validateRegisterField("password", "");
    expect(msg).toBeTruthy();
  });

  it("accepts exactly 12 characters when all rules met", () => {
    expect(validateRegisterField("password", "Abcdefghij1k")).toBeNull();
  });
});

// ─── 3. Registration — submit guard: client validation catches errors ─────────

describe("Registration form — client-side submit guard", () => {
  /** Mirrors the full client-side submit validation from register/page.tsx */
  function runSubmitValidation(fields: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    confirm: string;
    agreeTerms: boolean;
  }) {
    const clientErrors: Record<string, string[]> = {};
    const shape = registerSchema.shape;

    for (const field of [
      "firstName",
      "lastName",
      "email",
      "password",
    ] as const) {
      const fieldSchema = shape[field] as {
        safeParse: (v: unknown) => {
          success: boolean;
          error: { issues: Array<{ message: string }> };
        };
      };
      const result = fieldSchema.safeParse(fields[field]);
      if (!result.success) {
        clientErrors[field] = [
          result.error.issues[0]?.message ?? "Please check this field",
        ];
      }
    }

    if (!fields.confirm.trim()) {
      clientErrors.confirmPassword = ["Please confirm your password"];
    } else if (fields.confirm !== fields.password) {
      clientErrors.confirmPassword = ["Passwords do not match"];
    }

    if (!fields.agreeTerms) {
      clientErrors.agreeTerms = ["You must agree to the terms to continue"];
    }

    return clientErrors;
  }

  it("returns no errors for a fully valid submission", () => {
    const errs = runSubmitValidation({
      firstName: "Jane",
      lastName: "Smith",
      email: "jane@example.co.nz",
      password: "StrongPass1!",
      confirm: "StrongPass1!",
      agreeTerms: true,
    });
    expect(Object.keys(errs)).toHaveLength(0);
  });

  it("blocks submission when email is invalid", () => {
    const errs = runSubmitValidation({
      firstName: "Jane",
      lastName: "Smith",
      email: "bad-email",
      password: "StrongPass1!",
      confirm: "StrongPass1!",
      agreeTerms: true,
    });
    expect(errs.email).toBeDefined();
    expect(Object.keys(errs).length).toBeGreaterThan(0);
  });

  it("blocks submission when passwords do not match", () => {
    const errs = runSubmitValidation({
      firstName: "Jane",
      lastName: "Smith",
      email: "jane@example.co.nz",
      password: "StrongPass1!",
      confirm: "DifferentPass1!",
      agreeTerms: true,
    });
    expect(errs.confirmPassword).toBeDefined();
    expect(errs.confirmPassword?.[0]).toMatch(/do not match/i);
  });

  it("blocks submission when password is too weak", () => {
    const errs = runSubmitValidation({
      firstName: "Jane",
      lastName: "Smith",
      email: "jane@example.co.nz",
      password: "weak",
      confirm: "weak",
      agreeTerms: true,
    });
    expect(errs.password).toBeDefined();
  });

  it("blocks submission when terms are not agreed", () => {
    const errs = runSubmitValidation({
      firstName: "Jane",
      lastName: "Smith",
      email: "jane@example.co.nz",
      password: "StrongPass1!",
      confirm: "StrongPass1!",
      agreeTerms: false,
    });
    expect(errs.agreeTerms).toBeDefined();
  });

  it("blocks submission when firstName is empty", () => {
    const errs = runSubmitValidation({
      firstName: "",
      lastName: "Smith",
      email: "jane@example.co.nz",
      password: "StrongPass1!",
      confirm: "StrongPass1!",
      agreeTerms: true,
    });
    expect(errs.firstName).toBeDefined();
  });

  it("catches multiple errors at once", () => {
    const errs = runSubmitValidation({
      firstName: "",
      lastName: "",
      email: "bad",
      password: "weak",
      confirm: "different",
      agreeTerms: false,
    });
    // firstName, lastName, email, password, confirmPassword, agreeTerms
    expect(Object.keys(errs).length).toBeGreaterThanOrEqual(4);
  });
});

// ─── 4. Login form — errors on empty email submit ────────────────────────────

describe("Login form — email validation on submit", () => {
  it("returns an error when email is empty", () => {
    const errs = validateLoginFields("", "somepassword");
    expect(errs.email).toBeTruthy();
    expect(errs.email).toMatch(/required/i);
  });

  it("returns an error when email format is invalid", () => {
    const errs = validateLoginFields("notanemail", "somepassword");
    expect(errs.email).toBeTruthy();
    expect(errs.email).toMatch(/valid email/i);
  });

  it("returns no email error for a valid email", () => {
    const errs = validateLoginFields("user@example.co.nz", "somepassword");
    expect(errs.email).toBeUndefined();
  });

  it("returns a password error when password is empty", () => {
    const errs = validateLoginFields("user@example.co.nz", "");
    expect(errs.password).toBeTruthy();
    expect(errs.password).toMatch(/required/i);
  });

  it("returns no errors for valid email and password", () => {
    const errs = validateLoginFields("user@example.co.nz", "anypassword");
    expect(errs.email).toBeUndefined();
    expect(errs.password).toBeUndefined();
  });

  it("returns both errors when both fields are empty", () => {
    const errs = validateLoginFields("", "");
    expect(errs.email).toBeTruthy();
    expect(errs.password).toBeTruthy();
  });
});

// ─── 5. Create listing — price must be a positive number ─────────────────────

describe("Create listing form — price blur validation", () => {
  const priceSchema = createListingSchema.shape.price;

  it("accepts a valid positive price", () => {
    const result = priceSchema.safeParse("49.99");
    expect(result.success).toBe(true);
  });

  it("accepts a price of 1", () => {
    const result = priceSchema.safeParse("1");
    expect(result.success).toBe(true);
  });

  it("rejects a price of zero", () => {
    const result = priceSchema.safeParse("0");
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.message).toMatch(/greater than/i);
  });

  it("rejects a negative price", () => {
    const result = priceSchema.safeParse("-10");
    expect(result.success).toBe(false);
  });

  it("rejects a non-numeric string", () => {
    const result = priceSchema.safeParse("abc");
    expect(result.success).toBe(false);
  });

  it("rejects an empty string", () => {
    const result = priceSchema.safeParse("");
    expect(result.success).toBe(false);
  });

  it("rejects a price exceeding the $100,000 maximum", () => {
    const result = priceSchema.safeParse("100001");
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.message).toMatch(/100,000/i);
  });

  it("accepts the maximum allowed price of $100,000", () => {
    const result = priceSchema.safeParse("100000");
    expect(result.success).toBe(true);
  });

  it("rejects numeric 0 (not just string)", () => {
    const result = priceSchema.safeParse(0);
    expect(result.success).toBe(false);
  });
});

// ─── 6. confirmPassword blur validation ──────────────────────────────────────

describe("Registration form — confirmPassword blur validation", () => {
  it("returns an error when confirmPassword is empty", () => {
    const msg = validateRegisterField("confirmPassword", "", "StrongPass1!");
    expect(msg).toBe("Please confirm your password");
  });

  it("returns an error when confirmPassword does not match password", () => {
    const msg = validateRegisterField(
      "confirmPassword",
      "WrongPass1!",
      "StrongPass1!",
    );
    expect(msg).toBe("Passwords do not match");
  });

  it("returns null when confirmPassword matches password", () => {
    const msg = validateRegisterField(
      "confirmPassword",
      "StrongPass1!",
      "StrongPass1!",
    );
    expect(msg).toBeNull();
  });
});

// ─── 7. First/last name blur validation ──────────────────────────────────────

describe("Registration form — name field blur validation", () => {
  it("accepts a normal first name", () => {
    expect(validateRegisterField("firstName", "Jane")).toBeNull();
  });

  it("rejects an empty first name", () => {
    const msg = validateRegisterField("firstName", "");
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/required/i);
  });

  it("rejects a first name exceeding 50 characters", () => {
    const msg = validateRegisterField("firstName", "A".repeat(51));
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/too long/i);
  });

  it("accepts a whitespace-only last name as valid (trim is a transform, not a pre-validation)", () => {
    // Zod's .trim() is a transform applied after min(1) — "   " has length 3
    // so it satisfies min(1).  The server action's registerUser will receive
    // the trimmed value and may reject it, but the schema safeParse passes.
    const msg = validateRegisterField("lastName", "   ");
    expect(msg).toBeNull();
  });
});
