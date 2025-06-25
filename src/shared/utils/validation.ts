// - Comprehensive validation utilities with Zod schemas, middleware, and common patterns

import { z, ZodSchema, ZodError, ZodType } from 'zod';
import { ValidationError, ErrorResponseFormatter, ErrorContext } from './errors';
import { environment } from '../config/environment';

/**
 * Validation result interface
 */
export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: ValidationErrorDetail[];
}

/**
 * Validation error detail interface
 */
export interface ValidationErrorDetail {
  field: string;
  message: string;
  code: string;
  value?: unknown;
}

/**
 * Request validation options
 */
export interface ValidationOptions {
  stripUnknown?: boolean;
  allowExtraFields?: boolean;
  transformData?: boolean;
  abortEarly?: boolean;
}

/**
 * Common validation schemas
 */
export const commonSchemas = {
  // Basic types
  email: z.string().email('Invalid email format').toLowerCase(),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain uppercase, lowercase, and number'),
  url: z.string().url('Invalid URL format'),
  uuid: z.string().uuid('Invalid UUID format'),
  
  // API Key patterns
  apiKeyPrefix: z.string().regex(/^[a-zA-Z0-9]{8}$/, 'API key prefix must be 8 alphanumeric characters'),
  apiKeyName: z.string().min(1).max(50).regex(/^[a-zA-Z0-9\s\-_]+$/, 'API key name contains invalid characters'),
  
  // Identifiers
  userId: z.string().uuid('Invalid user ID'),
  subscriptionId: z.string().regex(/^sub_[a-zA-Z0-9]+$/, 'Invalid subscription ID format'),
  customerId: z.string().regex(/^cus_[a-zA-Z0-9]+$/, 'Invalid customer ID format'),
  priceId: z.string().regex(/^price_[a-zA-Z0-9]+$/, 'Invalid price ID format'),
  
  // Pagination
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  
  // Sorting
  sortField: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Invalid sort field'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  
  // Timestamps
  timestamp: z.string().datetime('Invalid timestamp format'),
  dateString: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  
  // Text content
  shortText: z.string().min(1).max(255).trim(),
  mediumText: z.string().min(1).max(1000).trim(),
  longText: z.string().min(1).max(10000).trim(),
  
  // Numbers
  positiveInt: z.number().int().positive(),
  nonNegativeInt: z.number().int().min(0),
  percentage: z.number().min(0).max(100),
  price: z.number().min(0).multipleOf(0.01), // Cents precision
  
  // Boolean
  booleanString: z.enum(['true', 'false']).transform(val => val === 'true'),
  
  // Arrays
  stringArray: z.array(z.string()).default([]),
  uuidArray: z.array(z.string().uuid()).default([]),
  
  // Objects
  metadata: z.record(z.unknown()).default({}),
  
  // File validation
  fileName: z.string().regex(/^[a-zA-Z0-9\-_\. ]+$/, 'Invalid file name'),
  fileSize: z.number().max(10 * 1024 * 1024, 'File size must be less than 10MB'), // 10MB
  mimeType: z.enum([
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/pdf',
    'text/csv',
    'application/json',
  ]),
};

/**
 * API request schemas
 */
export const requestSchemas = {
  // Pagination query parameters
  pagination: z.object({
    page: commonSchemas.page,
    limit: commonSchemas.limit,
    offset: commonSchemas.offset.optional(),
  }),

  // Sorting query parameters
  sorting: z.object({
    sortBy: commonSchemas.sortField.optional(),
    sortOrder: commonSchemas.sortOrder,
  }),

  // Search query parameters
  search: z.object({
    q: z.string().min(1).max(100).optional(),
    filter: z.string().optional(),
  }),

  // Common headers
  headers: z.object({
    'content-type': z.string().optional(),
    'user-agent': z.string().optional(),
    'x-request-id': commonSchemas.uuid.optional(),
    'x-forwarded-for': z.string().optional(),
  }),

  // Auth headers
  authHeaders: z.object({
    authorization: z.string().min(1),
  }),

  // API key headers
  apiKeyHeaders: z.object({
    'x-api-key': z.string().min(1),
  }),
};

/**
 * API request body schemas
 */
export const bodySchemas = {
  // API Key creation
  createApiKey: z.object({
    name: commonSchemas.apiKeyName.optional(),
    expiresInDays: z.number().int().min(1).max(365).optional(),
    permissions: z.array(z.string()).optional(),
  }),

  // API Key revocation
  revokeApiKey: z.object({
    keyPrefix: commonSchemas.apiKeyPrefix,
  }),

  // Billing checkout session
  createCheckoutSession: z.object({
    priceId: commonSchemas.priceId,
    successUrl: commonSchemas.url.optional(),
    cancelUrl: commonSchemas.url.optional(),
    metadata: commonSchemas.metadata.optional(),
  }),

  // Customer portal
  createCustomerPortal: z.object({
    returnUrl: commonSchemas.url.optional(),
  }),

  // Profile update
  updateProfile: z.object({
    name: commonSchemas.shortText.optional(),
    email: commonSchemas.email.optional(),
    metadata: commonSchemas.metadata.optional(),
  }),

  // Contact form
  contactForm: z.object({
    name: commonSchemas.shortText,
    email: commonSchemas.email,
    subject: commonSchemas.shortText,
    message: commonSchemas.longText,
  }),

  // Webhook payload (generic)
  webhookPayload: z.object({
    id: z.string(),
    type: z.string(),
    data: z.record(z.unknown()),
    created: z.number(),
  }),
};

/**
 * Response schemas for validation
 */
export const responseSchemas = {
  // Standard API response
  apiResponse: <T extends ZodType>(dataSchema: T) => z.object({
    data: dataSchema.optional(),
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    }).optional(),
    timestamp: z.string(),
    requestId: z.string().optional(),
  }),

  // Paginated response
  paginatedResponse: <T extends ZodType>(itemSchema: T) => z.object({
    data: z.array(itemSchema),
    pagination: z.object({
      page: z.number(),
      limit: z.number(),
      total: z.number(),
      totalPages: z.number(),
      hasNext: z.boolean(),
      hasPrev: z.boolean(),
    }),
  }),

  // Health check response
  healthResponse: z.object({
    status: z.enum(['ok', 'degraded', 'error']),
    timestamp: z.string(),
    version: z.string(),
    environment: z.string(),
    services: z.record(z.object({
      status: z.enum(['ok', 'error']),
      latency: z.number().optional(),
      details: z.string().optional(),
    })),
  }),
};

/**
 * Data sanitization utilities
 */
export class DataSanitizer {
  /**
   * Sanitize string input
   */
  static sanitizeString(input: string): string {
    return input
      .trim()
      .replace(/[<>\"'&]/g, '') // Remove potentially dangerous characters
      .substring(0, 10000); // Limit length
  }

  /**
   * Sanitize email
   */
  static sanitizeEmail(email: string): string {
    return email.toLowerCase().trim();
  }

  /**
   * Sanitize URL
   */
  static sanitizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Only allow http and https protocols
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Invalid protocol');
      }
      return parsed.toString();
    } catch {
      throw new ValidationError('Invalid URL format');
    }
  }

  /**
   * Sanitize object (remove dangerous properties)
   */
  static sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
    const dangerous = ['__proto__', 'constructor', 'prototype'];
    const cleaned = { ...obj };
    
    for (const key of dangerous) {
      delete cleaned[key];
    }
    
    return cleaned;
  }

  /**
   * Sanitize HTML (basic)
   */
  static sanitizeHtml(html: string): string {
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '');
  }
}

/**
 * Validation utilities class
 */
export class Validator {
  /**
   * Validate data against schema
   */
  static validate<T>(
    schema: ZodSchema<T>,
    data: unknown,
    options: ValidationOptions = {}
  ): ValidationResult<T> {
    try {
      const result = schema.parse(data);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      if (error instanceof ZodError) {
        const errors: ValidationErrorDetail[] = error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
          value: issue.path.reduce((obj, key) => obj?.[key], data as any),
        }));

        return {
          success: false,
          errors,
        };
      }

      throw error;
    }
  }

  /**
   * Validate and throw on error
   */
  static validateAndThrow<T>(
    schema: ZodSchema<T>,
    data: unknown,
    context?: ErrorContext
  ): T {
    const result = this.validate(schema, data);
    
    if (!result.success) {
      throw new ValidationError(
        'Validation failed',
        result.errors,
        context
      );
    }

    return result.data!;
  }

  /**
   * Validate request body
   */
  static async validateRequestBody<T>(
    request: Request,
    schema: ZodSchema<T>,
    context?: ErrorContext
  ): Promise<T> {
    try {
      const body = await request.json();
      return this.validateAndThrow(schema, body, context);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      
      throw new ValidationError(
        'Invalid JSON in request body',
        error,
        context
      );
    }
  }

  /**
   * Validate query parameters
   */
  static validateQueryParams<T>(
    request: Request,
    schema: ZodSchema<T>,
    context?: ErrorContext
  ): T {
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams.entries());
    
    return this.validateAndThrow(schema, params, context);
  }

  /**
   * Validate headers
   */
  static validateHeaders<T>(
    request: Request,
    schema: ZodSchema<T>,
    context?: ErrorContext
  ): T {
    const headers = Object.fromEntries(request.headers.entries());
    return this.validateAndThrow(schema, headers, context);
  }

  /**
   * Validate file upload
   */
  static validateFile(
    file: File,
    options: {
      maxSize?: number;
      allowedTypes?: string[];
      allowedExtensions?: string[];
    } = {},
    context?: ErrorContext
  ): void {
    const {
      maxSize = 10 * 1024 * 1024, // 10MB
      allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'],
      allowedExtensions = ['.jpg', '.jpeg', '.png', '.pdf'],
    } = options;

    // Check file size
    if (file.size > maxSize) {
      throw new ValidationError(
        `File size exceeds maximum allowed size of ${maxSize} bytes`,
        { size: file.size, maxSize },
        context
      );
    }

    // Check MIME type
    if (!allowedTypes.includes(file.type)) {
      throw new ValidationError(
        `File type ${file.type} is not allowed`,
        { type: file.type, allowedTypes },
        context
      );
    }

    // Check file extension
    const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    if (!allowedExtensions.includes(extension)) {
      throw new ValidationError(
        `File extension ${extension} is not allowed`,
        { extension, allowedExtensions },
        context
      );
    }
  }
}

/**
 * Validation middleware factory
 */
export class ValidationMiddleware {
  /**
   * Create body validation middleware
   */
  static createBodyValidator<T>(schema: ZodSchema<T>) {
    return async (request: Request, context?: ErrorContext): Promise<T> => {
      return Validator.validateRequestBody(request, schema, context);
    };
  }

  /**
   * Create query parameters validation middleware
   */
  static createQueryValidator<T>(schema: ZodSchema<T>) {
    return (request: Request, context?: ErrorContext): T => {
      return Validator.validateQueryParams(request, schema, context);
    };
  }

  /**
   * Create headers validation middleware
   */
  static createHeadersValidator<T>(schema: ZodSchema<T>) {
    return (request: Request, context?: ErrorContext): T => {
      return Validator.validateHeaders(request, schema, context);
    };
  }

  /**
   * Create combined validation middleware
   */
  static createCombinedValidator<B, Q, H>(options: {
    body?: ZodSchema<B>;
    query?: ZodSchema<Q>;
    headers?: ZodSchema<H>;
  }) {
    return async (request: Request, context?: ErrorContext): Promise<{
      body?: B;
      query?: Q;
      headers?: H;
    }> => {
      const result: any = {};

      if (options.body) {
        result.body = await Validator.validateRequestBody(request, options.body, context);
      }

      if (options.query) {
        result.query = Validator.validateQueryParams(request, options.query, context);
      }

      if (options.headers) {
        result.headers = Validator.validateHeaders(request, options.headers, context);
      }

      return result;
    };
  }

  /**
   * Create response validation middleware (for development)
   */
  static createResponseValidator<T>(schema: ZodSchema<T>) {
    return (data: unknown): T => {
      if (!environment.isDevelopment()) {
        return data as T;
      }

      const result = Validator.validate(schema, data);
      if (!result.success) {
        console.warn('Response validation failed:', result.errors);
      }

      return data as T;
    };
  }
}

/**
 * Custom validation rules
 */
export const customValidations = {
  /**
   * Validate strong password
   */
  strongPassword: z.string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/^(?=.*[a-z])/, 'Password must contain lowercase letter')
    .regex(/^(?=.*[A-Z])/, 'Password must contain uppercase letter')
    .regex(/^(?=.*\d)/, 'Password must contain number')
    .regex(/^(?=.*[!@#$%^&*])/, 'Password must contain special character'),

  /**
   * Validate phone number (international format)
   */
  phoneNumber: z.string().regex(
    /^\+[1-9]\d{1,14}$/,
    'Phone number must be in international format (+1234567890)'
  ),

  /**
   * Validate credit card number (basic Luhn algorithm)
   */
  creditCard: z.string().regex(/^\d{13,19}$/).refine((val) => {
    // Luhn algorithm implementation
    let sum = 0;
    let alternate = false;
    for (let i = val.length - 1; i >= 0; i--) {
      let n = parseInt(val.charAt(i), 10);
      if (alternate) {
        n *= 2;
        if (n > 9) n = (n % 10) + 1;
      }
      sum += n;
      alternate = !alternate;
    }
    return sum % 10 === 0;
  }, 'Invalid credit card number'),

  /**
   * Validate semantic version
   */
  semver: z.string().regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
    'Invalid semantic version format'
  ),

  /**
   * Validate slug (URL-friendly string)
   */
  slug: z.string().regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Slug must contain only lowercase letters, numbers, and hyphens'
  ),

  /**
   * Validate hex color
   */
  hexColor: z.string().regex(
    /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/,
    'Invalid hex color format'
  ),

  /**
   * Validate JSON string
   */
  jsonString: z.string().refine((val) => {
    try {
      JSON.parse(val);
      return true;
    } catch {
      return false;
    }
  }, 'Invalid JSON string'),
};

/**
 * Validation utilities export
 */
export const validationUtils = {
  schemas: commonSchemas,
  requests: requestSchemas,
  bodies: bodySchemas,
  responses: responseSchemas,
  custom: customValidations,
  sanitize: DataSanitizer,
  validate: Validator,
  middleware: ValidationMiddleware,

  /**
   * Quick validation functions
   */
  isEmail: (email: string) => commonSchemas.email.safeParse(email).success,
  isUuid: (id: string) => commonSchemas.uuid.safeParse(id).success,
  isUrl: (url: string) => commonSchemas.url.safeParse(url).success,
  
  /**
   * Create validation error from Zod error
   */
  createValidationError: (zodError: ZodError, context?: ErrorContext) => {
    return ErrorResponseFormatter.formatValidationError(zodError, context);
  },
};