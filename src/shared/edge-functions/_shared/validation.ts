// Validation utilities for Supabase Edge Functions

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  sanitized?: unknown;
}

/**
 * Validate email format
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate UUID format
 */
export function validateUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Validate URL format
 */
export function validateUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate Stripe price ID
 */
export function validateStripePriceId(priceId: string): boolean {
  return typeof priceId === 'string' && priceId.startsWith('price_') && priceId.length > 6;
}

/**
 * Validate Stripe customer ID
 */
export function validateStripeCustomerId(customerId: string): boolean {
  return typeof customerId === 'string' && customerId.startsWith('cus_') && customerId.length > 4;
}

/**
 * Validate request body against schema
 */
export function validateRequestBody<T>(
  body: unknown,
  schema: ValidationSchema<T>
): ValidationResult {
  const errors: string[] = [];
  const sanitized: Partial<T> = {};

  if (!body || typeof body !== 'object') {
    return {
      isValid: false,
      errors: ['Request body must be a valid JSON object'],
    };
  }

  const data = body as Record<string, unknown>;

  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];
    const fieldRules = rules as FieldValidationRules;

    // Check required fields
    if (fieldRules.required && (value === undefined || value === null)) {
      errors.push(`Field '${field}' is required`);
      continue;
    }

    // Skip validation for optional undefined fields
    if (!fieldRules.required && (value === undefined || value === null)) {
      continue;
    }

    // Type validation
    if (fieldRules.type && !validateFieldType(value, fieldRules.type)) {
      errors.push(`Field '${field}' must be of type ${fieldRules.type}`);
      continue;
    }

    // Custom validation
    if (fieldRules.validate) {
      const customResult = fieldRules.validate(value);
      if (!customResult.isValid) {
        errors.push(...customResult.errors.map(err => `Field '${field}': ${err}`));
        continue;
      }
    }

    // Sanitization
    let sanitizedValue = value;
    if (fieldRules.sanitize) {
      sanitizedValue = fieldRules.sanitize(value);
    }

    (sanitized as any)[field] = sanitizedValue;
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: sanitized as T,
  };
}

/**
 * Field validation rules interface
 */
export interface FieldValidationRules {
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
  validate?: (value: unknown) => ValidationResult;
  sanitize?: (value: unknown) => unknown;
}

/**
 * Validation schema type
 */
export type ValidationSchema<T> = {
  [K in keyof T]: FieldValidationRules;
};

/**
 * Validate field type
 */
function validateFieldType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !isNaN(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    default:
      return false;
  }
}

/**
 * Common validation schemas
 */
export const commonValidations = {
  email: (value: unknown): ValidationResult => {
    if (typeof value !== 'string') {
      return { isValid: false, errors: ['Must be a string'] };
    }
    if (!validateEmail(value)) {
      return { isValid: false, errors: ['Must be a valid email address'] };
    }
    return { isValid: true, errors: [] };
  },

  uuid: (value: unknown): ValidationResult => {
    if (typeof value !== 'string') {
      return { isValid: false, errors: ['Must be a string'] };
    }
    if (!validateUUID(value)) {
      return { isValid: false, errors: ['Must be a valid UUID'] };
    }
    return { isValid: true, errors: [] };
  },

  url: (value: unknown): ValidationResult => {
    if (typeof value !== 'string') {
      return { isValid: false, errors: ['Must be a string'] };
    }
    if (!validateUrl(value)) {
      return { isValid: false, errors: ['Must be a valid URL'] };
    }
    return { isValid: true, errors: [] };
  },

  stripePriceId: (value: unknown): ValidationResult => {
    if (typeof value !== 'string') {
      return { isValid: false, errors: ['Must be a string'] };
    }
    if (!validateStripePriceId(value)) {
      return { isValid: false, errors: ['Must be a valid Stripe price ID'] };
    }
    return { isValid: true, errors: [] };
  },

  nonEmptyString: (value: unknown): ValidationResult => {
    if (typeof value !== 'string') {
      return { isValid: false, errors: ['Must be a string'] };
    }
    if (value.trim().length === 0) {
      return { isValid: false, errors: ['Must not be empty'] };
    }
    return { isValid: true, errors: [] };
  },

  positiveNumber: (value: unknown): ValidationResult => {
    if (typeof value !== 'number') {
      return { isValid: false, errors: ['Must be a number'] };
    }
    if (value <= 0) {
      return { isValid: false, errors: ['Must be a positive number'] };
    }
    return { isValid: true, errors: [] };
  },
};

/**
 * Common sanitization functions
 */
export const commonSanitizers = {
  trimString: (value: unknown): unknown => {
    return typeof value === 'string' ? value.trim() : value;
  },

  toLowerCase: (value: unknown): unknown => {
    return typeof value === 'string' ? value.toLowerCase() : value;
  },

  normalizeEmail: (value: unknown): unknown => {
    return typeof value === 'string' ? value.trim().toLowerCase() : value;
  },

  removeHtml: (value: unknown): unknown => {
    if (typeof value !== 'string') return value;
    return value.replace(/<[^>]*>/g, '');
  },
};

/**
 * Validate pagination parameters
 */
export function validatePagination(params: {
  page?: unknown;
  limit?: unknown;
}): ValidationResult {
  const errors: string[] = [];
  const sanitized: { page: number; limit: number } = { page: 1, limit: 10 };

  // Validate page
  if (params.page !== undefined) {
    const page = Number(params.page);
    if (isNaN(page) || page < 1) {
      errors.push('Page must be a positive integer');
    } else {
      sanitized.page = Math.floor(page);
    }
  }

  // Validate limit
  if (params.limit !== undefined) {
    const limit = Number(params.limit);
    if (isNaN(limit) || limit < 1 || limit > 100) {
      errors.push('Limit must be between 1 and 100');
    } else {
      sanitized.limit = Math.floor(limit);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized,
  };
}

/**
 * Create validation middleware
 */
export function createValidationMiddleware<T>(schema: ValidationSchema<T>) {
  return async (request: Request): Promise<{
    isValid: boolean;
    data?: T;
    errors?: string[];
  }> => {
    try {
      const body = await request.json();
      const result = validateRequestBody<T>(body, schema);
      
      return {
        isValid: result.isValid,
        data: result.sanitized,
        errors: result.errors,
      };
    } catch (error) {
      return {
        isValid: false,
        errors: ['Invalid JSON in request body'],
      };
    }
  };
}