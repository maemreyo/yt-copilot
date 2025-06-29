import { createCorsErrorResponse, createCorsResponse, createCorsSuccessResponse } from '@/cors';
import { AppError, createAppError, ErrorType, handleUnknownError } from '@/shared-errors';
import { createClient } from '@supabase/supabase-js';
import { serve } from 'std/http/server.ts';
import Stripe from 'stripe';
import { getEnv, isDevelopment } from '../../../../shared/utils/env-utils';

/**
 * Request interface for creating a customer portal session.
 */
interface CreateCustomerPortalRequest {
  returnUrl?: string;
  configuration?: string;
  locale?: string;
}

/**
 * Response interface for a created customer portal session.
 */
interface CreateCustomerPortalResponse {
  url: string;
  sessionId: string;
  customerId: string;
  expiresAt: string;
}

/**
 * Validates the incoming request data for creating a customer portal session.
 */
class CustomerPortalValidator {
  static validateRequest(data: CreateCustomerPortalRequest): {
    isValid: boolean;
    errors: string[];
    sanitized: CreateCustomerPortalRequest;
  } {
    const errors: string[] = [];
    const sanitized: CreateCustomerPortalRequest = {};

    if (data.returnUrl) {
      if (typeof data.returnUrl !== 'string') {
        errors.push('returnUrl must be a string');
      } else {
        try {
          const url = new URL(data.returnUrl);
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

    if (data.configuration) {
      if (typeof data.configuration !== 'string') {
        errors.push('configuration must be a string');
      } else if (!/^bpc_[a-zA-Z0-9]+$/.test(data.configuration)) {
        errors.push('configuration must be a valid Stripe portal configuration ID');
      } else {
        sanitized.configuration = data.configuration;
      }
    }

    if (data.locale) {
      const validLocales = [
        'auto',
        'bg',
        'cs',
        'da',
        'de',
        'el',
        'en',
        'en-GB',
        'es',
        'es-419',
        'et',
        'fi',
        'fil',
        'fr',
        'fr-CA',
        'hr',
        'hu',
        'id',
        'it',
        'ja',
        'ko',
        'lt',
        'lv',
        'ms',
        'mt',
        'nb',
        'nl',
        'pl',
        'pt',
        'pt-BR',
        'ro',
        'ru',
        'sk',
        'sl',
        'sv',
        'th',
        'tr',
        'vi',
        'zh',
        'zh-HK',
        'zh-TW',
      ];
      if (typeof data.locale !== 'string' || !validLocales.includes(data.locale)) {
        errors.push(`locale must be one of: ${validLocales.join(', ')}`);
      } else {
        sanitized.locale = data.locale;
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitized,
    };
  }

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
 * Manages rate limiting for customer portal creation.
 */
class CustomerPortalRateLimiter {
  private static userRequests = new Map<string, { count: number; resetTime: number }>();

  static canCreatePortalSession(userId: string): {
    allowed: boolean;
    resetTime?: number;
    remaining?: number;
  } {
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute
    const maxRequests = 5;

    const userLimit = this.userRequests.get(userId);
    if (!userLimit || now > userLimit.resetTime) {
      this.userRequests.set(userId, { count: 1, resetTime: now + windowMs });
      return { allowed: true, remaining: maxRequests - 1 };
    }

    if (userLimit.count >= maxRequests) {
      return { allowed: false, resetTime: userLimit.resetTime, remaining: 0 };
    }

    userLimit.count++;
    return { allowed: true, remaining: maxRequests - userLimit.count };
  }
}

/**
 * Manages the business logic for the customer portal.
 */
class CustomerPortalService {
  private stripe: Stripe;
  private supabase: any;

  constructor() {
    this.stripe = new Stripe(getEnv('STRIPE_SECRET_KEY'), {
      apiVersion: '2023-10-16',
    });
    this.supabase = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
  }

  async ensureStripeCustomer(userId: string, userEmail: string): Promise<string> {
    const { data: profile, error } = await this.supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (error) {
      throw new Error(`Failed to fetch user profile: ${error.message}`);
    }

    if (profile && profile.stripe_customer_id) {
      try {
        await this.stripe.customers.retrieve(profile.stripe_customer_id);
        return profile.stripe_customer_id;
      } catch (error: any) {
        console.warn('Stripe customer not found, creating new one:', error);
      }
    }

    const customer = await this.stripe.customers.create({
      email: userEmail,
      metadata: { supabase_id: userId },
    });

    const { error: updateError } = await this.supabase
      .from('profiles')
      .update({ stripe_customer_id: customer.id })
      .eq('id', userId);

    if (updateError) {
      console.error('Failed to update profile with Stripe customer ID:', updateError);
    }

    return customer.id;
  }

  async createPortalSession(
    customerId: string,
    request: CreateCustomerPortalRequest
  ): Promise<{ sessionId: string; url: string; expiresAt: string }> {
    const appUrl = getEnv('APP_URL', 'http://localhost:3000');
    const defaultReturnUrl = `${appUrl}/billing`;

    const sessionParams: Stripe.BillingPortal.SessionCreateParams = {
      customer: customerId,
      return_url: request.returnUrl || defaultReturnUrl,
    };

    if (request.configuration) {
      sessionParams.configuration = request.configuration;
    }
    if (request.locale) sessionParams.locale = request.locale as any;

    try {
      const session = await this.stripe.billingPortal.sessions.create(sessionParams);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      return { sessionId: session.id, url: session.url, expiresAt };
    } catch (error: any) {
      throw new Error(`Stripe error: ${error.message}`);
    }
  }

  getAllowedDomains(): string[] {
    const appUrl = getEnv('APP_URL', 'http://localhost:3000');
    const allowedDomains = [new URL(appUrl).hostname];
    const additionalDomains = getEnv('ALLOWED_RETURN_DOMAINS');
    if (additionalDomains) {
      allowedDomains.push(...additionalDomains.split(',').map((d: any) => d.trim()));
    }
    return allowedDomains;
  }
}

/**
 * Main request handler.
 */
serve(async req => {
  const requestId = crypto.randomUUID();

  if (req.method === 'OPTIONS') {
    return createCorsResponse();
  }

  if (req.method !== 'POST') {
    return createCorsErrorResponse('Only POST method is allowed', 405, requestId, {
      code: 'METHOD_NOT_ALLOWED',
      allowedMethods: ['POST'],
    });
  }

  try {
    const portalService = new CustomerPortalService();
    const supabase = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_ANON_KEY'));

    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw createAppError(
        ErrorType.AUTHENTICATION_ERROR,
        'Missing or invalid authorization header',
        { code: 'AUTHENTICATION_ERROR' },
        requestId
      );
    }

    const token = authHeader.substring(7);
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      throw createAppError(
        ErrorType.AUTHENTICATION_ERROR,
        'Invalid or expired token',
        { code: 'INVALID_TOKEN' },
        requestId
      );
    }

    const rateLimitResult = CustomerPortalRateLimiter.canCreatePortalSession(user.id);
    if (!rateLimitResult.allowed) {
      const retryAfter = Math.ceil((rateLimitResult.resetTime! - Date.now()) / 1000);
      throw createAppError(
        ErrorType.RATE_LIMIT_ERROR,
        'Too many customer portal requests',
        { code: 'RATE_LIMIT_EXCEEDED', retryAfter },
        requestId
      );
    }

    let requestData: CreateCustomerPortalRequest = {};
    try {
      const body = await req.text();
      if (body.trim()) requestData = JSON.parse(body);
    } catch (error: any) {
      throw createAppError(
        ErrorType.VALIDATION_ERROR,
        'Invalid JSON in request body',
        { code: 'INVALID_REQUEST_BODY' },
        requestId
      );
    }

    const validation = CustomerPortalValidator.validateRequest(requestData);
    if (!validation.isValid) {
      throw createAppError(
        ErrorType.VALIDATION_ERROR,
        'Request validation failed',
        { code: 'VALIDATION_ERROR', details: validation.errors },
        requestId
      );
    }

    if (validation.sanitized.returnUrl) {
      const allowedDomains = portalService.getAllowedDomains();
      if (
        !CustomerPortalValidator.validateReturnUrlDomain(
          validation.sanitized.returnUrl,
          allowedDomains
        )
      ) {
        throw createAppError(
          ErrorType.VALIDATION_ERROR,
          'Return URL domain not allowed',
          { code: 'VALIDATION_ERROR', details: { allowedDomains } },
          requestId
        );
      }
    }

    const customerId = await portalService.ensureStripeCustomer(user.id, user.email!);
    const portalSession = await portalService.createPortalSession(customerId, validation.sanitized);

    const response: CreateCustomerPortalResponse = {
      url: portalSession.url,
      sessionId: portalSession.sessionId,
      customerId,
      expiresAt: portalSession.expiresAt,
    };

    return createCorsSuccessResponse(response, 200, requestId, {
      'X-RateLimit-Remaining': rateLimitResult.remaining?.toString() || '0',
    });
  } catch (error: any) {
    console.error('Customer portal creation error:', error);

    if (error instanceof AppError) {
      return error.toHttpResponse();
    }

    if (error.message?.includes('Stripe error:')) {
      const appError = createAppError(
        ErrorType.EXTERNAL_SERVICE_ERROR,
        'Payment service error',
        {
          code: 'EXTERNAL_SERVICE_ERROR',
          details: isDevelopment() ? error.message : undefined,
        },
        requestId
      );
      return appError.toHttpResponse();
    }

    const appError = handleUnknownError(error, requestId);
    return appError.toHttpResponse();
  }
});
