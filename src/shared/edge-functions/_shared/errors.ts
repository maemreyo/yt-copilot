// Error handling utilities for Supabase Edge Functions

import { corsHeaders } from './cors.ts';
import { securityHeaders } from './security.ts';

/**
 * Error types for consistent error handling
 */
export enum ErrorType {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  NOT_FOUND_ERROR = 'NOT_FOUND_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/**
 * HTTP status codes mapping
 */
const ERROR_STATUS_MAP: Record<ErrorType, number> = {
  [ErrorType.VALIDATION_ERROR]: 400,
  [ErrorType.AUTHENTICATION_ERROR]: 401,
  [ErrorType.AUTHORIZATION_ERROR]: 403,
  [ErrorType.NOT_FOUND_ERROR]: 404,
  [ErrorType.RATE_LIMIT_ERROR]: 429,
  [ErrorType.EXTERNAL_SERVICE_ERROR]: 502,
  [ErrorType.DATABASE_ERROR]: 500,
  [ErrorType.INTERNAL_ERROR]: 500,
};

/**
 * Application error class
 */
export class AppError extends Error {
  public readonly type: ErrorType;
  public readonly status: number;
  public readonly details?: Record<string, unknown>;
  public readonly timestamp: string;
  public readonly requestId?: string;

  constructor(
    type: ErrorType,
    message: string,
    details?: Record<string, unknown>,
    requestId?: string,
  ) {
    super(message);
    this.name = 'AppError';
    this.type = type;
    this.status = ERROR_STATUS_MAP[type];
    this.details = details;
    this.timestamp = new Date().toISOString();
    this.requestId = requestId;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  /**
   * Convert error to response object
   */
  toResponse(): Record<string, unknown> {
    const response: Record<string, unknown> = {
      error: {
        type: this.type,
        message: this.message,
        status: this.status,
        timestamp: this.timestamp,
      },
    };

    if (this.requestId) {
      response.error = { ...response.error, requestId: this.requestId };
    }

    if (this.details) {
      response.error = { ...response.error, details: this.details };
    }

    return response;
  }

  /**
   * Convert error to HTTP Response
   */
  toHttpResponse(): Response {
    return new Response(JSON.stringify(this.toResponse()), {
      status: this.status,
      headers: {
        ...corsHeaders,
        ...securityHeaders,
        'Content-Type': 'application/json',
        ...(this.requestId && { 'X-Request-ID': this.requestId }),
      },
    });
  }
}

/**
 * Create application error
 */
export function createAppError(
  type: ErrorType,
  message: string,
  details?: Record<string, unknown>,
  requestId?: string,
): AppError {
  return new AppError(type, message, details, requestId);
}

/**
 * Handle unknown errors and convert to AppError
 */
export function handleUnknownError(
  error: unknown,
  requestId?: string,
): AppError {
  // If it's already an AppError, return as is
  if (error instanceof AppError) {
    return error;
  }

  // If it's a standard Error
  if (error instanceof Error) {
    return createAppError(
      ErrorType.INTERNAL_ERROR,
      error.message,
      { originalError: error.name, stack: error.stack },
      requestId,
    );
  }

  // For any other type of error
  return createAppError(
    ErrorType.INTERNAL_ERROR,
    'An unexpected error occurred',
    { originalError: String(error) },
    requestId,
  );
}

/**
 * Create validation error response
 */
export function createValidationErrorResponse(
  errors: string[],
  requestId?: string,
): Response {
  const error = createAppError(
    ErrorType.VALIDATION_ERROR,
    'Validation failed',
    { errors },
    requestId,
  );

  return error.toHttpResponse();
}

/**
 * Create authentication error response
 */
export function createAuthErrorResponse(
  message: string = 'Authentication required',
  requestId?: string,
): Response {
  const error = createAppError(
    ErrorType.AUTHENTICATION_ERROR,
    message,
    undefined,
    requestId,
  );

  return error.toHttpResponse();
}

/**
 * Create rate limit error response
 */
export function createRateLimitErrorResponse(
  limit: number,
  windowMs: number,
  requestId?: string,
): Response {
  const error = createAppError(
    ErrorType.RATE_LIMIT_ERROR,
    'Rate limit exceeded',
    {
      limit,
      windowMs,
      retryAfter: Math.ceil(windowMs / 1000),
    },
    requestId,
  );

  const response = error.toHttpResponse();

  // Add rate limit headers
  const headers = new Headers(response.headers);
  headers.set('Retry-After', Math.ceil(windowMs / 1000).toString());
  headers.set('X-RateLimit-Limit', limit.toString());
  headers.set('X-RateLimit-Remaining', '0');

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

/**
 * Create method not allowed error response
 */
export function createMethodNotAllowedResponse(
  allowedMethods: string[],
  requestId?: string,
): Response {
  const error = createAppError(
    ErrorType.VALIDATION_ERROR,
    `Method not allowed. Allowed methods: ${allowedMethods.join(', ')}`,
    { allowedMethods },
    requestId,
  );

  const response = error.toHttpResponse();

  // Add Allow header
  const headers = new Headers(response.headers);
  headers.set('Allow', allowedMethods.join(', '));

  return new Response(response.body, {
    status: 405, // Method Not Allowed
    headers,
  });
}

/**
 * Log error for monitoring
 */
export function logError(
  error: AppError | Error,
  request?: Request,
  additionalContext?: Record<string, unknown>,
): void {
  const logData: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    additionalContext,
  };

  // Add AppError specific fields
  if (error instanceof AppError) {
    logData.error = {
      ...logData.error,
      type: error.type,
      status: error.status,
      details: error.details,
      requestId: error.requestId,
    };
  }

  // Add request context if available
  if (request) {
    logData.request = {
      method: request.method,
      url: request.url,
      headers: {
        'user-agent': request.headers.get('user-agent'),
        'origin': request.headers.get('origin'),
        'referer': request.headers.get('referer'),
      },
    };
  }

  // Use appropriate log level based on error severity
  if (error instanceof AppError) {
    switch (error.type) {
      case ErrorType.VALIDATION_ERROR:
      case ErrorType.NOT_FOUND_ERROR:
        console.info('[ERROR]', JSON.stringify(logData));
        break;
      case ErrorType.AUTHENTICATION_ERROR:
      case ErrorType.AUTHORIZATION_ERROR:
        console.warn('[ERROR]', JSON.stringify(logData));
        break;
      default:
        console.error('[ERROR]', JSON.stringify(logData));
    }
  } else {
    console.error('[ERROR]', JSON.stringify(logData));
  }
}

/**
 * Error boundary for Edge Functions
 */
export function createErrorHandler(requestId?: string) {
  return (error: unknown, request?: Request): Response => {
    const appError = handleUnknownError(error, requestId);

    // Log the error
    logError(appError, request);

    return appError.toHttpResponse();
  };
}

/**
 * Wrap function with error handling
 */
export function withErrorHandling<
  T extends (...args: any[]) => Promise<Response>,
>(
  fn: T,
  requestId?: string,
): T {
  return (async (...args: Parameters<T>): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (error: any) {
      const errorHandler = createErrorHandler(requestId);
      return errorHandler(error, args[0] as Request);
    }
  }) as T;
}

/**
 * Validation error helper
 */
export function throwValidationError(
  message: string,
  details?: Record<string, unknown>,
  requestId?: string,
): never {
  throw createAppError(ErrorType.VALIDATION_ERROR, message, details, requestId);
}

/**
 * Authentication error helper
 */
export function throwAuthError(
  message: string = 'Authentication required',
  requestId?: string,
): never {
  throw createAppError(
    ErrorType.AUTHENTICATION_ERROR,
    message,
    undefined,
    requestId,
  );
}

/**
 * Not found error helper
 */
export function throwNotFoundError(
  resource: string,
  requestId?: string,
): never {
  throw createAppError(
    ErrorType.NOT_FOUND_ERROR,
    `${resource} not found`,
    undefined,
    requestId,
  );
}
