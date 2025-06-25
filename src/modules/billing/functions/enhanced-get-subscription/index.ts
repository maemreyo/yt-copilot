// UPDATED: 2025-06-24 - Enhanced subscription getter with caching and Layer 1 & 2 utilities

import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// Import Layer 1 utilities
import { createAppError, ErrorType } from '@/errors';
import { Logger } from '@/logging';
import { SecurityService } from '@/security';
import { ValidationService } from '@/validation';
import { AuthService } from '@/auth';
import { GlobalCaches, CacheManager } from '@/cache';
import { createRateLimiter } from '@/rate-limiting';

// Import Layer 2 utilities
import { DatabaseService } from '@/database';
import { AuditLogger } from '@/audit-logging';

/**
 * Subscription data interface
 */
interface SubscriptionData {
  id: string;
  status: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  priceId: string;
  customerId: string;
  productName?: string;
  amount?: number;
  currency?: string;
  interval?: string;
  trialEnd?: string | null;
  canceledAt?: string | null;
}

/**
 * Enhanced Subscription Service
 * Uses comprehensive Layer 1 & 2 utilities for robust subscription management
 */
class EnhancedSubscriptionService {
  private stripe: Stripe;
  private supabase: any;
  private logger: Logger;
  private security: SecurityService;
  private validator: ValidationService;
  private auth: AuthService;
  private database: DatabaseService;
  private auditLogger: AuditLogger;
  private cacheManager: CacheManager;
  private rateLimiter: any;

  constructor() {
    // Initialize services
    this.stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
      apiVersion: '2023-10-16',
    });
    
    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );
    
    this.logger = new Logger({
      service: 'subscription-service',
      level: 'info',
      enablePerformanceTracking: true
    });
    
    this.security = new SecurityService();
    this.validator = new ValidationService();
    this.auth = new AuthService();
    this.database = new DatabaseService();
    this.auditLogger = new AuditLogger();
    
    // Initialize cache with 5-minute TTL for subscription data
    this.cacheManager = GlobalCaches.createManager('subscriptions');
    
    // Rate limit: 20 requests per minute per user
    this.rateLimiter = createRateLimiter({
      windowMs: 60000,
      maxRequests: 20,
      identifier: 'user'
    });
  }

  /**
   * Process subscription retrieval request
   */
  async getSubscription(req: Request): Promise<Response> {
    const startTime = Date.now();
    const requestId = crypto.randomUUID();
    
    try {
      // Log incoming request
      this.logger.info('Subscription request received', {
        requestId,
        method: req.method,
        url: req.url,
        userAgent: req.headers.get('User-Agent'),
        ip: req.headers.get('X-Forwarded-For') || req.headers.get('X-Real-IP')
      });

      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        return this.createCorsResponse();
      }

      // Validate HTTP method
      if (req.method !== 'GET') {
        throw createAppError(
          ErrorType.VALIDATION_ERROR,
          'Method not allowed',
          { method: req.method }
        );
      }

      // Apply rate limiting
      await this.rateLimiter(req);

      // Authenticate user
      const { user, authType } = await this.auth.authenticateRequest(req);
      if (!user) {
        throw createAppError(
          ErrorType.AUTHENTICATION_ERROR,
          'Authentication required'
        );
      }

      // Get user profile
      const profile = await this.getUserProfile(user.id, requestId);
      
      // Check if user has subscription
      if (!profile.stripe_subscription_id) {
        return this.createResponse({
          subscription: null,
          message: 'No active subscription found'
        }, 200, requestId);
      }

      // Try to get from cache first
      const cacheKey = `subscription:${profile.stripe_subscription_id}`;
      const cachedSubscription = await this.getCachedSubscription(cacheKey, requestId);
      
      if (cachedSubscription) {
        // Log cache hit
        const processingTime = Date.now() - startTime;
        this.logger.info('Subscription retrieved from cache', {
          requestId,
          userId: user.id,
          subscriptionId: profile.stripe_subscription_id,
          processingTime,
          source: 'cache'
        });

        return this.createResponse({
          subscription: cachedSubscription,
          cached: true,
          cacheKey
        }, 200, requestId);
      }

      // Get fresh data from Stripe
      const subscription = await this.getStripeSubscription(
        profile.stripe_subscription_id,
        requestId
      );

      // Cache the subscription data
      await this.cacheSubscription(cacheKey, subscription, requestId);

      // Log successful retrieval
      const processingTime = Date.now() - startTime;
      this.logger.info('Subscription retrieved successfully', {
        requestId,
        userId: user.id,
        subscriptionId: subscription.id,
        status: subscription.status,
        processingTime,
        source: 'stripe',
        authType
      });

      // Audit log subscription access
      await this.auditLogger.log({
        userId: user.id,
        action: 'subscription_viewed',
        resource: 'stripe_subscription',
        resourceId: subscription.id,
        details: {
          subscriptionStatus: subscription.status,
          processingTime,
          authType
        },
        metadata: {
          requestId,
          cached: false,
          source: 'stripe'
        }
      });

      return this.createResponse({
        subscription,
        cached: false
      }, 200, requestId);

    } catch (error) {
      // Log error with comprehensive details
      const processingTime = Date.now() - startTime;
      this.logger.error('Subscription retrieval failed', {
        requestId,
        error: error.message,
        stack: error.stack,
        processingTime,
        errorType: error.type || 'unknown'
      });

      // Audit log failed access
      await this.auditLogger.log({
        userId: null,
        action: 'subscription_access_failed',
        resource: 'stripe_subscription',
        resourceId: null,
        details: {
          error: error.message,
          processingTime
        },
        metadata: {
          requestId,
          success: false,
          errorType: error.type || 'unknown'
        }
      });

      return this.createErrorResponse(error, requestId);
    }
  }

  /**
   * Get user profile from database
   */
  private async getUserProfile(userId: string, requestId: string) {
    try {
      const { data: profile, error } = await this.supabase
        .from('profiles')
        .select('stripe_customer_id, stripe_subscription_id, stripe_subscription_status')
        .eq('id', userId)
        .single();

      if (error) {
        throw createAppError(
          ErrorType.DATABASE_ERROR,
          'Failed to fetch user profile',
          { error: error.message, userId }
        );
      }

      if (!profile) {
        throw createAppError(
          ErrorType.NOT_FOUND_ERROR,
          'User profile not found',
          { userId }
        );
      }

      return profile;
    } catch (error) {
      this.logger.error('Failed to get user profile', {
        requestId,
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get cached subscription data
   */
  private async getCachedSubscription(cacheKey: string, requestId: string): Promise<SubscriptionData | null> {
    try {
      const cached = await this.cacheManager.get<SubscriptionData>(cacheKey);
      
      if (cached) {
        this.logger.debug('Cache hit for subscription', { requestId, cacheKey });
        return cached;
      }
      
      this.logger.debug('Cache miss for subscription', { requestId, cacheKey });
      return null;
    } catch (error) {
      this.logger.warn('Cache retrieval failed', {
        requestId,
        cacheKey,
        error: error.message
      });
      return null; // Continue without cache
    }
  }

  /**
   * Get subscription from Stripe
   */
  private async getStripeSubscription(subscriptionId: string, requestId: string): Promise<SubscriptionData> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['default_payment_method', 'items.data.price.product']
      });

      // Extract product information
      const priceItem = subscription.items.data[0];
      const product = priceItem?.price?.product;
      
      const subscriptionData: SubscriptionData = {
        id: subscription.id,
        status: subscription.status,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        priceId: priceItem?.price?.id || '',
        customerId: subscription.customer as string,
        productName: typeof product === 'object' ? product.name : undefined,
        amount: priceItem?.price?.unit_amount || undefined,
        currency: priceItem?.price?.currency,
        interval: priceItem?.price?.recurring?.interval,
        trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
        canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null
      };

      this.logger.debug('Stripe subscription retrieved', {
        requestId,
        subscriptionId,
        status: subscription.status
      });

      return subscriptionData;
    } catch (error) {
      this.logger.error('Failed to retrieve Stripe subscription', {
        requestId,
        subscriptionId,
        error: error.message
      });

      if (error.type === 'StripeInvalidRequestError') {
        throw createAppError(
          ErrorType.NOT_FOUND_ERROR,
          'Subscription not found',
          { subscriptionId }
        );
      }

      throw createAppError(
        ErrorType.EXTERNAL_SERVICE_ERROR,
        'Failed to retrieve subscription from Stripe',
        { subscriptionId, originalError: error.message }
      );
    }
  }

  /**
   * Cache subscription data
   */
  private async cacheSubscription(cacheKey: string, subscription: SubscriptionData, requestId: string): Promise<void> {
    try {
      // Cache for 5 minutes (subscription data changes infrequently)
      const cacheTtl = 5 * 60 * 1000; // 5 minutes
      
      await this.cacheManager.set(cacheKey, subscription, cacheTtl);
      
      this.logger.debug('Subscription cached', {
        requestId,
        cacheKey,
        ttl: cacheTtl,
        subscriptionId: subscription.id
      });
    } catch (error) {
      this.logger.warn('Failed to cache subscription', {
        requestId,
        cacheKey,
        error: error.message
      });
      // Don't throw - caching failure shouldn't break the request
    }
  }

  /**
   * Create CORS response
   */
  private createCorsResponse(): Response {
    return new Response(null, {
      status: 200,
      headers: this.security.getCorsHeaders()
    });
  }

  /**
   * Create success response
   */
  private createResponse(data: any, status: number, requestId: string): Response {
    return new Response(
      JSON.stringify({
        ...data,
        timestamp: new Date().toISOString()
      }),
      {
        status,
        headers: {
          ...this.security.getCorsHeaders(),
          ...this.security.getSecurityHeaders(),
          'Content-Type': 'application/json',
          'X-Request-ID': requestId
        }
      }
    );
  }

  /**
   * Create error response
   */
  private createErrorResponse(error: any, requestId: string): Response {
    const isAppError = error.type && error.code;
    
    const response = {
      error: {
        code: isAppError ? error.code : 'SUBSCRIPTION_ERROR',
        message: isAppError ? error.message : 'Failed to retrieve subscription',
        details: isAppError ? error.details : { originalError: error.message }
      },
      timestamp: new Date().toISOString(),
      requestId
    };

    const status = isAppError ? this.getStatusFromErrorType(error.type) : 500;

    return new Response(
      JSON.stringify(response),
      {
        status,
        headers: {
          ...this.security.getCorsHeaders(),
          ...this.security.getSecurityHeaders(),
          'Content-Type': 'application/json',
          'X-Request-ID': requestId
        }
      }
    );
  }

  /**
   * Get HTTP status from error type
   */
  private getStatusFromErrorType(errorType: string): number {
    switch (errorType) {
      case ErrorType.VALIDATION_ERROR:
        return 400;
      case ErrorType.AUTHENTICATION_ERROR:
        return 401;
      case ErrorType.AUTHORIZATION_ERROR:
        return 403;
      case ErrorType.NOT_FOUND_ERROR:
        return 404;
      case ErrorType.RATE_LIMIT_ERROR:
        return 429;
      case ErrorType.EXTERNAL_SERVICE_ERROR:
        return 502;
      case ErrorType.DATABASE_ERROR:
        return 503;
      default:
        return 500;
    }
  }
}

// Initialize service and serve
const subscriptionService = new EnhancedSubscriptionService();

serve(async (req: Request) => {
  return await subscriptionService.getSubscription(req);
});