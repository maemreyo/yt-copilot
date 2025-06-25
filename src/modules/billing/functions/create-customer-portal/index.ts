// - Stripe customer portal creation with comprehensive validation and error handling

import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { corsHeaders } from '_shared/cors.ts';

/**
 * Customer portal request interface
 */
interface CreateCustomerPortalRequest {
  returnUrl?: string;
  configuration?: string;
  locale?: string;
}

/**
 * Customer portal response interface
 */
interface CreateCustomerPortalResponse {
  url: string;
  sessionId: string;
  customerId: string;
  expiresAt: string;
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
 * Request validator for customer portal creation
 */
class CustomerPortalValidator {
  /**
   * Validate customer portal creation request
   */
  static validateRequest(data: CreateCustomerPortalRequest): {
    isValid: boolean;
    errors: string[];
    sanitized: CreateCustomerPortalRequest;
  } {
    const errors: string[] = [];
    const sanitized: CreateCustomerPortalRequest = {};

    // Validate returnUrl (optional)
    if (data.returnUrl !== undefined) {
      if (typeof data.returnUrl !== 'string') {
        errors.push('returnUrl must be a string');
      } else {
        try {
          const url = new URL(data.returnUrl);
          // Only allow http/https protocols
          if (!['http:', 'https:'].includes(url.protocol)) {
            errors.push('returnUrl must use http or https protocol');
          } else {
            sanitized.returnUrl = data.returnUrl;
          }
        } catch {
          errors.push('returnUrl must be a valid URL');
        }
      }
    }

    // Validate configuration (optional Stripe portal configuration ID)
    if (data.configuration !== undefined) {
      if (typeof data.configuration !== 'string') {
        errors.push('configuration must be a string');
      } else if (!/^bpc_[a-zA-Z0-9]+$/.test(data.configuration)) {
        errors.push('configuration must be a valid Stripe portal configuration ID');
      } else {
        sanitized.configuration = data.configuration;
      }
    }

    // Validate locale (optional)
    if (data.locale !== undefined) {
      if (typeof data.locale !== 'string') {
        errors.push('locale must be a string');
      } else {
        const validLocales = [
          'auto', 'bg', 'cs', 'da', 'de', 'el', 'en', 'en-GB', 'es', 'es-419',
          'et', 'fi', 'fil', 'fr', 'fr-CA', 'hr', 'hu', 'id', 'it', 'ja', 'ko',
          'lt', 'lv', 'ms', 'mt', 'nb', 'nl', 'pl', 'pt', 'pt-BR', 'ro', 'ru',
          'sk', 'sl', 'sv', 'th', 'tr', 'vi', 'zh', 'zh-HK', 'zh-TW'
        ];
        
        if (!validLocales.includes(data.locale)) {
          errors.push(`locale must be one of: ${validLocales.join(', ')}`);
        } else {
          sanitized.locale = data.locale;
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitized,
    };
  }

  /**
   * Validate return URL against allowed domains
   */
  static validateReturnUrlDomain(returnUrl: string, allowedDomains: string[]): boolean {
    try {
      const url = new URL(returnUrl);
      const hostname = url.hostname.toLowerCase();
      
      return allowedDomains.some(domain => {
        const lowerDomain = domain.toLowerCase();
        return hostname === lowerDomain || hostname.endsWith(`.${lowerDomain}`);
      });
    } catch {
      return false;
    }
  }
}

/**
 * Rate limiter for customer portal creation
 */
class CustomerPortalRateLimiter {
  private static userRequests = new Map<string, { count: number; resetTime: number }>();

  /**
   * Check if user can create customer portal session
   */
  static canCreatePortalSession(userId: string): {
    allowed: boolean;
    resetTime?: number;
    remaining?: number;
  } {
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute
    const maxRequests = 5; // 5 portal sessions per minute per user

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
 * Customer portal service
 */
class CustomerPortalService {
  private stripe: Stripe;
  private supabase: any;

  constructor() {
    this.stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
      apiVersion: '2023-10-16',
    });

    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );
  }

  /**
   * Get user's Stripe customer ID
   */
  async getUserCustomerId(userId: string): Promise<{
    customerId?: string;
    hasActiveSubscription: boolean;
    subscriptionStatus?: string;
  }> {
    const { data: profile, error } = await this.supabase
      .from('profiles')
      .select('stripe_customer_id, stripe_subscription_id, stripe_subscription_status')
      .eq('id', userId)
      .single();

    if (error) {
      throw new Error(`Failed to fetch user profile: ${error.message}`);
    }

    if (!profile) {
      throw new Error('User profile not found');
    }

    return {
      customerId: profile.stripe_customer_id,
      hasActiveSubscription: Boolean(profile.stripe_subscription_id),
      subscriptionStatus: profile.stripe_subscription_status,
    };
  }

  /**
   * Create or retrieve Stripe customer
   */
  async ensureStripeCustomer(userId: string, userEmail: string): Promise<string> {
    const userProfile = await this.getUserCustomerId(userId);
    
    if (userProfile.customerId) {
      // Verify customer exists in Stripe
      try {
        await this.stripe.customers.retrieve(userProfile.customerId);
        return userProfile.customerId;
      } catch (error) {
        console.warn('Stripe customer not found, creating new one:', error);
      }
    }

    // Create new Stripe customer
    const customer = await this.stripe.customers.create({
      email: userEmail,
      metadata: {
        supabase_id: userId,
      },
    });

    // Update user profile with new customer ID
    const { error: updateError } = await this.supabase
      .from('profiles')
      .update({ stripe_customer_id: customer.id })
      .eq('id', userId);

    if (updateError) {
      console.error('Failed to update profile with Stripe customer ID:', updateError);
    }

    return customer.id;
  }

  /**
   * Create customer portal session
   */
  async createPortalSession(
    customerId: string,
    request: CreateCustomerPortalRequest
  ): Promise<{
    sessionId: string;
    url: string;
    expiresAt: string;
  }> {
    const appUrl = Deno.env.get('APP_URL') || 'http://localhost:3000';
    const defaultReturnUrl = `${appUrl}/billing`;

    const sessionParams: Stripe.BillingPortal.SessionCreateParams = {
      customer: customerId,
      return_url: request.returnUrl || defaultReturnUrl,
    };

    // Add optional parameters
    if (request.configuration) {
      sessionParams.configuration = request.configuration;
    }

    if (request.locale) {
      sessionParams.locale = request.locale as any;
    }

    try {
      const session = await this.stripe.billingPortal.sessions.create(sessionParams);
      
      // Calculate expiration time (Stripe portal sessions expire after 24 hours)
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      return {
        sessionId: session.id,
        url: session.url,
        expiresAt,
      };
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError) {
        throw new Error(`Stripe error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Log customer portal access for audit
   */
  async logPortalAccess(
    userId: string,
    customerId: string,
    sessionId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    // In production, this would go to an audit log table
    console.log('CUSTOMER_PORTAL_ACCESS:', {
      userId,
      customerId,
      sessionId,
      timestamp: new Date().toISOString(),
      metadata,
    });
  }

  /**
   * Get allowed return URL domains
   */
  getAllowedDomains(): string[] {
    const appUrl = Deno.env.get('APP_URL') || 'http://localhost:3000';
    const allowedDomains = [new URL(appUrl).hostname];
    
    // Add additional allowed domains from environment
    const additionalDomains = Deno.env.get('ALLOWED_RETURN_DOMAINS');
    if (additionalDomains) {
      allowedDomains.push(...additionalDomains.split(',').map(d => d.trim()));
    }
    
    return allowedDomains;
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
    // Initialize service
    const portalService = new CustomerPortalService();

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
    const { data: { user }, error: userError } = await portalService.supabase.auth.getUser(token);

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
    const rateLimitResult = CustomerPortalRateLimiter.canCreatePortalSession(user.id);
    if (!rateLimitResult.allowed) {
      const retryAfter = Math.ceil((rateLimitResult.resetTime! - Date.now()) / 1000);
      
      return new Response(
        JSON.stringify({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many customer portal requests',
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
    let requestData: CreateCustomerPortalRequest = {};
    try {
      const body = await req.text();
      if (body.trim()) {
        requestData = JSON.parse(body);
      }
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
    const validation = CustomerPortalValidator.validateRequest(requestData);
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

    // Validate return URL domain if provided
    if (validation.sanitized.returnUrl) {
      const allowedDomains = portalService.getAllowedDomains();
      if (!CustomerPortalValidator.validateReturnUrlDomain(validation.sanitized.returnUrl, allowedDomains)) {
        return new Response(
          JSON.stringify({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Return URL domain not allowed',
              details: { allowedDomains },
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
    }

    // Ensure user has Stripe customer
    const customerId = await portalService.ensureStripeCustomer(user.id, user.email!);

    // Create customer portal session
    const portalSession = await portalService.createPortalSession(customerId, validation.sanitized);

    // Log portal access for audit
    await portalService.logPortalAccess(user.id, customerId, portalSession.sessionId, {
      requestId,
      returnUrl: validation.sanitized.returnUrl,
      userAgent: req.headers.get('user-agent'),
    });

    // Prepare response
    const response: CreateCustomerPortalResponse = {
      url: portalSession.url,
      sessionId: portalSession.sessionId,
      customerId,
      expiresAt: portalSession.expiresAt,
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
    console.error('Customer portal creation error:', error);

    // Handle specific Stripe errors
    if (error.message?.includes('Stripe error:')) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'EXTERNAL_SERVICE_ERROR',
            message: 'Payment service error',
            details: Deno.env.get('NODE_ENV') === 'development' ? error.message : undefined,
          },
          timestamp: new Date().toISOString(),
          requestId,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, ...securityHeaders },
        }
      );
    }

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