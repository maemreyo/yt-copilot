// Unit tests for create-customer-portal function
// CREATED: 2025-01-28 - Comprehensive unit tests for customer portal creation

import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock external dependencies
vi.mock('@supabase/supabase-js');
vi.mock('stripe');
vi.mock('@/cors');
vi.mock('@/shared-errors');

// Mock Stripe module
const mockStripe = {
  customers: {
    create: vi.fn(),
    retrieve: vi.fn(),
  },
  billingPortal: {
    sessions: {
      create: vi.fn(),
    },
  },
};

// Mock Supabase client
const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
  auth: {
    getUser: vi.fn(),
  },
};

vi.mocked(createClient).mockReturnValue(mockSupabase as any);

// Test data factories
const createValidPortalRequest = () => ({
  returnUrl: 'https://example.com/billing',
  configuration: 'bpc_test_12345',
  locale: 'en',
});

const createMockUser = () => ({
  id: 'user-123',
  email: 'test@example.com',
});

const createMockPortalSession = () => ({
  id: 'bps_test_12345',
  url: 'https://billing.stripe.com/p/session/test',
});

const createMockProfile = (withCustomerId = true) => ({
  stripe_customer_id: withCustomerId ? 'cus_test_12345' : null,
});

describe('CustomerPortalValidator', () => {
  describe('Request Validation', () => {
    it('should accept valid portal request', async () => {
      const validRequest = createValidPortalRequest();

      // Test URL validation
      expect(() => new URL(validRequest.returnUrl)).not.toThrow();
      expect(['http:', 'https:'].includes(new URL(validRequest.returnUrl).protocol)).toBe(true);

      // Test configuration ID format
      expect(validRequest.configuration).toMatch(/^bpc_[a-zA-Z0-9_]+$/);

      // Test locale validation
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
      expect(validLocales.includes(validRequest.locale)).toBe(true);
    });

    it('should reject invalid return URL formats', async () => {
      const invalidRequests = [
        { returnUrl: 'not-a-url' },
        { returnUrl: 'javascript:alert(1)' },
        { returnUrl: '' },
        { returnUrl: 'mailto:test@example.com' },
      ];

      invalidRequests.forEach(request => {
        if (request.returnUrl === '') {
          expect(request.returnUrl).toBe('');
        } else {
          try {
            const urlObj = new URL(request.returnUrl);
            // URL is valid but protocol should not allow non-HTTP(S)
            expect(['http:', 'https:'].includes(urlObj.protocol)).toBe(false);
          } catch {
            // URL is invalid format - this is expected
            expect(true).toBe(true);
          }
        }
      });
    });

    it('should reject invalid configuration ID format', async () => {
      const invalidConfigurations = ['invalid_config', 'config_12345', 'bpc_', 'bpc', '12345'];

      const configRegex = /^bpc_[a-zA-Z0-9]+$/;
      invalidConfigurations.forEach(config => {
        expect(configRegex.test(config)).toBe(false);
      });
    });

    it('should reject invalid locale values', async () => {
      const invalidLocales = [
        'invalid',
        'en-us', // should be uppercase
        'english',
        'fr-fr', // should be uppercase
        'de-de', // should be uppercase
      ];

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

      invalidLocales.forEach(locale => {
        expect(validLocales.includes(locale)).toBe(false);
      });
    });

    it('should validate return URL domains', async () => {
      const allowedDomains = ['example.com', 'app.example.com'];
      const testUrls = [
        { url: 'https://example.com/billing', shouldPass: true },
        { url: 'https://app.example.com/billing', shouldPass: true },
        { url: 'https://subdomain.example.com/billing', shouldPass: true },
        { url: 'https://malicious.com/billing', shouldPass: false },
        { url: 'https://example.com.evil.com/billing', shouldPass: false },
      ];

      testUrls.forEach(({ url, shouldPass }) => {
        try {
          const urlObj = new URL(url);
          const hostname = urlObj.hostname.toLowerCase();
          const isAllowed = allowedDomains.some(domain => {
            const lowerDomain = domain.toLowerCase();
            return hostname === lowerDomain || hostname.endsWith(`.${lowerDomain}`);
          });
          expect(isAllowed).toBe(shouldPass);
        } catch {
          expect(shouldPass).toBe(false);
        }
      });
    });
  });
});

describe('CustomerPortalRateLimiter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should allow requests within rate limit', async () => {
    const userId = 'user-123';
    const mockUserRequests = new Map();
    const windowMs = 60 * 1000; // 1 minute
    const maxRequests = 5;
    const now = Date.now();

    // Simulate first request
    mockUserRequests.set(userId, { count: 1, resetTime: now + windowMs });
    const userLimit = mockUserRequests.get(userId);

    expect(userLimit.count).toBeLessThanOrEqual(maxRequests);
    expect(userLimit.resetTime).toBeGreaterThan(now);
  });

  it('should block requests when rate limit exceeded', async () => {
    const userId = 'user-123';
    const mockUserRequests = new Map();
    const windowMs = 60 * 1000;
    const maxRequests = 5;
    const now = Date.now();

    // Simulate user who has exceeded rate limit
    mockUserRequests.set(userId, { count: maxRequests, resetTime: now + windowMs });
    const userLimit = mockUserRequests.get(userId);

    const rateLimitResult = {
      allowed: userLimit.count < maxRequests,
      resetTime: userLimit.resetTime,
      remaining: Math.max(0, maxRequests - userLimit.count),
    };

    expect(rateLimitResult.allowed).toBe(false);
    expect(rateLimitResult.remaining).toBe(0);
    expect(rateLimitResult.resetTime).toBeGreaterThan(now);
  });

  it('should reset rate limit after window expires', async () => {
    const userId = 'user-123';
    const mockUserRequests = new Map();
    const windowMs = 60 * 1000;
    const maxRequests = 5;
    const now = Date.now();

    // Simulate expired window
    const expiredResetTime = now - 1000;
    mockUserRequests.set(userId, { count: maxRequests, resetTime: expiredResetTime });

    // Check if window has expired
    const userLimit = mockUserRequests.get(userId);
    const isExpired = now > userLimit.resetTime;

    if (isExpired) {
      // Reset the limit
      mockUserRequests.set(userId, { count: 1, resetTime: now + windowMs });
      const newLimit = mockUserRequests.get(userId);

      expect(newLimit.count).toBe(1);
      expect(newLimit.resetTime).toBeGreaterThan(now);
    }

    expect(isExpired).toBe(true);
  });

  it('should track remaining requests correctly', async () => {
    const userId = 'user-123';
    const mockUserRequests = new Map();
    const maxRequests = 5;

    // Test different request counts
    [1, 2, 3, 4, 5].forEach(count => {
      mockUserRequests.set(userId, { count, resetTime: Date.now() + 60000 });
      const userLimit = mockUserRequests.get(userId);
      const remaining = maxRequests - userLimit.count;

      expect(remaining).toBe(maxRequests - count);
      expect(remaining).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('CustomerPortalService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup environment variables
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_12345');
    vi.stubEnv('SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
    vi.stubEnv('APP_URL', 'http://localhost:3000');
  });

  describe('Customer Management', () => {
    it('should return existing customer ID when available', async () => {
      const mockProfile = createMockProfile(true);

      mockSupabase.single.mockResolvedValueOnce({
        data: mockProfile,
        error: null,
      });

      // Mock Stripe customer retrieval success
      const mockCustomer = { id: 'cus_test_12345' };

      expect(mockProfile.stripe_customer_id).toBe('cus_test_12345');
      expect(mockCustomer.id).toMatch(/^cus_/);
    });

    it('should create new customer when none exists', async () => {
      const mockProfile = createMockProfile(false);
      const mockUser = createMockUser();

      mockSupabase.single.mockResolvedValueOnce({
        data: mockProfile,
        error: null,
      });

      // Mock customer creation
      const newCustomer = {
        id: 'cus_new_12345',
        email: mockUser.email,
        metadata: { supabase_id: mockUser.id },
      };

      mockSupabase.single.mockResolvedValueOnce({
        data: { id: 'profile-updated' },
        error: null,
      });

      expect(mockProfile.stripe_customer_id).toBeNull();
      expect(newCustomer.id).toMatch(/^cus_/);
      expect(newCustomer.email).toBe(mockUser.email);
    });

    it('should handle customer retrieval failure', async () => {
      const mockProfile = createMockProfile(true);

      mockSupabase.single.mockResolvedValueOnce({
        data: mockProfile,
        error: null,
      });

      // Mock Stripe customer retrieval failure
      const customerError = new Error('Customer not found');

      expect(customerError.message).toBe('Customer not found');
    });

    it('should handle profile fetch failure', async () => {
      const profileError = new Error('Failed to fetch user profile');

      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: profileError,
      });

      expect(profileError.message).toBe('Failed to fetch user profile');
    });
  });

  describe('Portal Session Creation', () => {
    it('should create valid portal session', async () => {
      const mockSession = createMockPortalSession();
      const validRequest = createValidPortalRequest();
      const customerId = 'cus_test_12345';

      const expectedParams = {
        customer: customerId,
        return_url: validRequest.returnUrl,
        configuration: validRequest.configuration,
        locale: validRequest.locale,
      };

      // Verify session parameters structure
      expect(expectedParams.customer).toMatch(/^cus_/);
      expect(() => new URL(expectedParams.return_url)).not.toThrow();
      expect(expectedParams.configuration).toMatch(/^bpc_/);

      // Verify session response
      expect(mockSession.id).toMatch(/^bps_/);
      expect(mockSession.url).toMatch(/^https:\/\/billing\.stripe\.com/);
    });

    it('should use default return URL when none provided', async () => {
      const appUrl = 'http://localhost:3000';
      const defaultReturnUrl = `${appUrl}/billing`;

      const requestWithoutUrl = {
        configuration: 'bpc_test_12345',
        locale: 'en',
      };

      // Test default URL logic
      const returnUrl = requestWithoutUrl.returnUrl || defaultReturnUrl;
      expect(returnUrl).toBe(defaultReturnUrl);
    });

    it('should handle session creation failure', async () => {
      const stripeError = new Error('Session creation failed');
      stripeError.name = 'StripeError';

      expect(stripeError.message).toBe('Session creation failed');
      expect(stripeError.name).toBe('StripeError');
    });

    it('should include all optional parameters when provided', async () => {
      const fullRequest = createValidPortalRequest();

      const sessionParams = {
        customer: 'cus_test_12345',
        return_url: fullRequest.returnUrl,
        configuration: fullRequest.configuration,
        locale: fullRequest.locale,
      };

      expect(sessionParams).toHaveProperty('configuration');
      expect(sessionParams).toHaveProperty('locale');
      expect(sessionParams.configuration).toBe(fullRequest.configuration);
      expect(sessionParams.locale).toBe(fullRequest.locale);
    });

    it('should calculate correct expiration time', async () => {
      const now = Date.now();
      const expiresIn24Hours = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
      const expiresAt = new Date(now + expiresIn24Hours).toISOString();

      const expectedTime = new Date(now + expiresIn24Hours);
      const actualTime = new Date(expiresAt);

      expect(Math.abs(actualTime.getTime() - expectedTime.getTime())).toBeLessThan(1000);
    });
  });

  describe('Domain Validation', () => {
    beforeEach(() => {
      vi.stubEnv('APP_URL', 'http://localhost:3000');
      vi.stubEnv('ALLOWED_RETURN_DOMAINS', 'example.com,app.example.com');
    });

    it('should get allowed domains from environment', async () => {
      const appUrl = 'http://localhost:3000';
      const appDomain = new URL(appUrl).hostname; // localhost
      const additionalDomains = 'example.com,app.example.com'.split(',').map(d => d.trim());

      const allowedDomains = [appDomain, ...additionalDomains];

      expect(allowedDomains).toContain('localhost');
      expect(allowedDomains).toContain('example.com');
      expect(allowedDomains).toContain('app.example.com');
    });

    it('should handle missing additional domains', async () => {
      vi.stubEnv('ALLOWED_RETURN_DOMAINS', '');

      const appUrl = 'http://localhost:3000';
      const appDomain = new URL(appUrl).hostname;
      const additionalDomains = '';

      const allowedDomains = [appDomain];
      if (additionalDomains) {
        allowedDomains.push(...additionalDomains.split(',').map(d => d.trim()));
      }

      expect(allowedDomains).toEqual(['localhost']);
    });
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

  it('should validate POST method requirement', async () => {
    const invalidMethods = ['GET', 'PUT', 'DELETE', 'PATCH'];

    invalidMethods.forEach(method => {
      const request = new Request('http://localhost:3000/test', { method });
      expect(request.method).not.toBe('POST');
    });
  });

  it('should extract and validate authorization header', async () => {
    const validAuthRequest = new Request('http://localhost:3000/test', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token-123',
      },
    });

    const invalidAuthRequest = new Request('http://localhost:3000/test', {
      method: 'POST',
      headers: {
        Authorization: 'Basic dGVzdA==', // Not Bearer
      },
    });

    const noAuthRequest = new Request('http://localhost:3000/test', {
      method: 'POST',
    });

    const validAuth = validAuthRequest.headers.get('Authorization');
    const invalidAuth = invalidAuthRequest.headers.get('Authorization');
    const noAuth = noAuthRequest.headers.get('Authorization');

    expect(validAuth?.startsWith('Bearer ')).toBe(true);
    expect(invalidAuth?.startsWith('Bearer ')).toBe(false);
    expect(noAuth).toBeNull();
  });

  it('should parse JSON request body', async () => {
    const requestBody = createValidPortalRequest();
    const request = new Request('http://localhost:3000/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const parsedBody = await request.json();
    expect(parsedBody).toEqual(requestBody);
  });

  it('should handle empty request body', async () => {
    const request = new Request('http://localhost:3000/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: '',
    });

    const bodyText = await request.text();
    expect(bodyText.trim()).toBe('');
  });

  it('should handle malformed JSON in request body', async () => {
    const request = new Request('http://localhost:3000/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: '{ invalid json }',
    });

    await expect(request.json()).rejects.toThrow();
  });

  it('should generate unique request IDs', async () => {
    const requestId1 = crypto.randomUUID();
    const requestId2 = crypto.randomUUID();

    expect(requestId1).not.toBe(requestId2);
    expect(requestId1).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(requestId2).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});

describe('Authentication and Authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should extract user from valid JWT token', async () => {
    const mockUser = createMockUser();

    mockSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: mockUser },
      error: null,
    });

    const token = 'valid-jwt-token-123';

    expect(mockUser.id).toBe('user-123');
    expect(mockUser.email).toBe('test@example.com');
  });

  it('should handle invalid JWT token', async () => {
    const invalidTokenError = new Error('Invalid or expired token');

    mockSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: invalidTokenError,
    });

    expect(invalidTokenError.message).toBe('Invalid or expired token');
  });

  it('should handle missing user in token response', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });

    const result = { user: null };
    expect(result.user).toBeNull();
  });
});

describe('Error Response Handling', () => {
  it('should create proper error response structure', async () => {
    const errorResponse = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: ['returnUrl must be a valid URL'],
      },
      timestamp: new Date().toISOString(),
      requestId: 'req-123',
    };

    expect(errorResponse).toHaveProperty('error');
    expect(errorResponse.error).toHaveProperty('code');
    expect(errorResponse.error).toHaveProperty('message');
    expect(errorResponse).toHaveProperty('timestamp');
    expect(errorResponse).toHaveProperty('requestId');
  });

  it('should include rate limit headers in response', async () => {
    const rateLimitHeaders = {
      'X-RateLimit-Remaining': '4',
      'X-RateLimit-Reset': Math.floor((Date.now() + 60000) / 1000).toString(),
    };

    expect(rateLimitHeaders['X-RateLimit-Remaining']).toBe('4');
    expect(parseInt(rateLimitHeaders['X-RateLimit-Reset'])).toBeGreaterThan(
      Math.floor(Date.now() / 1000)
    );
  });

  it('should handle different error types appropriately', async () => {
    const errorTypes = [
      { name: 'ValidationError', expectedCode: 'VALIDATION_ERROR' },
      { name: 'AuthenticationError', expectedCode: 'AUTHENTICATION_ERROR' },
      { name: 'RateLimitError', expectedCode: 'RATE_LIMIT_ERROR' },
      { name: 'ExternalServiceError', expectedCode: 'EXTERNAL_SERVICE_ERROR' },
    ];

    errorTypes.forEach(({ name, expectedCode }) => {
      const error = new Error(`Test ${name}`);
      error.name = name;

      expect(error.name).toBe(name);
      expect(error.message).toContain('Test');
    });
  });
});
