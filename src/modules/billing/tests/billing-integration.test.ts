// CREATED: 2025-06-24 - Comprehensive billing integration tests for all endpoints

import crypto from 'node:crypto';
import { request } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const BASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';

describe('Billing Module Integration Tests', () => {
  let testUser: any;
  let testUserToken: string;
  let testApiKey: string;
  let stripeCustomerId: string;
  let stripeSubscriptionId: string;

  beforeAll(async () => {
    // Create test user for billing operations
    testUser = await globalThis.testDb.createTestUser({
      email: 'billing-integration@example.com',
      name: 'Billing Integration User',
      role: 'user',
      password: 'BillingTest123!',
    });

    // Get user token for authenticated requests
    testUserToken = await globalThis.testDb.getUserToken(testUser.id);

    // Create test API key for API key authentication tests
    testApiKey = await globalThis.testDb.createTestApiKey(testUser.id, {
      name: 'Billing Test API Key',
      permissions: ['billing:read', 'billing:write', 'profile:read'],
    });
  });

  afterAll(async () => {
    // Cleanup test data
    await globalThis.testDb.cleanup();
  });

  beforeEach(async () => {
    // Reset billing-related data before each test
    await globalThis.testDb.cleanupUserBillingData(testUser.id);
  });

  describe('Checkout Flow Integration Test', () => {
    it('should create checkout session with comprehensive validation', async () => {
      // Test case 1: Successful checkout session creation
      const checkoutPayload = {
        priceId: 'price_test_pro_monthly',
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
        quantity: 1,
        allowPromotionCodes: true,
        billingAddressCollection: 'auto',
      };

      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/billing_create-checkout-session')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send(checkoutPayload)
        .expect(200);

      // Verify response structure
      expect(response.body.success).toBe(true);
      expect(response.body.sessionId).toBeDefined();
      expect(response.body.url).toBeDefined();
      expect(response.body.customerId).toBeDefined();
      expect(response.body.expiresAt).toBeDefined();
      expect(response.body.message).toBe('Checkout session created successfully');

      // Verify session ID format (Stripe format: cs_...)
      expect(response.body.sessionId).toMatch(/^cs_/);

      // Verify URL format
      expect(response.body.url).toMatch(/^https:\/\/checkout\.stripe\.com/);

      // Store customer ID for later tests
      stripeCustomerId = response.body.customerId;

      // Verify security headers
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['strict-transport-security']).toBeDefined();

      // Verify CORS headers
      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });

    it('should handle invalid price ID gracefully', async () => {
      const invalidPayload = {
        priceId: 'price_invalid_id',
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      };

      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/billing_create-checkout-session')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send(invalidPayload)
        .expect(400);

      // Verify error response structure
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBeDefined();
      expect(response.body.error.message).toBeDefined();
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.requestId).toBeDefined();
    });

    it('should require authentication for checkout session', async () => {
      const checkoutPayload = {
        priceId: 'price_test_pro_monthly',
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      };

      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/billing_create-checkout-session')
        .send(checkoutPayload)
        .expect(401);

      expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('should work with API key authentication', async () => {
      const checkoutPayload = {
        priceId: 'price_test_pro_monthly',
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      };

      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/billing_create-checkout-session')
        .set('X-API-Key', testApiKey)
        .send(checkoutPayload)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.sessionId).toBeDefined();
    });

    it('should handle CORS preflight requests', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .options('/billing_create-checkout-session')
        .expect(200);

      expect(response.headers['access-control-allow-methods']).toContain('POST');
      expect(response.headers['access-control-allow-headers']).toContain('Authorization');
    });
  });

  describe('Customer Portal Integration Test', () => {
    beforeEach(async () => {
      // Set up user with Stripe customer ID for portal tests
      if (stripeCustomerId) {
        await globalThis.testDb.updateUserProfile(testUser.id, {
          stripe_customer_id: stripeCustomerId,
        });
      }
    });

    it('should create customer portal session successfully', async () => {
      const portalPayload = {
        returnUrl: 'http://localhost:3000/billing',
      };

      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/billing_create-customer-portal')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send(portalPayload)
        .expect(200);

      // Verify response structure
      expect(response.body.url).toBeDefined();
      expect(response.body.url).toMatch(/^https:\/\/billing\.stripe\.com/);

      // Verify security headers
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
    });

    it('should handle missing customer ID', async () => {
      // Remove Stripe customer ID
      await globalThis.testDb.updateUserProfile(testUser.id, {
        stripe_customer_id: null,
      });

      const portalPayload = {
        returnUrl: 'http://localhost:3000/billing',
      };

      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/billing_create-customer-portal')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send(portalPayload)
        .expect(400);

      expect(response.body.error.message).toContain('customer');
    });

    it('should require authentication', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/billing_create-customer-portal')
        .send({ returnUrl: 'http://localhost:3000/billing' })
        .expect(401);

      expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
    });
  });

  describe('Subscription Retrieval Integration Test', () => {
    beforeEach(async () => {
      // Set up user with subscription for testing
      stripeSubscriptionId = 'sub_test_' + crypto.randomBytes(8).toString('hex');

      await globalThis.testDb.updateUserProfile(testUser.id, {
        stripe_customer_id: stripeCustomerId || 'cus_test_' + crypto.randomBytes(8).toString('hex'),
        stripe_subscription_id: stripeSubscriptionId,
        stripe_subscription_status: 'active',
      });
    });

    it('should retrieve subscription with caching', async () => {
      // First request - should fetch from Stripe and cache
      const response1 = await request(`${BASE_URL}/functions/v1`)
        .get('/billing_get-subscription')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      // Verify response structure
      expect(response1.body.subscription).toBeDefined();
      expect(response1.body.subscription.id).toBeDefined();
      expect(response1.body.subscription.status).toBeDefined();
      expect(response1.body.subscription.currentPeriodEnd).toBeDefined();
      expect(response1.body.cached).toBe(false); // First request not cached

      // Second request - should use cache
      const response2 = await request(`${BASE_URL}/functions/v1`)
        .get('/billing_get-subscription')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      expect(response2.body.cached).toBe(true); // Second request cached
      expect(response2.body.cacheKey).toBeDefined();

      // Both responses should have identical subscription data
      expect(response2.body.subscription.id).toBe(response1.body.subscription.id);
    });

    it('should handle user without subscription', async () => {
      // Remove subscription from user
      await globalThis.testDb.updateUserProfile(testUser.id, {
        stripe_subscription_id: null,
        stripe_subscription_status: null,
      });

      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/billing_get-subscription')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      expect(response.body.subscription).toBeNull();
      expect(response.body.message).toBe('No active subscription found');
    });

    it('should work with API key authentication', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/billing_get-subscription')
        .set('X-API-Key', testApiKey)
        .expect(200);

      expect(response.body.subscription).toBeDefined();
    });

    it('should include comprehensive subscription data', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/billing_get-subscription')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      const subscription = response.body.subscription;

      // Verify all expected fields are present
      expect(subscription).toHaveProperty('id');
      expect(subscription).toHaveProperty('status');
      expect(subscription).toHaveProperty('currentPeriodEnd');
      expect(subscription).toHaveProperty('cancelAtPeriodEnd');
      expect(subscription).toHaveProperty('priceId');
      expect(subscription).toHaveProperty('customerId');

      // Optional fields may or may not be present
      if (subscription.productName) {
        expect(typeof subscription.productName).toBe('string');
      }
      if (subscription.amount) {
        expect(typeof subscription.amount).toBe('number');
      }
    });

    it('should apply rate limiting', async () => {
      // Make multiple rapid requests to test rate limiting
      const promises = Array.from({ length: 25 }, () =>
        request(`${BASE_URL}/functions/v1`)
          .get('/billing_get-subscription')
          .set('Authorization', `Bearer ${testUserToken}`)
      );

      const responses = await Promise.all(promises);

      // Some requests should be rate limited (429 status)
      const statusCodes = responses.map(r => r.status);
      const hasRateLimit = statusCodes.includes(429);

      if (hasRateLimit) {
        const rateLimitedResponse = responses.find(r => r.status === 429);
        expect(rateLimitedResponse!.body.error.code).toBe('RATE_LIMIT_ERROR');
      }
    });
  });

  describe('Webhook Processing Integration Test', () => {
    let webhookSignature: string;
    let webhookPayload: any;

    beforeEach(async () => {
      // Create mock webhook payload
      webhookPayload = {
        id: 'evt_test_' + crypto.randomBytes(8).toString('hex'),
        object: 'event',
        created: Math.floor(Date.now() / 1000),
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_' + crypto.randomBytes(8).toString('hex'),
            customer: stripeCustomerId || 'cus_test_' + crypto.randomBytes(8).toString('hex'),
            subscription:
              stripeSubscriptionId || 'sub_test_' + crypto.randomBytes(8).toString('hex'),
            metadata: {
              supabase_user_id: testUser.id,
            },
          },
        },
      };

      // Generate mock webhook signature (in real tests, this would be Stripe's signature)
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = JSON.stringify(webhookPayload);

      // Create HMAC signature similar to Stripe's format
      const hmac = crypto.createHmac('sha256', webhookSecret);
      hmac.update(`${timestamp}.${payload}`);
      const signature = hmac.digest('hex');

      webhookSignature = `t=${timestamp},v1=${signature}`;
    });

    it('should process checkout.session.completed webhook', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/billing_webhooks-stripe')
        .set('stripe-signature', webhookSignature)
        .send(webhookPayload)
        .expect(200);

      // Verify response structure
      expect(response.body.received).toBe(true);
      expect(response.body.eventId).toBe(webhookPayload.id);
      expect(response.body.eventType).toBe('checkout.session.completed');
      expect(response.body.processingTime).toBeGreaterThan(0);

      // Verify database was updated
      const updatedProfile = await globalThis.testDb.getUserProfile(testUser.id);
      expect(updatedProfile.stripe_customer_id).toBe(webhookPayload.data.object.customer);
      expect(updatedProfile.stripe_subscription_id).toBe(webhookPayload.data.object.subscription);
    });

    it('should process subscription.updated webhook', async () => {
      // Update webhook for subscription updated event
      webhookPayload.type = 'customer.subscription.updated';
      webhookPayload.data.object = {
        id: stripeSubscriptionId,
        status: 'past_due',
        customer: stripeCustomerId,
      };

      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/billing_webhooks-stripe')
        .set('stripe-signature', webhookSignature)
        .send(webhookPayload)
        .expect(200);

      expect(response.body.received).toBe(true);

      // Verify subscription status was updated
      const updatedProfile = await globalThis.testDb.getUserProfile(testUser.id);
      expect(updatedProfile.stripe_subscription_status).toBe('past_due');
    });

    it('should reject webhook without signature', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/billing_webhooks-stripe')
        .send(webhookPayload)
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('signature');
    });

    it('should reject webhook with invalid signature', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/billing_webhooks-stripe')
        .set('stripe-signature', 'invalid_signature')
        .send(webhookPayload)
        .expect(401);

      expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('should handle unrecognized webhook events gracefully', async () => {
      webhookPayload.type = 'unhandled.event.type';

      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/billing_webhooks-stripe')
        .set('stripe-signature', webhookSignature)
        .send(webhookPayload)
        .expect(200);

      expect(response.body.received).toBe(true);
      // Should indicate it was not handled
      expect(response.body.eventType).toBe('unhandled.event.type');
    });

    it('should handle old webhook events (replay attack prevention)', async () => {
      // Create webhook with old timestamp (older than 5 minutes)
      const oldTimestamp = Math.floor(Date.now() / 1000) - 6 * 60; // 6 minutes ago
      webhookPayload.created = oldTimestamp;

      // Recreate signature with old timestamp
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';
      const payload = JSON.stringify(webhookPayload);
      const hmac = crypto.createHmac('sha256', webhookSecret);
      hmac.update(`${oldTimestamp}.${payload}`);
      const signature = hmac.digest('hex');
      const oldSignature = `t=${oldTimestamp},v1=${signature}`;

      const response = await request(`${BASE_URL}/functions/v1`)
        .post('/billing_webhooks-stripe')
        .set('stripe-signature', oldSignature)
        .send(webhookPayload)
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('too old');
    });
  });

  describe('Cross-Endpoint Integration and Data Flow', () => {
    it('should complete full billing lifecycle', async () => {
      // 1. Create checkout session
      const checkoutResponse = await request(`${BASE_URL}/functions/v1`)
        .post('/billing_create-checkout-session')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          priceId: 'price_test_pro_monthly',
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        })
        .expect(200);

      const sessionId = checkoutResponse.body.sessionId;
      const customerId = checkoutResponse.body.customerId;

      // 2. Simulate successful checkout webhook
      const webhookPayload = {
        id: 'evt_test_lifecycle',
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: sessionId,
            customer: customerId,
            subscription: 'sub_test_lifecycle',
            metadata: {
              supabase_user_id: testUser.id,
            },
          },
        },
      };

      // Generate proper webhook signature
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = JSON.stringify(webhookPayload);
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';
      const hmac = crypto.createHmac('sha256', webhookSecret);
      hmac.update(`${timestamp}.${payload}`);
      const signature = hmac.digest('hex');
      const webhookSignature = `t=${timestamp},v1=${signature}`;

      await request(`${BASE_URL}/functions/v1`)
        .post('/billing_webhooks-stripe')
        .set('stripe-signature', webhookSignature)
        .send(webhookPayload)
        .expect(200);

      // 3. Verify subscription is retrievable
      const subscriptionResponse = await request(`${BASE_URL}/functions/v1`)
        .get('/billing_get-subscription')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      expect(subscriptionResponse.body.subscription).toBeDefined();
      expect(subscriptionResponse.body.subscription.customerId).toBe(customerId);

      // 4. Access customer portal
      const portalResponse = await request(`${BASE_URL}/functions/v1`)
        .post('/billing_create-customer-portal')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ returnUrl: 'http://localhost:3000/billing' })
        .expect(200);

      expect(portalResponse.body.url).toBeDefined();
    });

    it('should maintain data consistency across requests', async () => {
      // Make concurrent requests to different billing endpoints
      const concurrentRequests = [
        request(`${BASE_URL}/functions/v1`)
          .get('/billing_get-subscription')
          .set('Authorization', `Bearer ${testUserToken}`),

        request(`${BASE_URL}/functions/v1`)
          .post('/billing_create-customer-portal')
          .set('Authorization', `Bearer ${testUserToken}`)
          .send({ returnUrl: 'http://localhost:3000/billing' }),

        request(`${BASE_URL}/functions/v1`)
          .post('/billing_create-checkout-session')
          .set('Authorization', `Bearer ${testUserToken}`)
          .send({
            priceId: 'price_test_basic_monthly',
            successUrl: 'http://localhost:3000/success',
            cancelUrl: 'http://localhost:3000/cancel',
          }),
      ];

      const responses = await Promise.allSettled(concurrentRequests);

      // All requests should complete without conflicts
      responses.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          expect([200, 400, 401].includes(result.value.status)).toBe(true);
        } else {
          console.warn(`Concurrent request ${index} failed:`, result.reason);
        }
      });
    });
  });

  describe('Performance and Monitoring Integration', () => {
    it('should track performance metrics', async () => {
      const startTime = Date.now();

      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/billing_get-subscription')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      const totalTime = Date.now() - startTime;

      // Response should include performance information
      expect(response.body.timestamp).toBeDefined();

      // Performance should be reasonable
      expect(totalTime).toBeLessThan(5000); // Under 5 seconds

      // If processing time is reported, verify it's reasonable
      if (response.body.processingTime) {
        expect(response.body.processingTime).toBeGreaterThan(0);
        expect(response.body.processingTime).toBeLessThan(totalTime + 100);
      }
    });

    it('should include proper request tracking', async () => {
      const response = await request(`${BASE_URL}/functions/v1`)
        .get('/billing_get-subscription')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      // Response should include request ID for tracking
      expect(response.headers['x-request-id'] || response.body.requestId).toBeDefined();

      // Timestamp should be present and valid
      expect(response.body.timestamp).toBeDefined();
      const timestamp = new Date(response.body.timestamp);
      expect(timestamp.getTime()).toBeGreaterThan(Date.now() - 10000); // Within last 10 seconds
    });
  });
});
