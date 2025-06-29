import { AuditLogger } from '@/audit-logging';
import { CacheManager, GlobalCaches } from '@/cache';
import { createCorsErrorResponse, createCorsResponse, createCorsSuccessResponse } from '@/cors';
import database, { QueryHelper } from '@/database';
import { Logger } from '@/logging';
import { createRateLimiter } from '@/rate-limiting';
import { AppError, createAppError, ErrorType, handleUnknownError } from '@/shared-errors';
import { serve } from 'std/http/server.ts';
import Stripe from 'stripe';

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
 * Subscription Service
 * Uses comprehensive Layer 1 & 2 utilities for robust subscription management
 */
class SubscriptionService {
  private stripe: Stripe;
  private logger: Logger;
  private database: QueryHelper;
  private auditLogger: AuditLogger;
  private cacheManager: CacheManager;

  constructor() {
    // Initialize services
    this.stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
      apiVersion: '2023-10-16',
    });

    this.logger = new Logger().child({
      module: 'subscription-service',
      service: 'billing',
    });

    this.database = database.createQueryHelper(database.getServiceClient());
    this.auditLogger = new AuditLogger();

    // Initialize cache with 5-minute TTL for subscription data
    this.cacheManager = GlobalCaches.createManager('subscriptions');
  }

  /**
   * Get user profile from database using shared database service
   */
  async getUserProfile(userId: string, requestId: string) {
    try {
      const { data: profile, error } = await this.database.select('profiles', {
        filters: { id: userId },
        limit: 1,
      });

      if (error) {
        this.logger.error('Failed to retrieve user profile', error, {
          requestId,
          userId,
        });
        throw createAppError(ErrorType.DATABASE_ERROR, 'Failed to get user profile');
      }

      if (!profile || profile.length === 0) {
        throw createAppError(ErrorType.NOT_FOUND_ERROR, 'User profile not found');
      }

      return profile[0];
    } catch (error: unknown) {
      const appError = handleUnknownError(error, requestId);
      this.logger.error('Error getting user profile', appError, {
        userId,
      });
      throw appError;
    }
  }

  /**
   * Get subscription data from Stripe
   */
  async getStripeSubscription(
    customerId: string,
    requestId: string
  ): Promise<SubscriptionData | null> {
    try {
      const subscriptions = await this.stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 1,
      });

      if (subscriptions.data.length === 0) {
        return null;
      }

      const subscription = subscriptions.data[0];
      const price = subscription.items.data[0]?.price;

      // Get product information for better display
      let productName = 'Unknown Plan';
      if (price?.product) {
        try {
          const product = await this.stripe.products.retrieve(price.product as string);
          productName = product.name;
        } catch (productError) {
          this.logger.warn('Failed to retrieve product information', {
            requestId,
            productId: price.product,
          });
        }
      }

      return {
        id: subscription.id,
        status: subscription.status,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        priceId: price?.id || '',
        customerId: subscription.customer as string,
        productName,
        amount: price?.unit_amount || 0,
        currency: price?.currency || 'usd',
        interval: price?.recurring?.interval || 'month',
        trialEnd: subscription.trial_end
          ? new Date(subscription.trial_end * 1000).toISOString()
          : null,
        canceledAt: subscription.canceled_at
          ? new Date(subscription.canceled_at * 1000).toISOString()
          : null,
      };
    } catch (error: unknown) {
      const appError = handleUnknownError(error, requestId);
      this.logger.error('Failed to retrieve Stripe subscription', appError, {
        customerId,
      });
      throw appError;
    }
  }

  /**
   * ✅ FIXED: Made cacheSubscription public method
   * Cache subscription data
   */
  async cacheSubscription(
    cacheKey: string,
    subscription: SubscriptionData,
    requestId: string
  ): Promise<void> {
    try {
      await this.cacheManager.set(cacheKey, subscription, 300); // 5 minutes TTL

      this.logger.info('Subscription data cached successfully', {
        requestId,
        cacheKey,
        subscriptionId: subscription.id,
      });
    } catch (error: unknown) {
      this.logger.warn('Failed to cache subscription data', {
        requestId,
        cacheKey,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - caching failure shouldn't break the request
    }
  }

  /**
   * Get cached subscription data
   */
  async getCachedSubscription(
    cacheKey: string,
    requestId: string
  ): Promise<SubscriptionData | null> {
    try {
      const cached = await this.cacheManager.get<SubscriptionData>(cacheKey);

      if (cached) {
        this.logger.info('Subscription data retrieved from cache', {
          requestId,
          cacheKey,
        });
      }

      return cached;
    } catch (error: unknown) {
      this.logger.warn('Failed to retrieve cached subscription', {
        requestId,
        cacheKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get subscription with caching
   */
  async getSubscription(
    userId: string,
    requestId: string
  ): Promise<{
    subscription: SubscriptionData | null;
    cached: boolean;
  }> {
    const cacheKey = `subscription:${userId}`;

    // Try cache first
    const cached = await this.getCachedSubscription(cacheKey, requestId);
    if (cached) {
      return { subscription: cached, cached: true };
    }

    // Get user profile to find customer ID
    const profile = await this.getUserProfile(userId, requestId);

    if (!profile.stripe_customer_id) {
      this.logger.info('User has no Stripe customer ID', {
        requestId,
        userId,
      });
      return { subscription: null, cached: false };
    }

    // Get subscription from Stripe
    const subscription = await this.getStripeSubscription(profile.stripe_customer_id, requestId);

    // Cache the result (even if null)
    if (subscription) {
      await this.cacheSubscription(cacheKey, subscription, requestId);
    }

    // Log audit event
    await this.auditLogger.log(
      'subscription_retrieved',
      userId,
      {
        customerId: profile.stripe_customer_id,
        subscriptionId: subscription?.id,
        status: subscription?.status,
      },
      requestId
    );

    return { subscription, cached: false };
  }
}

const rateLimiter = createRateLimiter({
  requestsPerMinute: 30,
  windowMs: 60 * 1000, // 1 minute window
  identifierExtractor: (request: Request) => {
    const auth = request.headers.get('authorization');
    return auth ? `subscription:${auth}` : `subscription:${request.headers.get('x-real-ip')}`;
  },
});

// Initialize service
const subscriptionService = new SubscriptionService();

// Main handler
serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  // Set up logging context
  const logger = new Logger().child({
    module: 'get-subscription',
    requestId,
  });

  try {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return createCorsResponse();
    }

    // Validate HTTP method
    if (req.method !== 'GET') {
      throw createAppError(ErrorType.VALIDATION_ERROR, 'Method not allowed');
    }

    // Apply rate limiting
    await rateLimiter(req);

    // Extract user ID from auth token
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      throw createAppError(ErrorType.AUTHENTICATION_ERROR, 'Invalid authorization header');
    }

    const token = authHeader.substring(7);

    // Decode JWT to get user ID (simplified - in production use proper JWT verification)
    const payload = JSON.parse(atob(token.split('.')[1]));
    const userId = payload.sub;

    if (!userId) {
      throw createAppError(ErrorType.AUTHENTICATION_ERROR, 'Invalid token');
    }

    logger.info('Processing subscription request', {
      userId,
      userAgent: req.headers.get('user-agent'),
    });

    // Get subscription data
    const result = await subscriptionService.getSubscription(userId, requestId);

    const duration = Date.now() - startTime;

    logger.info('Subscription request completed', {
      userId,
      hasSubscription: !!result.subscription,
      cached: result.cached,
      duration,
    });

    // Return response
    return createCorsSuccessResponse({
      subscription: result.subscription,
      cached: result.cached,
      timestamp: new Date().toISOString(),
      requestId,
    });
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    const appError = handleUnknownError(error, requestId);

    logger.error('Subscription request failed', appError, {
      duration,
      url: req.url,
      method: req.method,
    });

    // Handle different error types
    if (appError instanceof AppError) {
      return createCorsErrorResponse(
        appError.message,
        appError.status,
        requestId,
        appError.details
      );
    }

    // Handle unknown errors
    return createCorsErrorResponse('Internal server error', 500, requestId);
  }
});
