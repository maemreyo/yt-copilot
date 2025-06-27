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
 * Request interface for creating a checkout session.
 */
interface CreateCheckoutSessionRequest {
  priceId: string;
  successUrl?: string;
  cancelUrl?: string;
}

/**
 * Response interface for a created checkout session.
 */
interface CheckoutSessionResponse {
  sessionId: string;
  url: string;
  customerId: string;
  expiresAt: string;
}

/**
 * Validates the incoming request data for creating a checkout session.
 */
class RequestValidator {
  static validate(data: any): {
    isValid: boolean;
    errors: string[];
    sanitized: CreateCheckoutSessionRequest;
  } {
    const errors: string[] = [];
    const sanitized: Partial<CreateCheckoutSessionRequest> = {};

    if (!data) {
      errors.push('Request body is required');
      return {
        isValid: false,
        errors,
        sanitized: sanitized as CreateCheckoutSessionRequest,
      };
    }

    // Validate priceId
    if (!data.priceId) {
      errors.push('priceId is required');
    } else if (typeof data.priceId !== 'string') {
      errors.push('priceId must be a string');
    } else {
      sanitized.priceId = data.priceId;
    }

    // Validate successUrl
    if (data.successUrl) {
      if (typeof data.successUrl !== 'string') {
        errors.push('successUrl must be a string');
      } else {
        try {
          new URL(data.successUrl);
          sanitized.successUrl = data.successUrl;
        } catch {
          errors.push('successUrl must be a valid URL');
        }
      }
    }

    // Validate cancelUrl
    if (data.cancelUrl) {
      if (typeof data.cancelUrl !== 'string') {
        errors.push('cancelUrl must be a string');
      } else {
        try {
          new URL(data.cancelUrl);
          sanitized.cancelUrl = data.cancelUrl;
        } catch {
          errors.push('cancelUrl must be a valid URL');
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitized: sanitized as CreateCheckoutSessionRequest,
    };
  }
}

/**
 * Manages the business logic for checkout sessions.
 */
class CheckoutService {
  private stripe: Stripe;
  private supabase: any;

  constructor() {
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set');
    }
    this.stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase environment variables are not set');
    }
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Retrieves the Stripe customer ID for a user, creating one if it doesn't exist.
   */
  async getOrCreateStripeCustomer(
    userId: string,
    email: string,
  ): Promise<string> {
    const { data: profile, error: profileError } = await this.supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (profileError) {
      throw new Error(`Failed to fetch user profile: ${profileError.message}`);
    }

    if (profile.stripe_customer_id) {
      return profile.stripe_customer_id;
    }

    const customer = await this.stripe.customers.create({
      email,
      metadata: { supabase_id: userId },
    });

    const { error: updateError } = await this.supabase
      .from('profiles')
      .update({ stripe_customer_id: customer.id })
      .eq('id', userId);

    if (updateError) {
      // Log the error but don't block the process since the customer was created.
      console.error(
        'Failed to update profile with Stripe customer ID:',
        updateError,
      );
    }

    return customer.id;
  }

  /**
   * Creates a Stripe checkout session.
   */
  async createCheckoutSession(
    customerId: string,
    userId: string,
    requestData: CreateCheckoutSessionRequest,
  ): Promise<CheckoutSessionResponse> {
    const { priceId, successUrl, cancelUrl } = requestData;
    const defaultAppUrl = Deno.env.get('APP_URL') || 'http://localhost:3000';

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: successUrl ||
        `${defaultAppUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${defaultAppUrl}/billing/cancel`,
      subscription_data: {
        metadata: { supabase_id: userId },
      },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      customer_update: {
        address: 'auto',
        name: 'auto',
      },
    });

    if (!session.url) {
      throw new Error('Stripe checkout session URL not found.');
    }

    return {
      sessionId: session.id,
      url: session.url,
      customerId,
      expiresAt: new Date(session.expires_at * 1000).toISOString(),
    };
  }
}

/**
 * Main request handler.
 */
serve(async (req: Request) => {
  const requestId = crypto.randomUUID();

  if (req.method === 'OPTIONS') {
    return createCorsResponse();
  }

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
    const service = new CheckoutService();
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw createAppError(
        ErrorType.AUTHENTICATION_ERROR,
        'Missing or invalid authorization header',
        { code: 'AUTHENTICATION_ERROR' },
        requestId,
      );
    }

    const token = authHeader.substring(7);
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      token,
    );

    if (userError || !user) {
      throw createAppError(
        ErrorType.AUTHENTICATION_ERROR,
        'Invalid or expired token',
        { code: 'INVALID_TOKEN' },
        requestId,
      );
    }

    let requestData;
    try {
      requestData = await req.json();
    } catch (error) {
      throw createAppError(
        ErrorType.VALIDATION_ERROR,
        'Invalid JSON in request body',
        { code: 'INVALID_REQUEST_BODY' },
        requestId,
      );
    }

    const validation = RequestValidator.validate(requestData);
    if (!validation.isValid) {
      throw createAppError(
        ErrorType.VALIDATION_ERROR,
        'Request validation failed',
        {
          code: 'VALIDATION_ERROR',
          details: validation.errors,
        },
        requestId,
      );
    }

    const customerId = await service.getOrCreateStripeCustomer(
      user.id,
      user.email!,
    );
    const sessionResponse = await service.createCheckoutSession(
      customerId,
      user.id,
      validation.sanitized,
    );

    return createCorsSuccessResponse(sessionResponse, 200, requestId);
  } catch (error) {
    console.error('Error in create-checkout-session:', error);

    if (error instanceof AppError) {
      return error.toHttpResponse();
    }

    if (error.type === 'StripeCardError') {
      const appError = createAppError(
        ErrorType.PAYMENT_ERROR,
        'Payment failed - invalid card',
        {
          code: 'PAYMENT_ERROR',
          stripeCode: error.code,
          decline_code: error.decline_code,
        },
        requestId,
      );
      return appError.toHttpResponse();
    }

    if (error.type === 'StripeInvalidRequestError') {
      const appError = createAppError(
        ErrorType.EXTERNAL_SERVICE_ERROR,
        'Invalid request to payment processor',
        {
          code: 'STRIPE_ERROR',
          stripeCode: error.code,
          param: error.param,
        },
        requestId,
      );
      return appError.toHttpResponse();
    }

    const appError = handleUnknownError(error, requestId);
    return appError.toHttpResponse();
  }
});
