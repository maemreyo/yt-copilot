// - Enhanced API key creation with proper validation, rate limiting, and security

import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { hash } from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts';
import { corsHeaders } from '_shared/cors.ts';

/**
 * API Key creation request interface
 */
interface CreateApiKeyRequest {
  name?: string;
  expiresInDays?: number;
  permissions?: string[];
  description?: string;
  metadata?: Record<string, unknown>;
}

/**
 * API Key creation response interface
 */
interface CreateApiKeyResponse {
  apiKey: string; // Only shown once
  id: string;
  keyPrefix: string;
  name: string;
  expiresAt?: string;
  permissions?: string[];
  createdAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Security headers for responses
 */
const securityHeaders = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
};

/**
 * API Key generator utility
 */
class ApiKeyGenerator {
  /**
   * Generate a cryptographically secure API key
   */
  static generateApiKey(): string {
    // Generate 32 bytes of random data and convert to hex
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    return Array.from(randomBytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Extract prefix from API key (first 8 characters)
   */
  static extractPrefix(apiKey: string): string {
    return apiKey.substring(0, 8);
  }

  /**
   * Hash API key using bcrypt
   */
  static async hashApiKey(apiKey: string): Promise<string> {
    const saltRounds = 12;
    return await hash(apiKey, saltRounds);
  }

  /**
   * Generate API key with metadata
   */
  static async generateWithMetadata(): Promise<{
    apiKey: string;
    prefix: string;
    hash: string;
  }> {
    const apiKey = this.generateApiKey();
    const prefix = this.extractPrefix(apiKey);
    const keyHash = await this.hashApiKey(apiKey);

    return {
      apiKey,
      prefix,
      hash: keyHash,
    };
  }
}

/**
 * Request validator
 */
class RequestValidator {
  /**
   * Validate API key creation request
   */
  static validateRequest(data: CreateApiKeyRequest): {
    isValid: boolean;
    errors: string[];
    sanitized: CreateApiKeyRequest;
  } {
    const errors: string[] = [];
    const sanitized: CreateApiKeyRequest = {};

    // Validate name
    if (data.name !== undefined) {
      if (typeof data.name !== 'string') {
        errors.push('Name must be a string');
      } else if (data.name.length === 0) {
        errors.push('Name cannot be empty');
      } else if (data.name.length > 50) {
        errors.push('Name must be 50 characters or less');
      } else if (!/^[a-zA-Z0-9\s\-_]+$/.test(data.name)) {
        errors.push('Name contains invalid characters');
      } else {
        sanitized.name = data.name.trim();
      }
    }

    // Validate expiresInDays
    if (data.expiresInDays !== undefined) {
      if (typeof data.expiresInDays !== 'number') {
        errors.push('expiresInDays must be a number');
      } else if (!Number.isInteger(data.expiresInDays)) {
        errors.push('expiresInDays must be an integer');
      } else if (data.expiresInDays < 1) {
        errors.push('expiresInDays must be at least 1');
      } else if (data.expiresInDays > 365) {
        errors.push('expiresInDays cannot exceed 365');
      } else {
        sanitized.expiresInDays = data.expiresInDays;
      }
    }

    // Validate permissions
    if (data.permissions !== undefined) {
      if (!Array.isArray(data.permissions)) {
        errors.push('Permissions must be an array');
      } else {
        const validPermissions = data.permissions.filter(
          perm => typeof perm === 'string' && perm.length > 0 && perm.length <= 100
        );
        if (validPermissions.length !== data.permissions.length) {
          errors.push('All permissions must be non-empty strings with max 100 characters');
        } else {
          sanitized.permissions = validPermissions;
        }
      }
    }

    // Validate description
    if (data.description !== undefined) {
      if (typeof data.description !== 'string') {
        errors.push('Description must be a string');
      } else if (data.description.length > 500) {
        errors.push('Description must be 500 characters or less');
      } else {
        sanitized.description = data.description.trim();
      }
    }

    // Validate metadata
    if (data.metadata !== undefined) {
      if (typeof data.metadata !== 'object' || Array.isArray(data.metadata)) {
        errors.push('Metadata must be an object');
      } else {
        sanitized.metadata = data.metadata;
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitized,
    };
  }
}

/**
 * Rate limiter for API key creation
 */
class RateLimiter {
  private static userRequests = new Map<string, { count: number; resetTime: number }>();

  /**
   * Check if user can create API key
   */
  static canCreateApiKey(userId: string): {
    allowed: boolean;
    resetTime?: number;
    remaining?: number;
  } {
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute
    const maxRequests = 5; // 5 API keys per minute per user

    const userLimit = this.userRequests.get(userId);

    if (!userLimit || now > userLimit.resetTime) {
      this.userRequests.set(userId, { count: 1, resetTime: now + windowMs });
      return { allowed: true, remaining: maxRequests - 1 };
    }

    if (userLimit.count >= maxRequests) {
      return { 
        allowed: false, 
        resetTime: userLimit.resetTime,
        remaining: 0,
      };
    }

    userLimit.count++;
    return { 
      allowed: true, 
      remaining: maxRequests - userLimit.count,
    };
  }
}

/**
 * API Key service
 */
class ApiKeyService {
  private supabase: any;

  constructor() {
    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );
  }

  /**
   * Check user's existing API key count
   */
  async checkUserKeyLimit(userId: string): Promise<{
    count: number;
    limit: number;
    canCreate: boolean;
  }> {
    const limit = 10; // Maximum 10 API keys per user

    const { count, error } = await this.supabase
      .from('api_keys')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to check API key count: ${error.message}`);
    }

    return {
      count: count || 0,
      limit,
      canCreate: (count || 0) < limit,
    };
  }

  /**
   * Create API key in database
   */
  async createApiKey(
    userId: string,
    keyData: {
      hash: string;
      prefix: string;
      name: string;
      expiresAt?: string;
      permissions?: string[];
      description?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<any> {
    const { data, error } = await this.supabase
      .from('api_keys')
      .insert({
        user_id: userId,
        key_hash: keyData.hash,
        key_prefix: keyData.prefix,
        name: keyData.name,
        expires_at: keyData.expiresAt,
        permissions: keyData.permissions ? JSON.stringify(keyData.permissions) : null,
        description: keyData.description,
        metadata: keyData.metadata ? JSON.stringify(keyData.metadata) : null,
      })
      .select('id, key_prefix, name, expires_at, permissions, description, metadata, created_at')
      .single();

    if (error) {
      throw new Error(`Failed to create API key: ${error.message}`);
    }

    return data;
  }

  /**
   * Get user profile information
   */
  async getUserProfile(userId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('stripe_subscription_status')
      .eq('id', userId)
      .single();

    if (error) {
      console.warn('Failed to fetch user profile:', error);
      return null;
    }

    return data;
  }
}

/**
 * Main serve function
 */
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: { ...corsHeaders },
    });
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'Only POST method is allowed',
        },
        timestamp: new Date().toISOString(),
      }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          ...securityHeaders,
          'Allow': 'POST, OPTIONS',
        },
      }
    );
  }

  const requestId = crypto.randomUUID();

  try {
    // Initialize services
    const apiKeyService = new ApiKeyService();

    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'AUTHENTICATION_ERROR',
            message: 'Missing or invalid authorization header',
          },
          timestamp: new Date().toISOString(),
          requestId,
        }),
        {
          status: 401,
          headers: { ...corsHeaders, ...securityHeaders },
        }
      );
    }

    const token = authHeader.substring(7);

    // Verify JWT and get user
    const { data: { user }, error: userError } = await apiKeyService.supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'AUTHENTICATION_ERROR',
            message: 'Invalid or expired token',
          },
          timestamp: new Date().toISOString(),
          requestId,
        }),
        {
          status: 401,
          headers: { ...corsHeaders, ...securityHeaders },
        }
      );
    }

    // Check rate limiting
    const rateLimitResult = RateLimiter.canCreateApiKey(user.id);
    if (!rateLimitResult.allowed) {
      const retryAfter = Math.ceil((rateLimitResult.resetTime! - Date.now()) / 1000);
      
      return new Response(
        JSON.stringify({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many API key creation requests',
            details: { retryAfter },
          },
          timestamp: new Date().toISOString(),
          requestId,
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            ...securityHeaders,
            'Retry-After': retryAfter.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': rateLimitResult.resetTime!.toString(),
          },
        }
      );
    }

    // Parse and validate request body
    let requestData: CreateApiKeyRequest;
    try {
      requestData = await req.json();
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid JSON in request body',
          },
          timestamp: new Date().toISOString(),
          requestId,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, ...securityHeaders },
        }
      );
    }

    // Validate request data
    const validation = RequestValidator.validateRequest(requestData);
    if (!validation.isValid) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: validation.errors,
          },
          timestamp: new Date().toISOString(),
          requestId,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, ...securityHeaders },
        }
      );
    }

    // Check user's API key limit
    const keyLimit = await apiKeyService.checkUserKeyLimit(user.id);
    if (!keyLimit.canCreate) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'BUSINESS_RULE_VIOLATION',
            message: `API key limit exceeded. Maximum ${keyLimit.limit} keys allowed.`,
            details: { current: keyLimit.count, limit: keyLimit.limit },
          },
          timestamp: new Date().toISOString(),
          requestId,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, ...securityHeaders },
        }
      );
    }

    // Generate API key
    const { apiKey, prefix, hash } = await ApiKeyGenerator.generateWithMetadata();

    // Calculate expiration date
    let expiresAt: string | undefined;
    if (validation.sanitized.expiresInDays) {
      const expireDate = new Date();
      expireDate.setDate(expireDate.getDate() + validation.sanitized.expiresInDays);
      expiresAt = expireDate.toISOString();
    }

    // Create API key in database
    const apiKeyData = await apiKeyService.createApiKey(user.id, {
      hash,
      prefix,
      name: validation.sanitized.name || 'API Key',
      expiresAt,
      permissions: validation.sanitized.permissions,
      description: validation.sanitized.description,
      metadata: validation.sanitized.metadata,
    });

    // Prepare response
    const response: CreateApiKeyResponse = {
      apiKey, // This is the only time the plain API key is returned
      id: apiKeyData.id,
      keyPrefix: apiKeyData.key_prefix,
      name: apiKeyData.name,
      expiresAt: apiKeyData.expires_at,
      permissions: apiKeyData.permissions ? JSON.parse(apiKeyData.permissions) : undefined,
      createdAt: apiKeyData.created_at,
      metadata: apiKeyData.metadata ? JSON.parse(apiKeyData.metadata) : undefined,
    };

    return new Response(
      JSON.stringify(response, null, 2),
      {
        status: 201,
        headers: {
          ...corsHeaders,
          ...securityHeaders,
          'X-Request-ID': requestId,
          'X-RateLimit-Remaining': rateLimitResult.remaining?.toString() || '0',
        },
      }
    );

  } catch (error) {
    console.error('API key creation error:', error);

    return new Response(
      JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          details: Deno.env.get('NODE_ENV') === 'development' ? error.message : undefined,
        },
        timestamp: new Date().toISOString(),
        requestId,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, ...securityHeaders },
      }
    );
  }
});