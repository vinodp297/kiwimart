// src/shared/logger/index.ts
// ─── Structured Logger ────────────────────────────────────────────────────────
// Development: pretty-printed with emoji indicators
// Production: JSON format parseable by Vercel / BetterStack / Datadog
//
// Log shipping — BetterStack (Logtail):
//   Set LOGTAIL_SOURCE_TOKEN in your environment to enable.
//   Logs are shipped asynchronously; the logger is fully functional without it.
//   Token absent → shipping is silently skipped (fail-graceful).
//
//   Setup:
//     1. Create a source in BetterStack > Logs > Sources (select HTTP/JSON).
//     2. Copy the Source Token into the LOGTAIL_SOURCE_TOKEN env var.
//     3. In Vercel: Settings > Environment Variables > add LOGTAIL_SOURCE_TOKEN.
//     4. That's it — structured JSON log lines are sent on every production call.
//
//   The ingest endpoint is https://in.logtail.com (no SDK required).
//   Each line is a JSON object with timestamp, level, event, and context fields.
//
// Event naming convention — dot notation: domain.action.outcome
// Examples:
//   'order.created'            'order.create.failed'
//   'payment.captured'         'payment.capture.failed'
//   'stripe.webhook.received'  'stripe.webhook.duplicate'
//   'escrow.auto_release.completed'
//   'user.banned'              'user.login'
//   'message.flagged'          'email.sent'
//
// Correlation IDs: when a request context has been set via
// runWithRequestContext(), correlationId is automatically included in every
// log line so that request → BullMQ job → Stripe webhook traces are linkable.

import { getRequestContext } from "@/lib/request-context";
import { sanitiseLogContext } from "@/lib/log-sanitiser";

// ��─ BetterStack (Logtail) log shipping ────────────────────────────────────────
// Fire-and-forget; never throws. Silently skipped when token is absent.
function shipToBetterStack(entry: object): void {
  const token = process.env.LOGTAIL_SOURCE_TOKEN;
  if (!token) return;
  fetch("https://in.logtail.com", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(entry),
  }).catch(() => {
    // Shipping failure must never propagate — the app keeps running.
  });
}

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export interface LogContext {
  [key: string]: unknown;
}

function log(level: LogLevel, event: string, context?: LogContext): void {
  // Automatically enrich every log line with the correlationId from the current
  // request context (if one is active). Does not override an explicit
  // correlationId already present in the caller-supplied context.
  const requestContext = getRequestContext();
  const safeContext = context ? sanitiseLogContext(context) : undefined;
  const enrichedContext: LogContext = {
    ...(requestContext?.correlationId
      ? { correlationId: requestContext.correlationId }
      : {}),
    ...safeContext,
  };

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...enrichedContext,
  };

  const isDev = process.env.NODE_ENV !== "production";

  if (!isDev) {
    // Ship every log line to BetterStack (no-op when token absent).
    shipToBetterStack(entry);
  }

  if (isDev) {
    const emoji: Record<LogLevel, string> = {
      debug: "🔍",
      info: "📋",
      warn: "⚠️ ",
      error: "❌",
      fatal: "💀",
    };
    const prefix = `${emoji[level]} [${level.toUpperCase()}]`;
    if (level === "error" || level === "fatal") {
      console.error(prefix, event, enrichedContext);
    } else if (level === "warn") {
      console.warn(prefix, event, enrichedContext);
    } else {
      console.log(prefix, event, enrichedContext);
    }
  } else {
    // Production: structured JSON — one line per log entry
    console.log(JSON.stringify(entry));

    // Forward error/fatal events to Sentry (fire-and-forget).
    // Attach correlationId as a Sentry tag so error reports in the Sentry
    // dashboard can be linked back to structured logs by the same ID.
    if (level === "error" || level === "fatal") {
      const correlationId = enrichedContext.correlationId as string | undefined;
      import("@sentry/nextjs")
        .then((Sentry) => {
          Sentry.withScope((scope) => {
            if (correlationId) scope.setTag("correlationId", correlationId);
            if (context?.error instanceof Error) {
              Sentry.captureException(context.error, {
                extra: { event, ...enrichedContext },
              });
            } else {
              Sentry.captureMessage(event, {
                level: level === "fatal" ? "fatal" : "error",
                extra: { event, ...enrichedContext },
              });
            }
          });
        })
        .catch(() => {
          // Sentry not available — ignore silently
        });
    }
  }
}

export const logger = {
  debug: (event: string, context?: LogContext) => log("debug", event, context),
  info: (event: string, context?: LogContext) => log("info", event, context),
  warn: (event: string, context?: LogContext) => log("warn", event, context),
  error: (event: string, context?: LogContext) => log("error", event, context),
  fatal: (event: string, context?: LogContext) => log("fatal", event, context),
};
