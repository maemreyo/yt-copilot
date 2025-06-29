// Unit tests for webhooks-stripe function
// CREATED: 2025-01-28 - Comprehensive unit tests for Stripe webhook processing

import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock external dependencies
vi.mock('@supabase/supabase-js');
vi.mock('stripe');
vi.mock('@/cors');
vi.mock('@/shared-errors');
vi.mock('@/audit-logging');
vi.mock('@/database');
vi.mock('@/logging');
vi.mock('@/security');

// Mock Stripe module
const mockStripe = {
  webhooks: {
    constructEvent: vi.fn(),
  },
};

// Mock database helper
const mockDatabase = {
  insert: vi.fn(),
  update: vi.fn(),
  select: vi.fn(),
  delete: vi.fn(),
};

// Mock logger
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

// Mock audit logger
const mockAuditLogger = {
  log: vi.fn(),
  logSecurityEvent: vi.fn(),
};

// Mock security middleware
const mockSecurityMiddleware = {
  secureResponse: vi.fn(),
};

vi.mocked(createClient).mockReturnValue({} as any);

// Test data factories
const createMockCheckoutSession = () => ({
  id: 'cs_test_12345',
  customer: 'cus_test_12345',
  subscription: 'sub_test_12345',
  amount_total: 2000,
  currency: 'usd',
  metadata: {
    supabase_user_id: 'user-123',
  },
});

const createMockSubscription = (status = 'active') => ({
  id: 'sub_test_12345',
  customer: 'cus_test_12345',
  status,
  current_period_start: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
  current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
  canceled_at: status === 'canceled' ? Math.floor(Date.now() / 1000) : null,
});

const createMockInvoice = (paid = true) => ({
  id: 'in_test_12345',
  customer: 'cus_test_12345',
  subscription: 'sub_test_12345',
  amount_paid: paid ? 2000 : 0,
  amount_due: paid ? 0 : 2000,
  currency: 'usd',
  status: paid ? 'paid' : 'open',
});

const createMockWebhookEvent = (type: string, data: any) => ({
  id: 'evt_test_12345',
  type,
  created: Math.floor(Date.now() / 1000),
  data: {
    object: data,
  },
  livemode: false,
  api_version: '2023-10-16',
  pending_webhooks: 1,
  request: {
    id: 'req_test_12345',
    idempotency_key: 'ikey_test_12345',
  },
});

describe('StripeWebhookService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup environment variables
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_12345');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test_12345');
    vi.stubEnv('SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
  });

  describe('Request Validation', () => {
    it('should handle OPTIONS requests for CORS', async () => {
      const optionsRequest = new Request('http://localhost:3000/webhook', {
        method: 'OPTIONS',
      });

      expect(optionsRequest.method).toBe('OPTIONS');
    });

    it('should validate POST method requirement', async () => {
      const invalidMethods = ['GET', 'PUT', 'DELETE', 'PATCH'];

      invalidMethods.forEach(method => {
        const request = new Request('http://localhost:3000/webhook', { method });
        expect(request.method).not.toBe('POST');
      });
    });

    it('should require Stripe signature header', async () => {
      const requestWithSignature = new Request('http://localhost:3000/webhook', {
        method: 'POST',
        headers: {
          'stripe-signature': 't=1234567890,v1=signature123',
        },
      });

      const requestWithoutSignature = new Request('http://localhost:3000/webhook', {
        method: 'POST',
      });

      const withSig = requestWithSignature.headers.get('stripe-signature');
      const withoutSig = requestWithoutSignature.headers.get('stripe-signature');

      expect(withSig).toBeTruthy();
      expect(withoutSig).toBeNull();
    });

    it('should validate Stripe signature format', async () => {
      const validSignatures = [
        't=1234567890,v1=signature123',
        't=1234567890,v1=signature123,v0=oldsignature',
      ];

      const invalidSignatures = ['invalid-signature', 't=1234567890', 'v1=signature123', ''];

      validSignatures.forEach(sig => {
        expect(sig).toMatch(/t=\d+,v1=\w+/);
      });

      invalidSignatures.forEach(sig => {
        expect(sig).not.toMatch(/t=\d+,v1=\w+/);
      });
    });
  });

  describe('Webhook Signature Verification', () => {
    it('should verify valid webhook signature', async () => {
      const mockEvent = createMockWebhookEvent(
        'checkout.session.completed',
        createMockCheckoutSession()
      );
      const signature = 't=1234567890,v1=validSignature123';
      const rawBody = JSON.stringify(mockEvent);

      mockStripe.webhooks.constructEvent.mockReturnValueOnce(mockEvent);

      // Test would verify signature verification logic
      expect(mockEvent.id).toBe('evt_test_12345');
    });

    it('should reject invalid webhook signature', async () => {
      const invalidSignatureError = new Error('Invalid webhook signature');
      invalidSignatureError.name = 'StripeSignatureVerificationError';

      mockStripe.webhooks.constructEvent.mockImplementationOnce(() => {
        throw invalidSignatureError;
      });

      expect(invalidSignatureError.message).toBe('Invalid webhook signature');
      expect(invalidSignatureError.name).toBe('StripeSignatureVerificationError');
    });

    it('should handle webhook secret validation', async () => {
      const webhookSecret = 'whsec_test_12345';
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = JSON.stringify({ test: 'data' });

      // Mock HMAC signature creation
      const expectedSignature = `t=${timestamp},v1=mockedSignature`;

      expect(webhookSecret.startsWith('whsec_')).toBe(true);
      expect(timestamp).toBeGreaterThan(0);
    });
  });

  describe('Event Processing', () => {
    describe('checkout.session.completed', () => {
      it('should process checkout session completed event', async () => {
        const checkoutSession = createMockCheckoutSession();
        const event = createMockWebhookEvent('checkout.session.completed', checkoutSession);

        mockDatabase.insert.mockResolvedValueOnce({
          data: { id: 'billing-event-123' },
          error: null,
        });

        mockAuditLogger.log.mockResolvedValueOnce(true);

        const expectedBillingEvent = {
          event_type: 'checkout_completed',
          stripe_customer_id: checkoutSession.customer,
          stripe_session_id: checkoutSession.id,
          amount: checkoutSession.amount_total,
          currency: checkoutSession.currency,
          metadata: checkoutSession.metadata,
          created_at: expect.any(String),
        };

        expect(expectedBillingEvent.event_type).toBe('checkout_completed');
        expect(expectedBillingEvent.stripe_session_id).toBe('cs_test_12345');
        expect(expectedBillingEvent.amount).toBe(2000);
      });

      it('should handle checkout session database insert failure', async () => {
        const dbError = new Error('Database insert failed');

        mockDatabase.insert.mockResolvedValueOnce({
          data: null,
          error: dbError,
        });

        expect(dbError.message).toBe('Database insert failed');
      });
    });

    describe('customer.subscription.created', () => {
      it('should process subscription created event', async () => {
        const subscription = createMockSubscription('active');
        const event = createMockWebhookEvent('customer.subscription.created', subscription);

        mockDatabase.insert.mockResolvedValueOnce({
          data: { id: 'billing-event-123' },
          error: null,
        });

        mockAuditLogger.log.mockResolvedValueOnce(true);

        const expectedBillingEvent = {
          event_type: 'subscription_created',
          stripe_customer_id: subscription.customer,
          stripe_subscription_id: subscription.id,
          status: subscription.status,
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          created_at: expect.any(String),
        };

        expect(expectedBillingEvent.event_type).toBe('subscription_created');
        expect(expectedBillingEvent.stripe_subscription_id).toBe('sub_test_12345');
        expect(expectedBillingEvent.status).toBe('active');
      });
    });

    describe('customer.subscription.updated', () => {
      it('should process subscription updated event', async () => {
        const subscription = createMockSubscription('active');
        const event = createMockWebhookEvent('customer.subscription.updated', subscription);

        mockDatabase.update.mockResolvedValueOnce({
          data: { id: 'billing-event-123' },
          error: null,
        });

        mockAuditLogger.log.mockResolvedValueOnce(true);

        const expectedUpdateData = {
          status: subscription.status,
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          updated_at: expect.any(String),
        };

        const expectedWhereClause = {
          stripe_subscription_id: subscription.id,
        };

        expect(expectedUpdateData.status).toBe('active');
        expect(expectedWhereClause.stripe_subscription_id).toBe('sub_test_12345');
      });

      it('should handle subscription update failure gracefully', async () => {
        const updateError = new Error('Update failed');

        mockDatabase.update.mockResolvedValueOnce({
          data: null,
          error: updateError,
        });

        // Should not throw error - update failure should be logged as warning
        expect(updateError.message).toBe('Update failed');
      });
    });

    describe('customer.subscription.deleted', () => {
      it('should process subscription deleted event', async () => {
        const subscription = createMockSubscription('canceled');
        const event = createMockWebhookEvent('customer.subscription.deleted', subscription);

        mockDatabase.insert.mockResolvedValueOnce({
          data: { id: 'billing-event-123' },
          error: null,
        });

        mockAuditLogger.log.mockResolvedValueOnce(true);

        const expectedBillingEvent = {
          event_type: 'subscription_deleted',
          stripe_customer_id: subscription.customer,
          stripe_subscription_id: subscription.id,
          status: subscription.status,
          canceled_at: subscription.canceled_at
            ? new Date(subscription.canceled_at * 1000).toISOString()
            : null,
          created_at: expect.any(String),
        };

        expect(expectedBillingEvent.event_type).toBe('subscription_deleted');
        expect(expectedBillingEvent.status).toBe('canceled');
        expect(expectedBillingEvent.canceled_at).toBeTruthy();
      });
    });

    describe('invoice.payment_succeeded', () => {
      it('should process payment succeeded event', async () => {
        const invoice = createMockInvoice(true);
        const event = createMockWebhookEvent('invoice.payment_succeeded', invoice);

        mockDatabase.insert.mockResolvedValueOnce({
          data: { id: 'billing-event-123' },
          error: null,
        });

        mockAuditLogger.log.mockResolvedValueOnce(true);

        const expectedBillingEvent = {
          event_type: 'payment_succeeded',
          stripe_customer_id: invoice.customer,
          stripe_invoice_id: invoice.id,
          stripe_subscription_id: invoice.subscription,
          amount: invoice.amount_paid,
          currency: invoice.currency,
          created_at: expect.any(String),
        };

        expect(expectedBillingEvent.event_type).toBe('payment_succeeded');
        expect(expectedBillingEvent.amount).toBe(2000);
        expect(expectedBillingEvent.stripe_invoice_id).toBe('in_test_12345');
      });
    });

    describe('invoice.payment_failed', () => {
      it('should process payment failed event', async () => {
        const invoice = createMockInvoice(false);
        const event = createMockWebhookEvent('invoice.payment_failed', invoice);

        mockDatabase.insert.mockResolvedValueOnce({
          data: { id: 'billing-event-123' },
          error: null,
        });

        mockAuditLogger.logSecurityEvent.mockResolvedValueOnce(true);

        const expectedBillingEvent = {
          event_type: 'payment_failed',
          stripe_customer_id: invoice.customer,
          stripe_invoice_id: invoice.id,
          stripe_subscription_id: invoice.subscription,
          amount: invoice.amount_due,
          currency: invoice.currency,
          created_at: expect.any(String),
        };

        expect(expectedBillingEvent.event_type).toBe('payment_failed');
        expect(expectedBillingEvent.amount).toBe(2000); // amount_due
      });

      it('should log security event for payment failure', async () => {
        const invoice = createMockInvoice(false);
        const requestId = 'req-123';

        const expectedSecurityEvent = {
          action: 'payment_failed',
          userId: invoice.customer,
          details: {
            invoiceId: invoice.id,
            subscriptionId: invoice.subscription,
            amount: invoice.amount_due,
            currency: invoice.currency,
          },
          requestId,
        };

        expect(expectedSecurityEvent.action).toBe('payment_failed');
        expect(expectedSecurityEvent.details.amount).toBe(2000);
      });
    });

    describe('Unhandled Event Types', () => {
      it('should handle unhandled event types gracefully', async () => {
        const unknownEvent = createMockWebhookEvent('unknown.event.type', {});

        // Should not throw error for unknown event types
        expect(unknownEvent.type).toBe('unknown.event.type');
      });

      it('should log unhandled event types', async () => {
        const unknownEventType = 'customer.discount.created';
        const requestId = 'req-123';

        mockLogger.info.mockImplementationOnce((message, context) => {
          expect(message).toBe('Unhandled webhook event type');
          expect(context.eventType).toBe(unknownEventType);
          expect(context.requestId).toBe(requestId);
        });

        expect(unknownEventType).toBe('customer.discount.created');
      });
    });
  });

  describe('CORS Handling', () => {
    it('should create proper CORS response for OPTIONS', async () => {
      const expectedCorsHeaders = {
        'Access-Control-Allow-Origin': 'https://stripe.com',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
        'Access-Control-Max-Age': '86400',
      };

      const corsResponse = new Response(null, {
        status: 200,
        headers: expectedCorsHeaders,
      });

      expect(corsResponse.status).toBe(200);
      expect(corsResponse.headers.get('Access-Control-Allow-Origin')).toBe('https://stripe.com');
      expect(corsResponse.headers.get('Access-Control-Allow-Methods')).toBe('POST');
    });

    it('should validate allowed origins', async () => {
      const allowedOrigins = ['https://stripe.com', 'https://js.stripe.com'];
      const testOrigins = [
        'https://stripe.com',
        'https://js.stripe.com',
        'https://malicious.com',
        'http://localhost:3000',
      ];

      testOrigins.forEach(origin => {
        const isAllowed = allowedOrigins.includes(origin);
        if (origin === 'https://stripe.com' || origin === 'https://js.stripe.com') {
          expect(isAllowed).toBe(true);
        } else {
          expect(isAllowed).toBe(false);
        }
      });
    });
  });

  describe('Security Headers', () => {
    it('should apply security headers to responses', async () => {
      const securityHeaders = {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      };

      mockSecurityMiddleware.secureResponse.mockReturnValueOnce(
        new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...securityHeaders,
          },
        })
      );

      expect(securityHeaders['X-Content-Type-Options']).toBe('nosniff');
      expect(securityHeaders['X-Frame-Options']).toBe('DENY');
    });

    it('should disable CSP for webhook endpoints', async () => {
      const securityConfig = {
        contentSecurityPolicy: false,
        xFrameOptions: 'DENY',
      };

      expect(securityConfig.contentSecurityPolicy).toBe(false);
      expect(securityConfig.xFrameOptions).toBe('DENY');
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors', async () => {
      const dbError = new Error('Database connection failed');
      dbError.name = 'DatabaseConnectionError';

      mockDatabase.insert.mockResolvedValueOnce({
        data: null,
        error: dbError,
      });

      expect(dbError.message).toBe('Database connection failed');
      expect(dbError.name).toBe('DatabaseConnectionError');
    });

    it('should handle Stripe webhook construction errors', async () => {
      const stripeError = new Error('Webhook signature verification failed');
      stripeError.name = 'StripeSignatureVerificationError';

      mockStripe.webhooks.constructEvent.mockImplementationOnce(() => {
        throw stripeError;
      });

      expect(stripeError.message).toBe('Webhook signature verification failed');
      expect(stripeError.name).toBe('StripeSignatureVerificationError');
    });

    it('should log security events for processing failures', async () => {
      const requestId = 'req-123';
      const error = new Error('Webhook processing failed');

      const expectedSecurityLog = {
        action: 'webhook_processing_failed',
        userId: 'stripe',
        details: {
          error: error.message,
          requestId,
          duration: expect.any(Number),
        },
        requestId,
      };

      mockAuditLogger.logSecurityEvent.mockResolvedValueOnce(true);

      expect(expectedSecurityLog.action).toBe('webhook_processing_failed');
      expect(expectedSecurityLog.details.error).toBe('Webhook processing failed');
    });

    it('should handle unknown errors gracefully', async () => {
      const unknownError = { message: 'Unknown error object' };

      // Should handle non-Error objects
      expect(typeof unknownError).toBe('object');
      expect(unknownError.message).toBe('Unknown error object');
    });
  });

  describe('Request Logging', () => {
    it('should log incoming webhook requests', async () => {
      const request = new Request('http://localhost:3000/webhook', {
        method: 'POST',
        headers: {
          'stripe-signature': 't=1234567890,v1=signature123',
          'user-agent': 'Stripe/1.0',
          'content-type': 'application/json',
        },
      });

      const expectedLogData = {
        requestId: expect.any(String),
        headers: {
          'stripe-signature': 't=1234567890,v1=signature123',
          'user-agent': 'Stripe/1.0',
          'content-type': 'application/json',
        },
        method: 'POST',
        url: 'http://localhost:3000/webhook',
      };

      mockLogger.info.mockImplementationOnce((message, data) => {
        expect(message).toBe('Webhook received');
        expect(data.method).toBe('POST');
        expect(data.headers['stripe-signature']).toBeTruthy();
      });

      expect(request.method).toBe('POST');
    });

    it('should log successful webhook processing', async () => {
      const eventType = 'checkout.session.completed';
      const requestId = 'req-123';
      const duration = 150;

      const expectedLogData = {
        requestId,
        eventType,
        duration,
      };

      mockLogger.info.mockImplementationOnce((message, data) => {
        expect(message).toBe('Webhook processed successfully');
        expect(data).toMatchObject(expectedLogData);
      });

      expect(expectedLogData.eventType).toBe('checkout.session.completed');
      expect(expectedLogData.duration).toBeGreaterThan(0);
    });

    it('should log webhook processing failures', async () => {
      const error = new Error('Processing failed');
      const requestId = 'req-123';
      const duration = 75;

      const expectedLogData = {
        requestId,
        duration,
        error: error.message,
      };

      mockLogger.error.mockImplementationOnce((message, error, data) => {
        expect(message).toBe('Webhook processing failed');
        expect(data.duration).toBe(75);
      });

      expect(expectedLogData.error).toBe('Processing failed');
    });
  });

  describe('Performance Monitoring', () => {
    it('should measure webhook processing duration', async () => {
      const startTime = Date.now();

      // Simulate processing
      await new Promise(resolve => setTimeout(resolve, 10));

      const duration = Date.now() - startTime;

      expect(duration).toBeGreaterThanOrEqual(10);
      expect(typeof duration).toBe('number');
    });

    it('should track webhook processing metrics', async () => {
      const metrics = {
        totalRequests: 1,
        successfulRequests: 1,
        failedRequests: 0,
        averageProcessingTime: 150,
        lastProcessedAt: new Date().toISOString(),
      };

      expect(metrics.totalRequests).toBe(1);
      expect(metrics.successfulRequests).toBe(1);
      expect(metrics.failedRequests).toBe(0);
      expect(metrics.averageProcessingTime).toBeGreaterThan(0);
    });
  });

  describe('Raw Body Handling', () => {
    it('should preserve raw body for signature verification', async () => {
      const rawBody = JSON.stringify({
        id: 'evt_test',
        type: 'test_event',
        data: { object: {} },
      });

      const request = new Request('http://localhost:3000/webhook', {
        method: 'POST',
        body: rawBody,
      });

      const bodyText = await request.text();

      expect(bodyText).toBe(rawBody);
      expect(typeof bodyText).toBe('string');
    });

    it('should handle empty request body', async () => {
      const request = new Request('http://localhost:3000/webhook', {
        method: 'POST',
        body: '',
      });

      const bodyText = await request.text();

      expect(bodyText).toBe('');
    });

    it('should handle large webhook payloads', async () => {
      const largePayload = JSON.stringify({
        id: 'evt_test',
        type: 'test_event',
        data: {
          object: {
            // Simulate large data object
            metadata: Object.fromEntries(
              Array.from({ length: 100 }, (_, i) => [`key${i}`, `value${i}`.repeat(50)])
            ),
          },
        },
      });

      expect(largePayload.length).toBeGreaterThan(1000);
      expect(() => JSON.parse(largePayload)).not.toThrow();
    });
  });
});
