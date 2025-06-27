// - Enhanced checkout session endpoint using Layer 1 & 2 utilities

import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import {
  createCorsErrorResponse,
  createCorsResponse,
  createCorsSuccessResponse,
} from '@/cors';
import {
  AppError,
  createAppError,
  ErrorType,
  handleUnknownError,
} from '@/shared-errors';

/**
 * Checkout session request interface
 */
interface CheckoutSessionRequest {
  priceId: string;
  successUrl?: string;
  cancelUrl?: string;
  quantity?: number;
  metadata?: Record<string, string>;
  allowPromotionCodes?: boolean;
  billingAddressCollection?: 'auto' | 'required';
  customerEmail?: string;
  locale?: string;
}

/**
 * Checkout session response interface
 */
interface CheckoutSessionResponse {
  success: boolean;
  sessionId: string;
  url: string;
  expiresAt: string;
  customerId: string;
  message: string;
}

/**
 * Enhanced checkout session service
 */
class EnhancedCheckoutService {
  private stripe: Stripe;
  private supabase: any;

  constructor() {
    this.stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    });

    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
      {
        auth: { persistSession: false },
        global: {
          headers: { 'x-application-name': 'enhanced-checkout-service' },
        },
      },
    );
  }

  /**
   * Validate checkout session request
   */
  validateRequest(request: CheckoutSessionRequest): {
    isValid: boolean;
    errors: string[];
    sanitized: CheckoutSessionRequest;
  } {
    const errors: string[] = [];
    const sanitized: CheckoutSessionRequest = {
      priceId: '',
    };

    // Validate priceId (required)
    if (!request.priceId) {
      errors.push('priceId is required');
    } else if (typeof request.priceId !== 'string') {
      errors.push('priceId must be a string');
    } else if (!request.priceId.startsWith('price_')) {
      errors.push('priceId must be a valid Stripe price ID');
    } else {
      sanitized.priceId = request.priceId.trim();
    }

    // Validate successUrl (optional)
    if (request.successUrl !== undefined) {
      if (typeof request.successUrl !== 'string') {
        errors.push('successUrl must be a string');
      } else if (!this.isValidUrl(request.successUrl)) {
        errors.push('successUrl must be a valid URL');
      } else {
        sanitized.successUrl = request.successUrl.trim();
      }
    }

    // Validate cancelUrl (optional)
    if (request.cancelUrl !== undefined) {
      if (typeof request.cancelUrl !== 'string') {
        errors.push('cancelUrl must be a string');
      } else if (!this.isValidUrl(request.cancelUrl)) {
        errors.push('cancelUrl must be a valid URL');
      } else {
        sanitized.cancelUrl = request.cancelUrl.trim();
      }
    }

    // Validate quantity (optional)
    if (request.quantity !== undefined) {
      if (
        typeof request.quantity !== 'number' || request.quantity < 1 ||
        request.quantity > 100
      ) {
        errors.push('quantity must be a number between 1 and 100');
      } else {
        sanitized.quantity = Math.floor(request.quantity);
      }
    }

    // Validate metadata (optional)
    if (request.metadata !== undefined) {
      if (typeof request.metadata !== 'object' || request.metadata === null) {
        errors.push('metadata must be an object');
      } else {
        const metadataKeys = Object.keys(request.metadata);
        if (metadataKeys.length > 50) {
          errors.push('metadata cannot have more than 50 keys');
        }

        for (const [key, value] of Object.entries(request.metadata)) {
          if (typeof key !== 'string' || key.length > 40) {
            errors.push('metadata keys must be strings with max 40 characters');
            break;
          }
          if (typeof value !== 'string' || value.length > 500) {
            errors.push(
              'metadata values must be strings with max 500 characters',
            );
            break;
          }
        }

        if (errors.length === 0) {
          sanitized.metadata = request.metadata;
        }
      }
    }

    // Validate allowPromotionCodes (optional)
    if (request.allowPromotionCodes !== undefined) {
      if (typeof request.allowPromotionCodes !== 'boolean') {
        errors.push('allowPromotionCodes must be a boolean');
      } else {
        sanitized.allowPromotionCodes = request.allowPromotionCodes;
      }
    }

    // Validate billingAddressCollection (optional)
    if (request.billingAddressCollection !== undefined) {
      if (!['auto', 'required'].includes(request.billingAddressCollection)) {
        errors.push('billingAddressCollection must be "auto" or "required"');
      } else {
        sanitized.billingAddressCollection = request.billingAddressCollection;
      }
    }

    // Validate customerEmail (optional)
    if (request.customerEmail !== undefined) {
      if (typeof request.customerEmail !== 'string') {
        errors.push('customerEmail must be a string');
      } else if (!this.isValidEmail(request.customerEmail)) {
        errors.push('customerEmail must be a valid email address');
      } else {
        sanitized.customerEmail = request.customerEmail.trim().toLowerCase();
      }
    }

    // Validate locale (optional)
    if (request.locale !== undefined) {
      if (typeof request.locale !== 'string') {
        errors.push('locale must be a string');
      } else if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(request.locale)) {
        errors.push('locale must be a valid locale code (e.g., "en", "en-US")');
      } else {
        sanitized.locale = request.locale;
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitized,
    };
  }

  /**
   * Create checkout session
   */
  async createCheckoutSession(
    userId: string,
    userEmail: string,
    request: CheckoutSessionRequest,
  ): Promise<CheckoutSessionResponse> {
    try {
      // Get or create Stripe customer
      const customerId = await this.getOrCreateCustomer(userId, userEmail);

      // Validate price exists and is active
      await this.validatePrice(request.priceId);

      // Create checkout session
      const session = await this.stripe.checkout.sessions.create({
        customer: customerId,
        line_items: [
          {
            price: request.priceId,
            quantity: request.quantity || 1,
          },
        ],
        mode: 'subscription',
        success_url: request.successUrl ||
          `${
            Deno.env.get('APP_URL')
          }/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: request.cancelUrl ||
          `${Deno.env.get('APP_URL')}/billing/cancel`,
        subscription_data: {
          metadata: {
            supabase_user_id: userId,
            created_by: 'enhanced-checkout-service',
            ...request.metadata,
          },
        },
        customer_update: {
          address: request.billingAddressCollection === 'required'
            ? 'required'
            : 'auto',
        },
        billing_address_collection: request.billingAddressCollection || 'auto',
        allow_promotion_codes: request.allowPromotionCodes !== undefined
          ? request.allowPromotionCodes
          : true,
        locale: request.locale as any,
        expires_at: Math.floor(Date.now() / 1000) + (30 * 60), // 30 minutes from now
        metadata: {
          supabase_user_id: userId,
          created_by: 'enhanced-checkout-service',
        },
      });

      // Log checkout session creation
      await this.logCheckoutEvent(userId, 'checkout_session_created', {
        sessionId: session.id,
        priceId: request.priceId,
        customerId,
        amount: null, // We'll get this from the webhook
      });

      return {
        success: true,
        sessionId: session.id,
        url: session.url || '',
        expiresAt: new Date(session.expires_at * 1000).toISOString(),
        customerId,
        message: 'Checkout session created successfully',
      };
    } catch (error) {
      console.error('Error creating checkout session:', error);

      // Log checkout error
      await this.logCheckoutEvent(userId, 'checkout_session_error', {
        error: error.message,
        priceId: request.priceId,
      });

      throw error;
    }
  }

  /**
   * Get or create Stripe customer
   */
  private async getOrCreateCustomer(
    userId: string,
    userEmail: string,
  ): Promise<string> {
    try {
      // Get user profile
      const { data: profile, error: profileError } = await this.supabase
        .from('profiles')
        .select('stripe_customer_id, name')
        .eq('id', userId)
        .single();

      if (profileError) {
        console.error('Error fetching profile:', profileError);
        throw new Error('Failed to fetch user profile');
      }

      // Return existing customer ID if available
      if (profile.stripe_customer_id) {
        return profile.stripe_customer_id;
      }

      // Create new Stripe customer
      const customer = await this.stripe.customers.create({
        email: userEmail,
        name: profile.name || undefined,
        metadata: {
          supabase_user_id: userId,
          created_by: 'enhanced-checkout-service',
        },
      });

      // Update profile with customer ID
      const { error: updateError } = await this.supabase
        .from('profiles')
        .update({
          stripe_customer_id: customer.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (updateError) {
        console.error('Error updating profile with customer ID:', updateError);
        // Don't throw - customer was created successfully
      }

      return customer.id;
    } catch (error) {
      console.error('Error getting or creating customer:', error);
      throw new Error('Failed to get or create customer');
    }
  }

  /**
   * Validate Stripe price
   */
  private async validatePrice(priceId: string): Promise<void> {
    try {
      const price = await this.stripe.prices.retrieve(priceId);

      if (!price.active) {
        throw new Error('Price is not active');
      }

      if (price.type !== 'recurring') {
        throw new Error('Price must be for recurring subscription');
      }
    } catch (error) {
      console.error('Error validating price:', error);
      throw new Error(`Invalid price ID: ${error.message}`);
    }
  }

  /**
   * Log checkout event for audit trail
   */
  private async logCheckoutEvent(
    userId: string,
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      const auditEntry = {
        user_id: userId,
        action,
        resource_type: 'checkout_session',
        resource_id: details.sessionId || 'unknown',
        details: JSON.stringify({
          ...details,
          timestamp: new Date().toISOString(),
        }),
        created_at: new Date().toISOString(),
      };

      await this.supabase
        .from('audit_logs')
        .insert(auditEntry);
    } catch (error) {
      console.error('Failed to log checkout event:', error);
      // Don't throw - audit logging failure shouldn't break the operation
    }
  }

  /**
   * Validate URL format
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate email format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}

// Security headers are now imported from @/shared-security

/**
 * Extract user from JWT token
 */
async function extractUserFromRequest(
  request: Request,
): Promise<{ userId: string; email: string } | null> {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring(7);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_ANON_KEY') || '',
    );

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return null;
    }

    return {
      userId: user.id,
      email: user.email || '',
    };
  } catch (error) {
    console.error('Error extracting user from request:', error);
    return null;
  }
}

/**
 * Rate limiting check
 */
async function checkRateLimit(userId: string): Promise<boolean> {
  // Simple in-memory rate limiting for demo
  // In production, this would use Redis or database
  const key = `checkout_${userId}`;
  const limit = 5; // 5 requests per minute
  const window = 60 * 1000; // 1 minute

  // This is a placeholder implementation
  // Real implementation would use Layer 1 rate limiting utilities
  return true;
}

/**
 * Main serve function
 */
serve(async (req) => {
  // Generate a request ID for tracking
  const requestId = crypto.randomUUID();

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return createCorsResponse();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return createCorsErrorResponse(
      'Only POST method is allowed',
      405,
      requestId,
      {
        code: 'METHOD_NOT_ALLOWED',
        allowedMethods: ['POST'],
      },
    );
  }

  try {
    // Extract authenticated user
    const userInfo = await extractUserFromRequest(req);
    if (!userInfo) {
      return createCorsErrorResponse(
        'Valid authentication token required',
        401,
        requestId,
        { code: 'AUTHENTICATION_REQUIRED' },
      );
    }

    // Check rate limit
    const rateLimitAllowed = await checkRateLimit(userInfo.userId);
    if (!rateLimitAllowed) {
      return createCorsErrorResponse(
        'Too many checkout requests. Please try again later.',
        429,
        requestId,
        {
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: 60,
        },
      );
    }

    // Parse request body
    const body = await req.json();

    // Create service and validate request
    const service = new EnhancedCheckoutService();
    const validation = service.validateRequest(body);

    if (!validation.isValid) {
      return createCorsErrorResponse(
        'Invalid request parameters',
        400,
        requestId,
        {
          code: 'VALIDATION_ERROR',
          details: validation.errors,
        },
      );
    }

    // Create checkout session
    const result = await service.createCheckoutSession(
      userInfo.userId,
      userInfo.email,
      validation.sanitized,
    );

    return createCorsSuccessResponse(
      {
        ...result,
        timestamp: new Date().toISOString(),
      },
      200,
      requestId,
    );
  } catch (error) {
    console.error('Enhanced checkout session error:', error);

    // Determine error type
    const isStripeError = error.type && error.type.startsWith('Stripe');
    const isValidationError = error.message.includes('Invalid') ||
      error.message.includes('must be');

    // If it's already an AppError, return it directly
    if (error instanceof AppError) {
      return error.toHttpResponse();
    }

    // For any other unknown errors
    const appError = handleUnknownError(error, requestId);
    return appError.toHttpResponse();
  }
});
