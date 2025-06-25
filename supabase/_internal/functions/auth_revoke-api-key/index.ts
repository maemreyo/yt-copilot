// - API key revocation with proper authorization, audit logging, and validation

import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '_shared/cors.ts';

/**
 * API Key revocation request interface
 */
interface RevokeApiKeyRequest {
  keyPrefix: string;
  reason?: string;
  notifyUser?: boolean;
}

/**
 * API Key revocation response interface
 */
interface RevokeApiKeyResponse {
  success: boolean;
  keyPrefix: string;
  revokedAt: string;
  message: string;
  auditLog?: {
    id: string;
    action: string;
    timestamp: string;
  };
}

/**
 * Audit log entry interface
 */
interface AuditLogEntry {
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details: Record<string, unknown>;
  timestamp: string;
  ipAddress?: string;
  userAgent?: string;
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
 * Request validator for API key revocation
 */
class RevocationValidator {
  /**
   * Validate API key revocation request
   */
  static validateRequest(data: RevokeApiKeyRequest): {
    isValid: boolean;
    errors: string[];
    sanitized: RevokeApiKeyRequest;
  } {
    const errors: string[] = [];
    const sanitized: RevokeApiKeyRequest = {
      keyPrefix: '',
    };

    // Validate keyPrefix (required)
    if (!data.keyPrefix) {
      errors.push('keyPrefix is required');
    } else if (typeof data.keyPrefix !== 'string') {
      errors.push('keyPrefix must be a string');
    } else if (!/^[a-zA-Z0-9]{8}$/.test(data.keyPrefix)) {
      errors.push('keyPrefix must be exactly 8 alphanumeric characters');
    } else {
      sanitized.keyPrefix = data.keyPrefix.toLowerCase();
    }

    // Validate reason (optional)
    if (data.reason !== undefined) {
      if (typeof data.reason !== 'string') {
        errors.push('reason must be a string');
      } else if (data.reason.length > 500) {
        errors.push('reason must be 500 characters or less');
      } else {
        sanitized.reason = data.reason.trim();
      }
    }

    // Validate notifyUser (optional)
    if (data.notifyUser !== undefined) {
      if (typeof data.notifyUser !== 'boolean') {
        errors.push('notifyUser must be a boolean');
      } else {
        sanitized.notifyUser = data.notifyUser;
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
 * Rate limiter for API key revocation
 */
class RevocationRateLimiter {
  private static userRequests = new Map<string, { count: number; resetTime: number }>();

  /**
   * Check if user can revoke API key
   */
  static canRevokeApiKey(userId: string): {
    allowed: boolean;
    resetTime?: number;
    remaining?: number;
  } {
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute
    const maxRequests = 10; // 10 revocations per minute per user

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
 * API Key revocation service
 */
class ApiKeyRevocationService {
  private supabase: any;

  constructor() {
    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );
  }

  /**
   * Find API key by prefix and verify ownership
   */
  async findAndVerifyApiKey(keyPrefix: string, userId: string): Promise<{
    found: boolean;
    apiKey?: any;
    isOwner: boolean;
  }> {
    const { data: apiKey, error } = await this.supabase
      .from('api_keys')
      .select('id, user_id, name, key_prefix, created_at, expires_at')
      .eq('key_prefix', keyPrefix)
      .single();

    if (error || !apiKey) {
      return { found: false, isOwner: false };
    }

    return {
      found: true,
      apiKey,
      isOwner: apiKey.user_id === userId,
    };
  }

  /**
   * Revoke API key (soft delete)
   */
  async revokeApiKey(keyPrefix: string, userId: string, reason?: string): Promise<{
    success: boolean;
    apiKey?: any;
  }> {
    // First verify the key exists and belongs to the user
    const verification = await this.findAndVerifyApiKey(keyPrefix, userId);
    
    if (!verification.found) {
      throw new Error('API key not found');
    }

    if (!verification.isOwner) {
      throw new Error('Unauthorized to revoke this API key');
    }

    // Mark the API key as revoked (soft delete)
    const { data, error } = await this.supabase
      .from('api_keys')
      .update({
        revoked_at: new Date().toISOString(),
        revocation_reason: reason || 'Revoked by user',
        updated_at: new Date().toISOString(),
      })
      .eq('key_prefix', keyPrefix)
      .eq('user_id', userId)
      .select('id, name, key_prefix, revoked_at')
      .single();

    if (error) {
      throw new Error(`Failed to revoke API key: ${error.message}`);
    }

    return {
      success: true,
      apiKey: data,
    };
  }

  /**
   * Create audit log entry
   */
  async createAuditLog(entry: AuditLogEntry): Promise<string> {
    // In a production system, this would go to a dedicated audit table
    // For now, we'll just log it
    const auditId = crypto.randomUUID();
    
    console.log('AUDIT LOG:', {
      id: auditId,
      ...entry,
    });

    // TODO: Implement actual audit log storage
    // const { data, error } = await this.supabase
    //   .from('audit_logs')
    //   .insert({
    //     id: auditId,
    //     user_id: entry.userId,
    //     action: entry.action,
    //     resource_type: entry.resourceType,
    //     resource_id: entry.resourceId,
    //     details: entry.details,
    //     ip_address: entry.ipAddress,
    //     user_agent: entry.userAgent,
    //     created_at: entry.timestamp,
    //   });

    return auditId;
  }

  /**
   * Check if user has active subscription (for audit features)
   */
  async hasActiveSubscription(userId: string): Promise<boolean> {
    try {
      const { data: profile } = await this.supabase
        .from('profiles')
        .select('stripe_subscription_status')
        .eq('id', userId)
        .single();

      return profile?.stripe_subscription_status === 'active';
    } catch {
      return false;
    }
  }

  /**
   * Send notification about API key revocation (if enabled)
   */
  async sendRevocationNotification(
    userId: string, 
    keyName: string, 
    keyPrefix: string
  ): Promise<void> {
    // TODO: Implement email notification via Resend
    console.log(`[NOTIFICATION] API key revoked for user ${userId}: ${keyName} (${keyPrefix})`);
    
    // In production, this would send an email:
    // - Key name and prefix
    // - Revocation timestamp
    // - Instructions for creating new keys if needed
    // - Security recommendations
  }
}

/**
 * Extract request metadata for audit logging
 */
function extractRequestMetadata(req: Request): {
  ipAddress?: string;
  userAgent?: string;
} {
  return {
    ipAddress: req.headers.get('cf-connecting-ip') || 
              req.headers.get('x-forwarded-for') || 
              req.headers.get('x-real-ip') || 
              'unknown',
    userAgent: req.headers.get('user-agent') || 'unknown',
  };
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

  // Only allow DELETE requests
  if (req.method !== 'DELETE') {
    return new Response(
      JSON.stringify({
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'Only DELETE method is allowed',
        },
        timestamp: new Date().toISOString(),
      }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          ...securityHeaders,
          'Allow': 'DELETE, OPTIONS',
        },
      }
    );
  }

  const requestId = crypto.randomUUID();
  const requestMetadata = extractRequestMetadata(req);

  try {
    // Initialize service
    const revocationService = new ApiKeyRevocationService();

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
    const { data: { user }, error: userError } = await revocationService.supabase.auth.getUser(token);

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
    const rateLimitResult = RevocationRateLimiter.canRevokeApiKey(user.id);
    if (!rateLimitResult.allowed) {
      const retryAfter = Math.ceil((rateLimitResult.resetTime! - Date.now()) / 1000);
      
      return new Response(
        JSON.stringify({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many API key revocation requests',
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
    let requestData: RevokeApiKeyRequest;
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
    const validation = RevocationValidator.validateRequest(requestData);
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

    // Revoke the API key
    try {
      const result = await revocationService.revokeApiKey(
        validation.sanitized.keyPrefix,
        user.id,
        validation.sanitized.reason
      );

      const revokedAt = new Date().toISOString();

      // Create audit log entry
      const auditLogId = await revocationService.createAuditLog({
        userId: user.id,
        action: 'api_key_revoked',
        resourceType: 'api_key',
        resourceId: validation.sanitized.keyPrefix,
        details: {
          keyPrefix: validation.sanitized.keyPrefix,
          reason: validation.sanitized.reason,
          requestId,
        },
        timestamp: revokedAt,
        ipAddress: requestMetadata.ipAddress,
        userAgent: requestMetadata.userAgent,
      });

      // Send notification if requested
      if (validation.sanitized.notifyUser) {
        try {
          await revocationService.sendRevocationNotification(
            user.id,
            result.apiKey.name,
            validation.sanitized.keyPrefix
          );
        } catch (error) {
          console.warn('Failed to send revocation notification:', error);
        }
      }

      // Prepare response
      const response: RevokeApiKeyResponse = {
        success: true,
        keyPrefix: validation.sanitized.keyPrefix,
        revokedAt,
        message: 'API key successfully revoked',
        auditLog: {
          id: auditLogId,
          action: 'api_key_revoked',
          timestamp: revokedAt,
        },
      };

      return new Response(
        JSON.stringify(response, null, 2),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            ...securityHeaders,
            'X-Request-ID': requestId,
            'X-RateLimit-Remaining': rateLimitResult.remaining?.toString() || '0',
          },
        }
      );

    } catch (error) {
      // Handle specific errors
      if (error.message === 'API key not found') {
        return new Response(
          JSON.stringify({
            error: {
              code: 'NOT_FOUND',
              message: 'API key not found',
              details: { keyPrefix: validation.sanitized.keyPrefix },
            },
            timestamp: new Date().toISOString(),
            requestId,
          }),
          {
            status: 404,
            headers: { ...corsHeaders, ...securityHeaders },
          }
        );
      }

      if (error.message === 'Unauthorized to revoke this API key') {
        return new Response(
          JSON.stringify({
            error: {
              code: 'AUTHORIZATION_ERROR',
              message: 'Insufficient permissions to revoke this API key',
            },
            timestamp: new Date().toISOString(),
            requestId,
          }),
          {
            status: 403,
            headers: { ...corsHeaders, ...securityHeaders },
          }
        );
      }

      throw error; // Re-throw other errors
    }

  } catch (error) {
    console.error('API key revocation error:', error);

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