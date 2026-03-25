// src/shared/logger/index.ts
// ─── Structured Logger ────────────────────────────────────────────────────────
// Development: pretty-printed with emoji indicators
// Production: JSON format parseable by Vercel / Datadog
//
// Event naming convention — dot notation: domain.action.outcome
// Examples:
//   'order.created'            'order.create.failed'
//   'payment.captured'         'payment.capture.failed'
//   'stripe.webhook.received'  'stripe.webhook.duplicate'
//   'escrow.auto_release.completed'
//   'user.banned'              'user.login'
//   'message.flagged'          'email.sent'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export interface LogContext {
  [key: string]: unknown
}

function log(level: LogLevel, event: string, context?: LogContext): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...context,
  }

  const isDev = process.env.NODE_ENV !== 'production'

  if (isDev) {
    const emoji: Record<LogLevel, string> = {
      debug: '🔍',
      info:  '📋',
      warn:  '⚠️ ',
      error: '❌',
      fatal: '💀',
    }
    const prefix = `${emoji[level]} [${level.toUpperCase()}]`
    if (level === 'error' || level === 'fatal') {
      console.error(prefix, event, context ?? '')
    } else if (level === 'warn') {
      console.warn(prefix, event, context ?? '')
    } else {
      console.log(prefix, event, context ?? '')
    }
  } else {
    // Production: structured JSON — one line per log entry
    console.log(JSON.stringify(entry))

    // Forward error/fatal events to Sentry (fire-and-forget)
    if (level === 'error' || level === 'fatal') {
      import('@sentry/nextjs')
        .then((Sentry) => {
          if (context?.error instanceof Error) {
            Sentry.captureException(context.error, {
              extra: { event, ...context },
            })
          } else {
            Sentry.captureMessage(event, {
              level: level === 'fatal' ? 'fatal' : 'error',
              extra: { event, ...context },
            })
          }
        })
        .catch(() => {
          // Sentry not available — ignore silently
        })
    }
  }
}

export const logger = {
  debug: (event: string, context?: LogContext) => log('debug', event, context),
  info:  (event: string, context?: LogContext) => log('info',  event, context),
  warn:  (event: string, context?: LogContext) => log('warn',  event, context),
  error: (event: string, context?: LogContext) => log('error', event, context),
  fatal: (event: string, context?: LogContext) => log('fatal', event, context),
}
