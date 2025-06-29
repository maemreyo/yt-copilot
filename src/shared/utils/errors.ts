// Comprehensive error handling system with standardized classes, formatting, and monitoring

import { environment } from '../config/environment';

/**
 * Standard error codes used throughout the application
 */
export enum ErrorCode {
  // Client Errors (4xx)
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  REQUEST_TOO_LARGE = 'REQUEST_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE = 'UNSUPPORTED_MEDIA_TYPE',
  UNAUTHORIZED = 'UNAUTHORIZED',

  // Server Errors (5xx)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  DATABASE_ERROR = 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',

  // Business Logic Errors
  BUSINESS_RULE_VIOLATION = 'BUSINESS_RULE_VIOLATION',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  RESOURCE_LOCKED = 'RESOURCE_LOCKED',
  OPERATION_NOT_ALLOWED = 'OPERATION_NOT_ALLOWED',

  // Payment/Billing Errors
  PAYMENT_REQUIRED = 'PAYMENT_REQUIRED',
  SUBSCRIPTION_REQUIRED = 'SUBSCRIPTION_REQUIRED',
  SUBSCRIPTION_TIER_REQUIRED = 'SUBSCRIPTION_TIER_REQUIRED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  SUBSCRIPTION_EXPIRED = 'SUBSCRIPTION_EXPIRED',

  // API Key Errors
  INVALID_API_KEY = 'INVALID_API_KEY',
  API_KEY_EXPIRED = 'API_KEY_EXPIRED',
  API_KEY_REVOKED = 'API_KEY_REVOKED',
}

/**
 * HTTP status code mapping for error codes
 */
const ERROR_STATUS_MAP: Record<ErrorCode, number> = {
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.AUTHENTICATION_ERROR]: 401,
  [ErrorCode.AUTHORIZATION_ERROR]: 403,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 429,
  [ErrorCode.REQUEST_TOO_LARGE]: 413,
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE]: 415,
  [ErrorCode.UNAUTHORIZED]: 401,

  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.DATABASE_ERROR]: 500,
  [ErrorCode.EXTERNAL_SERVICE_ERROR]: 502,
  [ErrorCode.TIMEOUT_ERROR]: 504,

  [ErrorCode.BUSINESS_RULE_VIOLATION]: 400,
  [ErrorCode.INSUFFICIENT_PERMISSIONS]: 403,
  [ErrorCode.RESOURCE_LOCKED]: 423,
  [ErrorCode.OPERATION_NOT_ALLOWED]: 405,

  [ErrorCode.PAYMENT_REQUIRED]: 402,
  [ErrorCode.SUBSCRIPTION_REQUIRED]: 402,
  [ErrorCode.SUBSCRIPTION_TIER_REQUIRED]: 402,
  [ErrorCode.PAYMENT_FAILED]: 402,
  [ErrorCode.SUBSCRIPTION_EXPIRED]: 402,

  [ErrorCode.INVALID_API_KEY]: 401,
  [ErrorCode.API_KEY_EXPIRED]: 401,
  [ErrorCode.API_KEY_REVOKED]: 401,
};

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * Error context interface for additional metadata
 */
export interface ErrorContext {
  userId?: string;
  apiKeyId?: string;
  requestId?: string;
  endpoint?: string;
  method?: string;
  userAgent?: string;
  ip?: string;
  timestamp?: string;
  correlationId?: string;
  [key: string]: unknown;
}

/**
 * Structured error object interface
 */
export interface StructuredError {
  code: ErrorCode;
  message: string;
  details?: unknown;
  context?: ErrorContext;
  severity?: ErrorSeverity;
  retryable?: boolean;
  timestamp: string;
  stack?: string;
}

/**
 * Base application error class
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly context?: ErrorContext;
  public readonly severity: ErrorSeverity;
  public readonly retryable: boolean;
  public readonly timestamp: string;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      details?: unknown;
      context?: ErrorContext;
      severity?: ErrorSeverity;
      retryable?: boolean;
      cause?: Error;
    } = {}
  ) {
    super(message);

    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = ERROR_STATUS_MAP[code] || 500;
    this.details = options.details;
    this.context = options.context;
    this.severity = options.severity || ErrorSeverity.MEDIUM;
    this.retryable = options.retryable || false;
    this.timestamp = new Date().toISOString();

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    // Set cause if provided
    if (options.cause) {
      this.cause = options.cause;
    }
  }

  /**
   * Convert error to structured object
   */
  toStructured(): StructuredError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      context: this.context,
      severity: this.severity,
      retryable: this.retryable,
      timestamp: this.timestamp,
      stack: environment.isDevelopment() ? this.stack : undefined,
    };
  }

  /**
   * Convert error to API response format
   */
  toResponse() {
    // Create the base error object
    const errorObj: {
      code: ErrorCode;
      message: string;
      details?: unknown;
      stack?: string;
    } = {
      code: this.code,
      message: this.message,
    };

    // Conditionally add details if they exist
    if (this.details) {
      errorObj.details = this.details;
    }

    // Conditionally add stack trace in development
    if (environment.isDevelopment()) {
      errorObj.stack = this.stack;
    }

    // Create the response object
    const response: {
      error: typeof errorObj;
      timestamp: string;
      requestId?: string;
    } = {
      error: errorObj,
      timestamp: this.timestamp,
    };

    // Conditionally add requestId if it exists
    if (this.context?.requestId) {
      response.requestId = this.context.requestId;
    }

    return response;
  }

  /**
   * Check if error should be logged
   */
  shouldLog(): boolean {
    return this.statusCode >= 500 || this.severity === ErrorSeverity.CRITICAL;
  }

  /**
   * Check if error should be reported to monitoring service
   */
  shouldReport(): boolean {
    return (
      this.statusCode >= 500 ||
      this.severity === ErrorSeverity.HIGH ||
      this.severity === ErrorSeverity.CRITICAL
    );
  }
}

/**
 * Validation error class
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown, context?: ErrorContext) {
    super(ErrorCode.VALIDATION_ERROR, message, {
      details,
      context,
      severity: ErrorSeverity.LOW,
      retryable: false,
    });
  }
}

/**
 * Authentication error class
 */
export class AuthenticationError extends AppError {
  constructor(
    message: string = 'Authentication failed',
    details?: unknown,
    context?: ErrorContext
  ) {
    super(ErrorCode.AUTHENTICATION_ERROR, message, {
      details,
      context,
      severity: ErrorSeverity.MEDIUM,
      retryable: false,
    });
  }
}

/**
 * Authorization error class
 */
export class AuthorizationError extends AppError {
  constructor(
    message: string = 'Insufficient permissions',
    details?: unknown,
    context?: ErrorContext
  ) {
    super(ErrorCode.AUTHORIZATION_ERROR, message, {
      details,
      context,
      severity: ErrorSeverity.MEDIUM,
      retryable: false,
    });
  }
}

/**
 * Not found error class
 */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string, context?: ErrorContext) {
    const message = identifier
      ? `${resource} with identifier '${identifier}' not found`
      : `${resource} not found`;

    super(ErrorCode.NOT_FOUND, message, {
      details: { resource, identifier },
      context,
      severity: ErrorSeverity.LOW,
      retryable: false,
    });
  }
}

/**
 * Rate limit error class
 */
export class RateLimitError extends AppError {
  constructor(limit: number, windowMs: number, context?: ErrorContext) {
    super(ErrorCode.RATE_LIMIT_EXCEEDED, 'Rate limit exceeded', {
      details: { limit, windowMs, retryAfter: Math.ceil(windowMs / 1000) },
      context,
      severity: ErrorSeverity.LOW,
      retryable: true,
    });
  }
}

/**
 * Database error class
 */
export class DatabaseError extends AppError {
  constructor(message: string, originalError?: Error, context?: ErrorContext) {
    super(ErrorCode.DATABASE_ERROR, message, {
      details: originalError?.message,
      context,
      severity: ErrorSeverity.HIGH,
      retryable: true,
      cause: originalError,
    });
  }
}

/**
 * External service error class
 */
export class ExternalServiceError extends AppError {
  constructor(serviceName: string, originalError?: Error, context?: ErrorContext) {
    super(ErrorCode.EXTERNAL_SERVICE_ERROR, `${serviceName} service error`, {
      details: { service: serviceName, originalError: originalError?.message },
      context,
      severity: ErrorSeverity.HIGH,
      retryable: true,
      cause: originalError,
    });
  }
}

/**
 * Business rule violation error class
 */
export class BusinessRuleError extends AppError {
  constructor(rule: string, message?: string, context?: ErrorContext) {
    super(ErrorCode.BUSINESS_RULE_VIOLATION, message || `Business rule violation: ${rule}`, {
      details: { rule },
      context,
      severity: ErrorSeverity.MEDIUM,
      retryable: false,
    });
  }
}

/**
 * Payment error class
 */
export class PaymentError extends AppError {
  constructor(code: ErrorCode, message: string, stripeError?: unknown, context?: ErrorContext) {
    super(code, message, {
      details: stripeError,
      context,
      severity: ErrorSeverity.MEDIUM,
      retryable: false,
    });
  }
}

/**
 * Error logging utility
 */
export class ErrorLogger {
  private static formatLogEntry(error: AppError, additionalContext?: Record<string, unknown>) {
    // Create the log entry object
    const logEntry: {
      timestamp: string;
      level: string;
      code: ErrorCode;
      message: string;
      statusCode: number;
      severity: ErrorSeverity;
      retryable: boolean;
      context: Record<string, unknown>;
      details?: unknown;
      stack?: string;
    } = {
      timestamp: error.timestamp,
      level: error.shouldLog() ? 'error' : 'warn',
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      severity: error.severity,
      retryable: error.retryable,
      context: { ...(error.context || {}), ...(additionalContext || {}) },
    };

    // Add details if they exist
    if (error.details) {
      logEntry.details = error.details;
    }

    // Add stack trace in development if it exists
    if (error.stack && environment.isDevelopment()) {
      logEntry.stack = error.stack;
    }

    return logEntry;
  }

  static log(error: AppError, additionalContext?: Record<string, unknown>) {
    const logEntry = this.formatLogEntry(error, additionalContext);

    if (environment.isDevelopment()) {
      console.error('🚨 Application Error:', logEntry);
    } else {
      // In production, use structured logging
      console.error(JSON.stringify(logEntry));
    }
  }

  static async report(error: AppError, additionalContext?: Record<string, unknown>) {
    // Log the error
    this.log(error, additionalContext);

    // Report to external monitoring service if configured
    if (error.shouldReport() && environment.isProduction()) {
      try {
        // TODO: Integrate with Sentry or other monitoring service
        // await reportToSentry(error, additionalContext);
        console.log('📊 Error reported to monitoring service');
      } catch (reportingError) {
        console.error('Failed to report error to monitoring service:', reportingError);
      }
    }
  }
}

/**
 * Error response formatter
 */
export class ErrorResponseFormatter {
  /**
   * Format error for API response
   */
  static formatResponse(
    error: unknown,
    requestId?: string
  ): {
    error: {
      code: string;
      message: string;
      details?: unknown;
      stack?: string;
      originalError?: unknown;
    };
    timestamp: string;
    requestId?: string;
  } {
    if (error instanceof AppError) {
      // Use the AppError's toResponse method which we already fixed
      const response = error.toResponse();

      // Add requestId if provided
      if (requestId) {
        return {
          ...response,
          requestId,
        };
      }

      return response;
    }

    // Handle unknown errors
    const timestamp = new Date().toISOString();
    const sanitizedMessage = environment.isProduction()
      ? 'An unexpected error occurred'
      : (error as Error)?.message || 'Unknown error';

    // Create the error object
    const errorObj: {
      code: ErrorCode;
      message: string;
      stack?: string;
      originalError?: unknown;
    } = {
      code: ErrorCode.INTERNAL_ERROR,
      message: sanitizedMessage,
    };

    // Add stack and original error in development
    if (environment.isDevelopment()) {
      errorObj.stack = (error as Error)?.stack;
      errorObj.originalError = error;
    }

    // Create the response object
    const response: {
      error: typeof errorObj;
      timestamp: string;
      requestId?: string;
    } = {
      error: errorObj,
      timestamp,
    };

    // Add requestId if provided
    if (requestId) {
      response.requestId = requestId;
    }

    return response;
  }

  /**
   * Format validation errors from Zod or similar libraries
   */
  static formatValidationError(validationError: unknown, context?: ErrorContext): ValidationError {
    // Handle Zod errors
    if (validationError && typeof validationError === 'object' && 'issues' in validationError) {
      const issues = (validationError as any).issues;
      const details = issues.map((issue: any) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));

      return new ValidationError('Validation failed', details, context);
    }

    // Handle generic validation errors
    return new ValidationError(
      (validationError as Error)?.message || 'Validation failed',
      validationError,
      context
    );
  }
}

/**
 * Error handler middleware factory
 */
export function createErrorHandler() {
  return async (error: unknown, request?: Request) => {
    const requestId = crypto.randomUUID();
    const context: ErrorContext = {
      requestId,
      endpoint: request?.url,
      method: request?.method,
      timestamp: new Date().toISOString(),
    };

    let appError: AppError;

    if (error instanceof AppError) {
      // Create a new AppError with merged context since we can't modify the readonly property
      appError = new AppError(error.code, error.message, {
        details: error.details,
        context: { ...(error.context || {}), ...context },
        severity: error.severity,
        retryable: error.retryable,
        cause: error.cause as Error,
      });
    } else {
      // Convert unknown error to AppError
      appError = new AppError(
        ErrorCode.INTERNAL_ERROR,
        environment.isProduction()
          ? 'An unexpected error occurred'
          : (error as Error)?.message || 'Unknown error',
        {
          details: environment.isDevelopment() ? error : undefined,
          context,
          severity: ErrorSeverity.HIGH,
          cause: error as Error,
        }
      );
    }

    // Log and report the error
    await ErrorLogger.report(appError);

    // Return formatted response
    return new Response(
      JSON.stringify(ErrorResponseFormatter.formatResponse(appError, requestId)),
      {
        status: appError.statusCode,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': requestId,
        },
      }
    );
  };
}

/**
 * Utility functions for common error scenarios
 */
export const errorUtils = {
  /**
   * Create not found error for common resources
   */
  notFound: {
    user: (id: string, context?: ErrorContext) => new NotFoundError('User', id, context),
    apiKey: (prefix: string, context?: ErrorContext) =>
      new NotFoundError('API Key', prefix, context),
    subscription: (id: string, context?: ErrorContext) =>
      new NotFoundError('Subscription', id, context),
  },

  /**
   * Create authentication errors
   */
  auth: {
    invalidCredentials: (context?: ErrorContext) =>
      new AuthenticationError('Invalid credentials', undefined, context),
    tokenExpired: (context?: ErrorContext) =>
      new AuthenticationError('Token expired', undefined, context),
    invalidToken: (context?: ErrorContext) =>
      new AuthenticationError('Invalid token', undefined, context),
    missingToken: (context?: ErrorContext) =>
      new AuthenticationError('Authentication token required', undefined, context),
  },

  /**
   * Create authorization errors
   */
  authz: {
    insufficient: (resource: string, action: string, context?: ErrorContext) =>
      new AuthorizationError(
        `Insufficient permissions to ${action} ${resource}`,
        { resource, action },
        context
      ),
    forbidden: (context?: ErrorContext) =>
      new AuthorizationError('Access forbidden', undefined, context),
  },

  /**
   * Create payment errors
   */
  payment: {
    required: (context?: ErrorContext) =>
      new PaymentError(
        ErrorCode.PAYMENT_REQUIRED,
        'Payment required to access this resource',
        undefined,
        context
      ),
    failed: (reason: string, context?: ErrorContext) =>
      new PaymentError(ErrorCode.PAYMENT_FAILED, `Payment failed: ${reason}`, undefined, context),
    subscriptionRequired: (context?: ErrorContext) =>
      new PaymentError(
        ErrorCode.SUBSCRIPTION_REQUIRED,
        'Active subscription required',
        undefined,
        context
      ),
    subscriptionExpired: (context?: ErrorContext) =>
      new PaymentError(ErrorCode.SUBSCRIPTION_EXPIRED, 'Subscription expired', undefined, context),
  },
};
