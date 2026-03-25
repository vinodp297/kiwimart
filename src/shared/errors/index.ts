// src/shared/errors/index.ts
// ─── Typed Error Classes ──────────────────────────────────────────────────────
// AppError carries structured information (code, statusCode, context) so errors
// can be handled programmatically rather than by string matching.

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'UNAUTHORISED'
  | 'BANNED'
  | 'NOT_ADMIN'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'LISTING_NOT_AVAILABLE'
  | 'SELLER_NOT_CONFIGURED'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_WRONG_STATE'
  | 'MISSING_PAYMENT_INTENT'
  | 'PAYMENT_FAILED'
  | 'STRIPE_ERROR'
  | 'RATE_LIMITED'
  | 'MESSAGE_FLAGGED'
  | 'DATABASE_ERROR'
  | 'QUEUE_ERROR'
  | 'STORAGE_ERROR'
  | 'EMAIL_ERROR'

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number = 400,
    public readonly context?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AppError'
    // Maintains proper prototype chain in TypeScript
    Object.setPrototypeOf(this, AppError.prototype)
  }

  static unauthenticated(): AppError {
    return new AppError('UNAUTHENTICATED', 'Please sign in to continue', 401)
  }

  static unauthorised(reason?: string): AppError {
    return new AppError(
      'UNAUTHORISED',
      reason ?? 'You do not have permission to do this',
      403
    )
  }

  static banned(): AppError {
    return new AppError(
      'BANNED',
      'Your account has been suspended. Contact support@kiwimart.co.nz for help.',
      403
    )
  }

  static notAdmin(): AppError {
    return new AppError('NOT_ADMIN', 'Admin access required', 403)
  }

  static validation(message: string): AppError {
    return new AppError('VALIDATION_ERROR', message, 400)
  }

  static notFound(entity: string): AppError {
    return new AppError('NOT_FOUND', `${entity} not found`, 404)
  }

  static missingPaymentIntent(): AppError {
    return new AppError(
      'MISSING_PAYMENT_INTENT',
      'Payment reference missing. Contact support@kiwimart.co.nz',
      400
    )
  }

  static stripeError(message: string): AppError {
    return new AppError('STRIPE_ERROR', message, 502)
  }

  static rateLimited(): AppError {
    return new AppError(
      'RATE_LIMITED',
      'Too many requests. Please wait before trying again.',
      429
    )
  }
}
