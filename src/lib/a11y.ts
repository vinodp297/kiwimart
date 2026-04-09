// src/lib/a11y.ts
// ─── Accessibility Utilities ──────────────────────────────────────────────────
// Shared helpers used by modal components for keyboard management and
// focus handling. Exported as pure functions so they can be unit-tested
// without a DOM (the caller attaches them to event listeners).

/** CSS selector that matches all standard focusable elements. */
export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Returns a keydown handler that calls `onClose` when the Escape key is
 * pressed. Attach to `document` while the modal is mounted:
 *
 *   useEffect(() => {
 *     const h = createEscapeHandler(onClose);
 *     document.addEventListener('keydown', h);
 *     return () => document.removeEventListener('keydown', h);
 *   }, [onClose]);
 */
export function createEscapeHandler(onClose: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };
}

/**
 * Returns the first focusable descendant of `container`, or `null` if none
 * exists. Used to move focus into a modal when it opens.
 */
export function findFirstFocusable(
  container: HTMLElement | null,
): HTMLElement | null {
  if (!container) return null;
  return container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
}
