// UPDATED: 2025-06-24 - Enhanced subscription getter with caching and Layer 1 & 2 utilities

import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// Import Layer 1 utilities
import {
  AppError,
  createAppError,
  ErrorType,
  handleUnknownError,
} from '@/shared-errors';
import {
  createCorsErrorResponse,
  createCorsResponse,
  createCorsSuccessResponse,
} from '@/cors';
import { Logger, LogLevel } from '@/logging';
import { CacheManager, GlobalCaches } from '@/cache';
import { createRateLimiter } from '@/rate-limiting';

// Import Layer 2 utilities
import { DatabaseService } from './database-service';
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
  private database: DatabaseService;
  private auditLogger: AuditLogger;
  private cacheManager: CacheManager;

  constructor() {
    // Initialize services
    this.stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
      apiVersion: '2023-10-16',
    });

    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );

    this.logger = new Logger({
      service: 'subscription-service',
      level: LogLevel.INFO,
      enablePerformanceTracking: true,
    });

    this.database = new DatabaseService();
    this.auditLogger = new AuditLogger();

    // Initialize cache with 5-minute TTL for subscription data
    this.cacheManager = GlobalCaches.createManager('subscriptions');
  }

  /**
   * Get user profile from database
   */
  async getUserProfile(userId: string, requestId: string) {
    try {
      const { data: profile, error } = await this.supabase
        .from('profiles')
        .select(
          'stripe_customer_id, stripe_subscription_id, stripe_subscription_status',
        )
        .eq('id', userId)
        .single();

      if (error) {
        throw createAppError(
          ErrorType.DATABASE_ERROR,
          'Failed to fetch user profile',
          { error: error.message, userId },
        );
      }

      if (!profile) {
        throw createAppError(
          ErrorType.NOT_FOUND_ERROR,
          'User profile not found',
          { userId },
        );
      }

      return profile;
    } catch (error: any) {
      this.logger.error('Failed to get user profile', {
        requestId,
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get cached subscription data
   */
  async getCachedSubscription(
    cacheKey: string,
    requestId: string,
  ): Promise<SubscriptionData | null> {
    try {
      const cached = await this.cacheManager.get<SubscriptionData>(cacheKey);

      if (cached) {
        this.logger.debug('Cache hit for subscription', {
          requestId,
          cacheKey,
        });
        return cached;
      }

      this.logger.debug('Cache miss for subscription', { requestId, cacheKey });
      return null;
    } catch (error: any) {
      this.logger.warn('Cache retrieval failed', {
        requestId,
        cacheKey,
        error: error.message,
      });
      return null; // Continue without cache
    }
  }

  /**
   * Get subscription from Stripe
   */
  async getStripeSubscription(
    subscriptionId: string,
    requestId: string,
  ): Promise<SubscriptionData> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(
        subscriptionId,
        {
          expand: ['default_payment_method', 'items.data.price.product'],
        },
      );

      // Extract product information
      const priceItem = subscription.items.data[0];
      const product = priceItem?.price?.product;

      const subscriptionData: SubscriptionData = {
        id: subscription.id,
        status: subscription.status,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000)
          .toISOString(),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        priceId: priceItem?.price?.id || '',
        customerId: subscription.customer as string,
        productName: typeof product === 'object' ? product.name : undefined,
        amount: priceItem?.price?.unit_amount || undefined,
        currency: priceItem?.price?.currency,
        interval: priceItem?.price?.recurring?.interval,
        trialEnd: subscription.trial_end
          ? new Date(subscription.trial_end * 1000).toISOString()
          : null,
        canceledAt: subscription.canceled_at
          ? new Date(subscription.canceled_at * 1000).toISOString()
          : null,
      };

      this.logger.debug('Stripe subscription retrieved', {
        requestId,
        subscriptionId,
        status: subscription.status,
      });

      return subscriptionData;
    } catch (error: any) {
      this.logger.error('Failed to retrieve Stripe subscription', {
        requestId,
        subscriptionId,
        error: error.message,
      });

      if (error.type === 'StripeInvalidRequestError') {
        throw createAppError(
          ErrorType.NOT_FOUND_ERROR,
          'Subscription not found',
          { subscriptionId },
        );
      }

      throw createAppError(
        ErrorType.EXTERNAL_SERVICE_ERROR,
        'Failed to retrieve subscription from Stripe',
        { subscriptionId, originalError: error.message },
      );
    }
  }

  /**
   * Cache subscription data
   */
  private async cacheSubscription(
    cacheKey: string,
    subscription: SubscriptionData,
    requestId: string,
  ): Promise<void> {
    try {
      // Cache for 5 minutes (subscription data changes infrequently)
      const cacheTtl = 5 * 60 * 1000; // 5 minutes

      await this.cacheManager.set(cacheKey, subscription, cacheTtl);

      this.logger.debug('Subscription cached', {
        requestId,
        cacheKey,
        ttl: cacheTtl,
        subscriptionId: subscription.id,
      });
    } catch (error: any) {
      this.logger.warn('Failed to cache subscription', {
        requestId,
        cacheKey,
        error: error.message,
      });
      // Don't throw - caching failure shouldn't break the request
    }
  }
}

// Initialize service and serve
const subscriptionService = new EnhancedSubscriptionService();
const rateLimiter = createRateLimiter({
  windowMs: 60000,
  maxRequests: 20,
  identifier: 'user',
});

serve(async (req: Request) => {
  const requestId = crypto.randomUUID();

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return createCorsResponse();
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return createCorsErrorResponse(
      'Only GET method is allowed',
      405,
      requestId,
      {
        code: 'METHOD_NOT_ALLOWED',
        allowedMethods: ['GET'],
      },
    );
  }

  try {
    // Verify authentication
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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_ANON_KEY') || '',
    );

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

    // Apply rate limiting
    await rateLimiter(req);

    const profile = await subscriptionService.getUserProfile(
      user.id,
      requestId,
    );

    // Check if user has subscription
    if (!profile.stripe_subscription_id) {
      return createCorsSuccessResponse(
        {
          subscription: null,
          message: 'No active subscription found',
        },
        200,
        requestId,
      );
    }

    // Try to get from cache first
    const cacheKey = `subscription:${profile.stripe_subscription_id}`;
    const cachedSubscription = await subscriptionService.getCachedSubscription(
      cacheKey,
      requestId,
    );

    if (cachedSubscription) {
      return createCorsSuccessResponse(
        {
          subscription: cachedSubscription,
          cached: true,
          cacheKey,
        },
        200,
        requestId,
      );
    }

    // Get fresh data from Stripe
    const subscription = await subscriptionService.getStripeSubscription(
      profile.stripe_subscription_id,
      requestId,
    );

    // Cache the subscription data
    await subscriptionService.cacheSubscription(
      cacheKey,
      subscription,
      requestId,
    );

    return createCorsSuccessResponse(
      {
        subscription,
        cached: false,
      },
      200,
      requestId,
    );
  } catch (error: any) {
    console.error('Subscription retrieval failed:', error);

    if (error instanceof AppError) {
      return error.toHttpResponse();
    }

    const appError = handleUnknownError(error, requestId);
    return appError.toHttpResponse();
  }
});
