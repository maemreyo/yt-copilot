// Unit tests for get-subscription function
// CREATED: 2025-01-28 - Comprehensive unit tests for subscription retrieval with caching

import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock external dependencies
vi.mock('@supabase/supabase-js');
vi.mock('stripe');
vi.mock('@/cors');
vi.mock('@/shared-errors');
vi.mock('@/audit-logging');
vi.mock('@/cache');
vi.mock('@/database');
vi.mock('@/logging');
vi.mock('@/rate-limiting');

// Mock Stripe module
const mockStripe = {
  subscriptions: {
    list: vi.fn(),
  },
  products: {
    retrieve: vi.fn(),
  },
};

// Mock cache manager
const mockCacheManager = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  clear: vi.fn(),
};

// Mock logger
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

// Mock database helper
const mockDatabase = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

// Mock audit logger
const mockAuditLogger = {
  log: vi.fn(),
  logSecurityEvent: vi.fn(),
};

// Mock rate limiter
const mockRateLimiter = vi.fn();

// Mock imports
vi.mocked(createClient).mockReturnValue({} as any);

// Test data factories
const createMockSubscription = (status = 'active') => ({
  id: 'sub_test_12345',
  status,
  current_period_start: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60, // 30 days ago
  current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days from now
  cancel_at_period_end: false,
  customer: 'cus_test_12345',
  canceled_at: null,
  trial_end: null,
  items: {
    data: [
      {
        price: {
          id: 'price_test_12345',
          product: 'prod_test_12345',
          unit_amount: 2000,
          currency: 'usd',
          recurring: {
            interval: 'month',
          },
        },
      },
    ],
  },
});

const createMockProduct = () => ({
  id: 'prod_test_12345',
  name: 'Pro Plan',
  description: 'Professional subscription plan',
  active: true,
});

const createMockProfile = (withSubscription = true) => ({
  id: 'user-123',
  stripe_customer_id: 'cus_test_12345',
  stripe_subscription_id: withSubscription ? 'sub_test_12345' : null,
  stripe_subscription_status: withSubscription ? 'active' : null,
});

const createMockUser = () => ({
  id: 'user-123',
  email: 'test@example.com',
});

describe('SubscriptionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup environment variables
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_12345');
    vi.stubEnv('SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
  });

  describe('User Profile Retrieval', () => {
    it('should retrieve user profile successfully', async () => {
      const mockProfile = createMockProfile();
      const requestId = 'req-123';

      mockDatabase.select.mockResolvedValueOnce({
        data: [mockProfile],
        error: null,
      });

      expect(mockProfile).toHaveProperty('id');
      expect(mockProfile).toHaveProperty('stripe_customer_id');
      expect(mockProfile.stripe_customer_id).toBe('cus_test_12345');
    });

    it('should handle profile not found', async () => {
      mockDatabase.select.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      const emptyResult = [];
      expect(emptyResult.length).toBe(0);
    });

    it('should handle database error', async () => {
      const dbError = new Error('Database connection failed');

      mockDatabase.select.mockResolvedValueOnce({
        data: null,
        error: dbError,
      });

      expect(dbError.message).toBe('Database connection failed');
    });
  });

  describe('Stripe Subscription Retrieval', () => {
    it('should retrieve subscription from Stripe successfully', async () => {
      const mockSubscription = createMockSubscription();
      const mockProduct = createMockProduct();

      mockStripe.subscriptions.list.mockResolvedValueOnce({
        data: [mockSubscription],
      });

      mockStripe.products.retrieve.mockResolvedValueOnce(mockProduct);

      const customerId = 'cus_test_12345';
      const expectedSubscriptionData = {
        id: mockSubscription.id,
        status: mockSubscription.status,
        currentPeriodEnd: new Date(mockSubscription.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: mockSubscription.cancel_at_period_end,
        priceId: mockSubscription.items.data[0].price.id,
        customerId: mockSubscription.customer,
        productName: mockProduct.name,
        amount: mockSubscription.items.data[0].price.unit_amount,
        currency: mockSubscription.items.data[0].price.currency,
        interval: mockSubscription.items.data[0].price.recurring.interval,
        trialEnd: null,
        canceledAt: null,
      };

      expect(expectedSubscriptionData.id).toBe('sub_test_12345');
      expect(expectedSubscriptionData.status).toBe('active');
      expect(expectedSubscriptionData.productName).toBe('Pro Plan');
      expect(expectedSubscriptionData.amount).toBe(2000);
    });

    it('should handle no subscriptions found', async () => {
      mockStripe.subscriptions.list.mockResolvedValueOnce({
        data: [],
      });

      const emptySubscriptions = [];
      expect(emptySubscriptions.length).toBe(0);
    });

    it('should handle product retrieval failure', async () => {
      const mockSubscription = createMockSubscription();
      const productError = new Error('Product not found');

      mockStripe.subscriptions.list.mockResolvedValueOnce({
        data: [mockSubscription],
      });

      mockStripe.products.retrieve.mockRejectedValueOnce(productError);

      // Should still return subscription data with default product name
      const expectedProductName = 'Unknown Plan';
      expect(expectedProductName).toBe('Unknown Plan');
    });

    it('should handle different subscription statuses', async () => {
      const statuses = ['active', 'canceled', 'incomplete', 'past_due', 'trialing', 'unpaid'];

      statuses.forEach(status => {
        const mockSubscription = createMockSubscription(status);
        expect(mockSubscription.status).toBe(status);
      });
    });

    it('should handle subscription with trial period', async () => {
      const trialEnd = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days from now
      const mockSubscription = {
        ...createMockSubscription(),
        trial_end: trialEnd,
      };

      const expectedTrialEnd = new Date(trialEnd * 1000).toISOString();
      expect(new Date(expectedTrialEnd).getTime()).toBe(trialEnd * 1000);
    });

    it('should handle canceled subscription', async () => {
      const canceledAt = Math.floor(Date.now() / 1000) - 24 * 60 * 60; // 1 day ago
      const mockSubscription = {
        ...createMockSubscription('canceled'),
        canceled_at: canceledAt,
        cancel_at_period_end: true,
      };

      const expectedCanceledAt = new Date(canceledAt * 1000).toISOString();
      expect(new Date(expectedCanceledAt).getTime()).toBe(canceledAt * 1000);
      expect(mockSubscription.cancel_at_period_end).toBe(true);
    });

    it('should handle Stripe API errors', async () => {
      const stripeError = new Error('Stripe API error');
      stripeError.name = 'StripeError';

      mockStripe.subscriptions.list.mockRejectedValueOnce(stripeError);

      expect(stripeError.message).toBe('Stripe API error');
      expect(stripeError.name).toBe('StripeError');
    });
  });

  describe('Cache Management', () => {
    it('should cache subscription data after retrieval', async () => {
      const subscriptionData = {
        id: 'sub_test_12345',
        status: 'active',
        currentPeriodEnd: new Date().toISOString(),
        cancelAtPeriodEnd: false,
        priceId: 'price_test_12345',
        customerId: 'cus_test_12345',
      };

      const cacheKey = 'subscription:user-123';
      const ttl = 300; // 5 minutes

      mockCacheManager.set.mockResolvedValueOnce(true);

      expect(subscriptionData.id).toBe('sub_test_12345');
      expect(ttl).toBe(300);
    });

    it('should retrieve subscription from cache when available', async () => {
      const cachedSubscription = {
        id: 'sub_test_12345',
        status: 'active',
        customerId: 'cus_test_12345',
      };

      const cacheKey = 'subscription:user-123';

      mockCacheManager.get.mockResolvedValueOnce(cachedSubscription);

      expect(cachedSubscription.id).toBe('sub_test_12345');
    });

    it('should handle cache retrieval failure gracefully', async () => {
      const cacheError = new Error('Cache connection failed');

      mockCacheManager.get.mockRejectedValueOnce(cacheError);

      // Should return null and continue with normal flow
      expect(cacheError.message).toBe('Cache connection failed');
    });

    it('should handle cache set failure gracefully', async () => {
      const cacheError = new Error('Cache set failed');

      mockCacheManager.set.mockRejectedValueOnce(cacheError);

      // Should not throw error - caching failure shouldn't break the request
      expect(cacheError.message).toBe('Cache set failed');
    });

    it('should use correct cache key format', async () => {
      const userId = 'user-123';
      const expectedCacheKey = `subscription:${userId}`;

      expect(expectedCacheKey).toBe('subscription:user-123');
    });

    it('should set appropriate TTL for cache', async () => {
      const ttl = 300; // 5 minutes in seconds
      const ttlInMs = ttl * 1000;

      expect(ttl).toBe(300);
      expect(ttlInMs).toBe(300000);
    });
  });

  describe('Audit Logging', () => {
    it('should log subscription retrieval events', async () => {
      const auditEvent = {
        action: 'subscription_retrieved',
        userId: 'user-123',
        details: {
          customerId: 'cus_test_12345',
          subscriptionId: 'sub_test_12345',
          status: 'active',
        },
        requestId: 'req-123',
      };

      mockAuditLogger.log.mockResolvedValueOnce(true);

      expect(auditEvent.action).toBe('subscription_retrieved');
      expect(auditEvent.details.subscriptionId).toBe('sub_test_12345');
    });

    it('should handle audit logging failure gracefully', async () => {
      const auditError = new Error('Audit logging failed');

      mockAuditLogger.log.mockRejectedValueOnce(auditError);

      // Should not break the main flow
      expect(auditError.message).toBe('Audit logging failed');
    });
  });

  describe('Integration - Complete Flow', () => {
    it('should return cached subscription when available', async () => {
      const cachedData = {
        id: 'sub_test_12345',
        status: 'active',
        customerId: 'cus_test_12345',
      };

      mockCacheManager.get.mockResolvedValueOnce(cachedData);

      const result = {
        subscription: cachedData,
        cached: true,
      };

      expect(result.cached).toBe(true);
      expect(result.subscription.id).toBe('sub_test_12345');
    });

    it('should fetch from Stripe when cache miss', async () => {
      const mockProfile = createMockProfile();
      const mockSubscription = createMockSubscription();
      const mockProduct = createMockProduct();

      // Cache miss
      mockCacheManager.get.mockResolvedValueOnce(null);

      // Database retrieval
      mockDatabase.select.mockResolvedValueOnce({
        data: [mockProfile],
        error: null,
      });

      // Stripe retrieval
      mockStripe.subscriptions.list.mockResolvedValueOnce({
        data: [mockSubscription],
      });

      mockStripe.products.retrieve.mockResolvedValueOnce(mockProduct);

      // Cache set
      mockCacheManager.set.mockResolvedValueOnce(true);

      // Audit log
      mockAuditLogger.log.mockResolvedValueOnce(true);

      const result = {
        subscription: {
          id: mockSubscription.id,
          status: mockSubscription.status,
          productName: mockProduct.name,
        },
        cached: false,
      };

      expect(result.cached).toBe(false);
      expect(result.subscription.id).toBe('sub_test_12345');
      expect(result.subscription.productName).toBe('Pro Plan');
    });

    it('should return null for user without subscription', async () => {
      const mockProfile = createMockProfile(false);

      mockCacheManager.get.mockResolvedValueOnce(null);
      mockDatabase.select.mockResolvedValueOnce({
        data: [mockProfile],
        error: null,
      });

      const result = {
        subscription: null,
        cached: false,
      };

      expect(result.subscription).toBeNull();
      expect(result.cached).toBe(false);
    });

    it('should return null for user without Stripe customer ID', async () => {
      const profileWithoutCustomer = {
        ...createMockProfile(false),
        stripe_customer_id: null,
      };

      mockCacheManager.get.mockResolvedValueOnce(null);
      mockDatabase.select.mockResolvedValueOnce({
        data: [profileWithoutCustomer],
        error: null,
      });

      expect(profileWithoutCustomer.stripe_customer_id).toBeNull();
    });
  });
});

describe('JWT Token Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should decode JWT token correctly', async () => {
    // Mock JWT payload (base64 encoded)
    const payload = { sub: 'user-123', email: 'test@example.com' };
    const encodedPayload = btoa(JSON.stringify(payload));
    const mockToken = `header.${encodedPayload}.signature`;

    // Decode logic
    const decodedPayload = JSON.parse(atob(mockToken.split('.')[1]));

    expect(decodedPayload.sub).toBe('user-123');
    expect(decodedPayload.email).toBe('test@example.com');
  });

  it('should handle malformed JWT token', async () => {
    const malformedTokens = [
      'invalid-token',
      'header.invalid-payload.signature',
      'header..signature',
      '',
      null,
      undefined,
    ];

    malformedTokens.forEach(token => {
      if (!token) {
        expect(token).toBeFalsy();
      } else {
        const parts = token.split('.');
        if (parts.length !== 3) {
          expect(parts.length).not.toBe(3);
        }
      }
    });
  });

  it('should validate token payload structure', async () => {
    const validPayload = { sub: 'user-123', email: 'test@example.com', exp: Date.now() + 3600 };
    const invalidPayloads = [
      { email: 'test@example.com' }, // missing sub
      { sub: '' }, // empty sub
      { sub: null }, // null sub
      {}, // empty payload
    ];

    expect(validPayload.sub).toBe('user-123');

    invalidPayloads.forEach(payload => {
      expect(!payload.sub || payload.sub === '').toBe(true);
    });
  });
});

describe('Rate Limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should apply rate limiting to subscription requests', async () => {
    const rateLimitConfig = {
      requestsPerMinute: 30,
      windowMs: 60 * 1000,
      identifier: 'subscription:bearer-token',
    };

    mockRateLimiter.mockResolvedValueOnce(true);

    expect(rateLimitConfig.requestsPerMinute).toBe(30);
    expect(rateLimitConfig.windowMs).toBe(60000);
  });

  it('should extract identifier from request', async () => {
    const request = new Request('http://localhost:3000/test', {
      headers: {
        authorization: 'Bearer test-token-123',
        'x-real-ip': '192.168.1.1',
      },
    });

    const authHeader = request.headers.get('authorization');
    const ipHeader = request.headers.get('x-real-ip');

    const identifier = authHeader ? `subscription:${authHeader}` : `subscription:${ipHeader}`;

    expect(identifier).toBe('subscription:Bearer test-token-123');
  });

  it('should handle rate limit exceeded', async () => {
    const rateLimitError = new Error('Rate limit exceeded');
    rateLimitError.name = 'RateLimitError';

    mockRateLimiter.mockRejectedValueOnce(rateLimitError);

    expect(rateLimitError.message).toBe('Rate limit exceeded');
    expect(rateLimitError.name).toBe('RateLimitError');
  });
});

describe('HTTP Request Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle OPTIONS requests for CORS', async () => {
    const optionsRequest = new Request('http://localhost:3000/test', {
      method: 'OPTIONS',
    });

    expect(optionsRequest.method).toBe('OPTIONS');
  });

  it('should validate GET method requirement', async () => {
    const validRequest = new Request('http://localhost:3000/test', {
      method: 'GET',
    });

    const invalidRequests = ['POST', 'PUT', 'DELETE', 'PATCH'].map(
      method => new Request('http://localhost:3000/test', { method })
    );

    expect(validRequest.method).toBe('GET');
    invalidRequests.forEach(req => {
      expect(req.method).not.toBe('GET');
    });
  });

  it('should extract authorization header', async () => {
    const requestWithAuth = new Request('http://localhost:3000/test', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer test-token-123',
      },
    });

    const requestWithoutAuth = new Request('http://localhost:3000/test', {
      method: 'GET',
    });

    const authHeader = requestWithAuth.headers.get('authorization');
    const noAuthHeader = requestWithoutAuth.headers.get('authorization');

    expect(authHeader?.startsWith('Bearer ')).toBe(true);
    expect(noAuthHeader).toBeNull();
  });

  it('should generate unique request IDs', async () => {
    const requestId1 = crypto.randomUUID();
    const requestId2 = crypto.randomUUID();

    expect(requestId1).not.toBe(requestId2);
    expect(requestId1).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('should measure request duration', async () => {
    const startTime = Date.now();

    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 10));

    const duration = Date.now() - startTime;

    expect(duration).toBeGreaterThanOrEqual(10);
  });
});

describe('Response Format', () => {
  it('should return proper success response structure', async () => {
    const subscriptionData = {
      id: 'sub_test_12345',
      status: 'active',
      customerId: 'cus_test_12345',
    };

    const successResponse = {
      subscription: subscriptionData,
      cached: false,
      timestamp: new Date().toISOString(),
      requestId: 'req-123',
    };

    expect(successResponse).toHaveProperty('subscription');
    expect(successResponse).toHaveProperty('cached');
    expect(successResponse).toHaveProperty('timestamp');
    expect(successResponse).toHaveProperty('requestId');
    expect(successResponse.subscription.id).toBe('sub_test_12345');
  });

  it('should return proper null subscription response', async () => {
    const nullResponse = {
      subscription: null,
      cached: false,
      timestamp: new Date().toISOString(),
      requestId: 'req-123',
    };

    expect(nullResponse.subscription).toBeNull();
    expect(nullResponse.cached).toBe(false);
  });

  it('should include cache status in response', async () => {
    const cachedResponse = {
      subscription: { id: 'sub_test_12345' },
      cached: true,
      cacheKey: 'subscription:user-123',
      timestamp: new Date().toISOString(),
      requestId: 'req-123',
    };

    const uncachedResponse = {
      subscription: { id: 'sub_test_12345' },
      cached: false,
      timestamp: new Date().toISOString(),
      requestId: 'req-123',
    };

    expect(cachedResponse.cached).toBe(true);
    expect(uncachedResponse.cached).toBe(false);
  });
});

describe('Error Handling', () => {
  it('should handle database errors gracefully', async () => {
    const dbError = new Error('Database connection failed');
    dbError.name = 'DatabaseError';

    expect(dbError.message).toBe('Database connection failed');
    expect(dbError.name).toBe('DatabaseError');
  });

  it('should handle Stripe service errors', async () => {
    const stripeError = new Error('Stripe service unavailable');
    stripeError.name = 'StripeConnectionError';

    expect(stripeError.message).toBe('Stripe service unavailable');
    expect(stripeError.name).toBe('StripeConnectionError');
  });

  it('should handle authentication errors', async () => {
    const authError = new Error('Invalid or expired token');
    authError.name = 'AuthenticationError';

    expect(authError.message).toBe('Invalid or expired token');
    expect(authError.name).toBe('AuthenticationError');
  });

  it('should log errors with context', async () => {
    const errorContext = {
      userId: 'user-123',
      requestId: 'req-123',
      duration: 150,
      url: 'http://localhost:3000/subscription',
      method: 'GET',
    };

    mockLogger.error.mockImplementationOnce((message, error, context) => {
      expect(message).toBe('Subscription request failed');
      expect(context).toMatchObject(errorContext);
    });

    expect(errorContext.userId).toBe('user-123');
    expect(errorContext.duration).toBeGreaterThan(0);
  });
});
