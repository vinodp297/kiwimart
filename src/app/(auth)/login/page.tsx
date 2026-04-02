"use client";
// src/app/(auth)/login/page.tsx
// ─── Login Page ───────────────────────────────────────────────────────────────
// Cloudflare Turnstile site key is fetched at RUNTIME from /api/auth/turnstile-config
// instead of relying on NEXT_PUBLIC_ build-time env vars (which can be empty if
// the env var wasn't set during `next build`).
//
// Turnstile flow:
//   1. On mount, fetch /api/auth/turnstile-config to get the site key.
//   2. If active, load the Turnstile script and render the widget.
//   3. On submit, call execute() → await callback → pass token to signIn().
//   4. Server ALWAYS verifies the token in production (fail-closed).

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import Script from "next/script";
import { Button, Input, Alert, Divider } from "@/components/ui/primitives";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (widgetId: string) => void;
      execute: (widgetId: string) => void;
      getResponse: (widgetId: string) => string | undefined;
    };
  }
}

export default function LoginPage() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("from") ?? "/dashboard/buyer";
  const errorParam = searchParams.get("error");
  const registeredParam = searchParams.get("registered");
  const verifiedParam = searchParams.get("verified");
  const prefillEmail = searchParams.get("email") ?? "";

  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(
    errorParam === "CredentialsSignin"
      ? "Incorrect email or password. Please try again."
      : errorParam === "AccessDenied"
        ? "Your account has been suspended. Contact support."
        : "",
  );
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});

  // Turnstile state — fetched at runtime, not baked at build time
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [turnstileReady, setTurnstileReady] = useState(false);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const tokenResolverRef = useRef<((token: string | null) => void) | null>(
    null,
  );

  // Fetch Turnstile site key at runtime from the server
  useEffect(() => {
    fetch("/api/auth/turnstile-config")
      .then((r) => r.json())
      .then((data: { siteKey: string | null; active: boolean }) => {
        if (data.active && data.siteKey) {
          setTurnstileSiteKey(data.siteKey);
        }
      })
      .catch(() => {
        // Config fetch failed — Turnstile stays disabled, server will reject
      });
  }, []);

  // Initialize the Turnstile widget after the script loads
  const initializeTurnstileWidget = useCallback(() => {
    if (!turnstileRef.current || !window.turnstile || !turnstileSiteKey) return;
    widgetId.current = window.turnstile.render(turnstileRef.current, {
      sitekey: turnstileSiteKey,
      theme: "light",
      execution: "execute",
      appearance: "interaction-only",
      callback: (token: string) => {
        if (tokenResolverRef.current) {
          tokenResolverRef.current(token);
          tokenResolverRef.current = null;
        }
      },
      "error-callback": () => {
        if (tokenResolverRef.current) {
          tokenResolverRef.current(null);
          tokenResolverRef.current = null;
        }
      },
      "expired-callback": () => {
        /* no-op in execute mode */
      },
    });
    setTurnstileReady(true);
  }, [turnstileSiteKey]);

  function validate() {
    const errs: typeof fieldErrors = {};
    if (!email) errs.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errs.email = "Enter a valid email.";
    if (!password) errs.password = "Password is required.";
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    setError("");
    setLoading(true);

    // ── Turnstile: execute challenge at submit time ────────────────────────────
    let challengeToken = "";

    if (turnstileSiteKey) {
      if (!widgetId.current || !turnstileReady) {
        setError("Security check not ready — please try again in a moment.");
        setLoading(false);
        return;
      }

      const token = await new Promise<string | null>((resolve) => {
        tokenResolverRef.current = resolve;
        window.turnstile?.execute(widgetId.current!);
        setTimeout(() => {
          if (tokenResolverRef.current) {
            tokenResolverRef.current = null;
            resolve(null);
          }
        }, 10_000);
      });

      if (!token) {
        setError("Security check failed or timed out — please try again.");
        if (widgetId.current) window.turnstile?.reset(widgetId.current);
        setLoading(false);
        return;
      }

      challengeToken = token;
    }

    try {
      const result = await signIn("credentials", {
        email: email.toLowerCase().trim(),
        password,
        turnstileToken: challengeToken,
        rememberMe: String(rememberMe),
        redirect: false,
      });

      if (!result?.ok || result?.error) {
        setError("Incorrect email or password. Please try again.");
        if (widgetId.current) window.turnstile?.reset(widgetId.current);
        setLoading(false);
        return;
      }

      // Check if MFA verification is required
      const sessionRes = await fetch("/api/auth/session");
      const sessionData = await sessionRes.json();
      if (sessionData?.user?.mfaPending) {
        window.location.href = "/mfa-verify";
        return;
      }

      const fromParam = searchParams.get("from");
      const isFirstLogin = !!verifiedParam || !!registeredParam;
      window.location.href =
        fromParam || (isFirstLogin ? "/welcome" : "/dashboard/buyer");
    } catch {
      setError(
        "We couldn't sign you in. Please check your internet connection and try again.",
      );
      if (widgetId.current) window.turnstile?.reset(widgetId.current);
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#FAFAF8] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-[420px]">
        <Link
          href="/"
          className="flex items-center justify-center gap-2 mb-8 group"
        >
          <div className="w-8 h-8 rounded-full bg-[#141414] flex items-center justify-center text-[#D4A843] text-sm font-bold group-hover:bg-[#D4A843] group-hover:text-[#141414] transition-colors">
            K
          </div>
          <span className="font-[family-name:var(--font-playfair)] text-[1.3rem] text-[#141414] tracking-tight">
            Kiwi<em className="not-italic text-[#D4A843]">Mart</em>
          </span>
        </Link>

        <div className="bg-white rounded-2xl border border-[#E3E0D9] shadow-sm p-8">
          <h1 className="font-[family-name:var(--font-playfair)] text-[1.5rem] font-semibold text-[#141414] mb-1.5">
            Welcome back
          </h1>
          <p className="text-[13.5px] text-[#73706A] mb-6">
            Sign in to your {process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"}{" "}
            account
          </p>

          {registeredParam && !verifiedParam && (
            <div className="bg-[#FFF9EC] border border-[#D4A843]/40 rounded-xl p-3 text-[13px] text-[#141414] mb-4 flex items-start gap-2">
              <span>📧</span>
              <span>
                Account created! Check your email to verify your address, then
                sign in.
              </span>
            </div>
          )}

          {verifiedParam && (
            <div className="bg-[#F0FDF4] border border-[#16a34a]/30 rounded-xl p-3 text-[13px] text-[#141414] mb-4 flex items-start gap-2">
              <span>✅</span>
              <span>Email verified! You can now sign in.</span>
            </div>
          )}

          {error && (
            <Alert variant="error" className="mb-5">
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <Input
              label="Email address"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setFieldErrors((f) => ({ ...f, email: undefined }));
              }}
              placeholder="you@example.co.nz"
              autoComplete="email"
              required
              error={fieldErrors.email}
            />

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[12.5px] font-semibold text-[#141414]">
                  Password <span className="text-red-500">*</span>
                </label>
                <Link
                  href="/forgot-password"
                  className="text-[12px] text-[#D4A843] hover:text-[#B8912E] transition-colors"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setFieldErrors((f) => ({ ...f, password: undefined }));
                }}
                placeholder="Your password"
                autoComplete="current-password"
                required
                error={fieldErrors.password}
                rightAddon={
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? "Hide password" : "Show password"}
                    className="hover:text-[#141414] transition-colors"
                  >
                    {showPw ? (
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                }
              />
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded border-[#C9C5BC] accent-[#D4A843] cursor-pointer"
              />
              <span className="text-[13px] text-[#73706A]">
                Keep me signed in for 30 days
              </span>
            </label>

            {/* Turnstile widget container — only shown when runtime config says active */}
            {turnstileSiteKey && <div ref={turnstileRef} className="mt-1" />}

            <Button
              type="submit"
              variant="primary"
              fullWidth
              size="lg"
              loading={loading}
              className="mt-2"
            >
              Sign in
            </Button>
          </form>

          <Divider label="or" className="my-5" />

          <button
            type="button"
            onClick={() => signIn("google", { callbackUrl: redirectTo })}
            className="w-full h-11 rounded-xl border border-[#C9C5BC] flex items-center justify-center gap-3 text-[13.5px] font-medium text-[#141414] hover:bg-[#F8F7F4] transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </button>

          <p className="mt-6 text-center text-[13px] text-[#73706A]">
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="font-semibold text-[#D4A843] hover:text-[#B8912E] transition-colors"
            >
              Register free
            </Link>
          </p>
        </div>

        <p className="mt-5 text-center text-[11.5px] text-[#C9C5BC]">
          Protected by {process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"}&apos;s
          secure sign-in. By signing in you agree to our{" "}
          <Link
            href="/terms"
            className="underline hover:text-[#73706A] transition-colors"
          >
            Terms of Service
          </Link>
          .
        </p>
      </div>

      {/* Turnstile script — only loaded when runtime config provides a key */}
      {turnstileSiteKey && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
          onLoad={initializeTurnstileWidget}
        />
      )}
    </main>
  );
}
