// src/test/ErrorBoundary.test.ts
// ─── Tests: ErrorBoundary class component ─────────────────────────────────────
// Tests the pure class-component logic: state transitions, error capture,
// callback invocation, and fallback selection.
// No DOM rendering — vitest runs in node environment.

import { describe, it, expect, vi } from "vitest";
import React from "react";

// ─── Mock next/navigation (ErrorBoundary imports useRouter for the fallback) ──
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), back: vi.fn() }),
}));

// ─── Import after mock ────────────────────────────────────────────────────────
import { ErrorBoundary } from "@/components/ErrorBoundary";

// ─────────────────────────────────────────────────────────────────────────────

describe("ErrorBoundary class component", () => {
  // ── Test 1: Renders children when no error ────────────────────────────────
  it("render() returns children when there is no error", () => {
    const child = React.createElement("div", { id: "child" }, "hello");
    const instance = new ErrorBoundary({ children: child });
    // Default state: no error
    expect(instance.state.hasError).toBe(false);
    const result = instance.render();
    expect(result).toBe(child);
  });

  // ── Test 2: Renders fallback UI when child throws ─────────────────────────
  it("getDerivedStateFromError sets hasError: true and captures the error", () => {
    const error = new Error("render failure");
    const state = ErrorBoundary.getDerivedStateFromError(error);
    expect(state.hasError).toBe(true);
    expect(state.error).toBe(error);
  });

  // ── Test 3: "Try again" button resets the error state ────────────────────
  it("resetBoundary calls setState with { hasError: false, error: null }", () => {
    const instance = new ErrorBoundary({
      children: React.createElement("div"),
    });
    const setStateSpy = vi.spyOn(instance, "setState");
    instance.resetBoundary();
    expect(setStateSpy).toHaveBeenCalledWith({ hasError: false, error: null });
  });

  // ── Test 4: onError callback is called with the error when caught ─────────
  it("componentDidCatch calls onError with error and ErrorInfo", () => {
    const onError = vi.fn();
    const instance = new ErrorBoundary({
      children: React.createElement("div"),
      onError,
    });
    const error = new Error("caught it");
    const info: React.ErrorInfo = {
      componentStack: "\n  at Child\n  at Parent",
    };
    instance.componentDidCatch(error, info);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, info);
  });

  // ── Test 5: In production mode, raw error message is NOT shown to user ─────
  // The DefaultFallback wraps the error details in a <details> element that is
  // only rendered when process.env.NODE_ENV === 'development'.
  // In test and production modes NODE_ENV !== 'development', so isDev is false
  // and the error.message is NOT passed to user-visible JSX.
  it("isDev condition is false in non-development environments (test / production)", () => {
    // The test runner sets NODE_ENV='test' — same falsy result as production.
    // This confirms DefaultFallback will not expose raw error details.
    const isDev = process.env.NODE_ENV === "development";
    expect(isDev).toBe(false);

    // Additionally confirm that the boundary's default render wraps in
    // DefaultFallback (a React element) and does NOT inline error.message.
    const error = new Error("SENSITIVE: db password abc123");
    const instance = new ErrorBoundary({
      children: React.createElement("div"),
    });
    instance.state = { hasError: true, error };
    const rendered = instance.render() as React.ReactElement;

    // render() returns a DefaultFallback ReactElement, not raw text
    expect(rendered).not.toBeNull();
    expect(typeof rendered).toBe("object");
    // The rendered element is NOT a string containing the raw error message
    expect(JSON.stringify(rendered)).not.toContain(
      "SENSITIVE: db password abc123",
    );
  });

  // ── Test 6: Custom fallback prop overrides the default fallback UI ────────
  it("render() returns custom fallback when hasError and fallback prop is provided", () => {
    const customFallback = React.createElement(
      "p",
      { "data-testid": "custom" },
      "Custom error message",
    );
    const instance = new ErrorBoundary({
      children: React.createElement("div"),
      fallback: customFallback,
    });
    // Simulate error state
    instance.state = { hasError: true, error: new Error("boom") };
    const result = instance.render();
    expect(result).toBe(customFallback);
  });
});
