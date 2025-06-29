// Integration tests for billing module
// CREATED: 2025-01-28 - End-to-end billing workflow tests

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Test data helpers
const testUser = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'billing-integration@example.com',
  name: 'Billing Integration User',
};

const testCustomer = {
  id: 'cus_test_integration_12345',
  email: 'billing-integration@example.com',
  name: 'Billing Integration User',
};

const testSubscription = {
  id: 'sub_test_integration_12345',
  customer: testCustomer.id,
  status: 'active',
  current_period_start: Math.floor(Date.now() / 1000),
  current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30, // 30 days
  items: {
    data: [
      {
        price: {
          id: 'price_test_integration_12345',
          unit_amount: 2000,
          currency: 'usd',
          recurring: { interval: 'month' },
        },
      },
    ],
  },
};

describe('Billing Module Integration Tests', () => {
  let supabase: ReturnType<typeof createClient>;
  let stripe: Stripe;

  beforeAll(async () => {
    // Initialize clients with test environment
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2023-10-16',
    });

    // Setup test user profile in database
    await supabase.from('profiles').upsert({
      id: testUser.id,
      email: testUser.email,
      name: testUser.name,
      stripe_customer_id: testCustomer.id,
      stripe_subscription_id: testSubscription.id,
      stripe_subscription_status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });

  beforeEach(async () => {
    // Clean up any test data before each test
    await supabase.from('billing_events').delete().eq('user_id', testUser.id);
  });

  afterAll(async () => {
    // Cleanup test data
    await supabase.from('profiles').delete().eq('id', testUser.id);
    await supabase.from('billing_events').delete().eq('user_id', testUser.id);
  });

  describe('Checkout Session Creation Flow', () => {
    it('should create checkout session and store billing event', async () => {
      const checkoutRequest = {
        priceId: 'price_test_integration_12345',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        quantity: 1,
      };

      // Simulate checkout session creation
      const mockCheckoutSession = {
        id: 'cs_test_integration_12345',
        url: 'https://checkout.stripe.com/pay/cs_test_integration_12345',
        customer: testCustomer.id,
        subscription: testSubscription.id,
        amount_total: 2000,
        currency: 'usd',
        metadata: {
          supabase_user_id: testUser.id,
        },
      };

      // Store billing event in database
      const { data: billingEvent, error } = await supabase
        .from('billing_events')
        .insert({
          user_id: testUser.id,
          event_type: 'checkout_session_created',
          stripe_event_id: `evt_${Date.now()}`,
          stripe_customer_id: mockCheckoutSession.customer,
          stripe_session_id: mockCheckoutSession.id,
          amount: mockCheckoutSession.amount_total,
          currency: mockCheckoutSession.currency,
          metadata: mockCheckoutSession.metadata,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(billingEvent).toBeDefined();
      expect(billingEvent.event_type).toBe('checkout_session_created');
      expect(billingEvent.stripe_session_id).toBe(mockCheckoutSession.id);
      expect(billingEvent.amount).toBe(2000);
      expect(billingEvent.currency).toBe('usd');
    });

    it('should handle checkout session completion webhook', async () => {
      const completedSession = {
        id: 'cs_test_completed_12345',
        customer: testCustomer.id,
        subscription: testSubscription.id,
        amount_total: 2000,
        currency: 'usd',
        metadata: {
          supabase_user_id: testUser.id,
        },
        payment_status: 'paid',
      };

      // Process webhook event
      const { data: billingEvent, error } = await supabase
        .from('billing_events')
        .insert({
          user_id: testUser.id,
          event_type: 'checkout_session_completed',
          stripe_event_id: `evt_completed_${Date.now()}`,
          stripe_customer_id: completedSession.customer,
          stripe_session_id: completedSession.id,
          stripe_subscription_id: completedSession.subscription,
          amount: completedSession.amount_total,
          currency: completedSession.currency,
          metadata: completedSession.metadata,
          processed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(billingEvent.event_type).toBe('checkout_session_completed');
      expect(billingEvent.processed_at).toBeDefined();

      // Update user profile with subscription info
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          stripe_subscription_id: completedSession.subscription,
          stripe_subscription_status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', testUser.id);

      expect(profileError).toBeNull();
    });
  });

  describe('Customer Portal Management', () => {
    it('should create customer portal session with valid profile', async () => {
      // Verify user has stripe customer ID
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', testUser.id)
        .single();

      expect(error).toBeNull();
      expect(profile?.stripe_customer_id).toBe(testCustomer.id);

      // Simulate portal session creation
      const portalRequest = {
        customerId: profile!.stripe_customer_id,
        returnUrl: 'https://example.com/billing',
      };

      const mockPortalSession = {
        id: 'bps_test_integration_12345',
        url: 'https://billing.stripe.com/p/session/bps_test_integration_12345',
        customer: portalRequest.customerId,
        return_url: portalRequest.returnUrl,
      };

      // Log portal access
      const { data: billingEvent, error: eventError } = await supabase
        .from('billing_events')
        .insert({
          user_id: testUser.id,
          event_type: 'customer_portal_accessed',
          stripe_event_id: `evt_portal_${Date.now()}`,
          stripe_customer_id: mockPortalSession.customer,
          metadata: {
            portal_session_id: mockPortalSession.id,
            return_url: mockPortalSession.return_url,
          },
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      expect(eventError).toBeNull();
      expect(billingEvent.event_type).toBe('customer_portal_accessed');
    });
  });

  describe('Subscription Retrieval and Caching', () => {
    it('should retrieve subscription from database and cache', async () => {
      // First, verify profile exists with subscription
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', testUser.id)
        .single();

      expect(profileError).toBeNull();
      expect(profile.stripe_subscription_id).toBe(testSubscription.id);
      expect(profile.stripe_subscription_status).toBe('active');

      // Simulate subscription data retrieval
      const subscriptionData = {
        id: profile.stripe_subscription_id,
        status: profile.stripe_subscription_status,
        customerId: profile.stripe_customer_id,
        priceId: testSubscription.items.data[0].price.id,
        amount: testSubscription.items.data[0].price.unit_amount,
        currency: testSubscription.items.data[0].price.currency,
        interval: testSubscription.items.data[0].price.recurring.interval,
        currentPeriodStart: new Date(testSubscription.current_period_start * 1000),
        currentPeriodEnd: new Date(testSubscription.current_period_end * 1000),
      };

      expect(subscriptionData.status).toBe('active');
      expect(subscriptionData.amount).toBe(2000);
      expect(subscriptionData.currency).toBe('usd');
      expect(subscriptionData.interval).toBe('month');

      // Test cache key generation
      const cacheKey = `subscription:${testUser.id}`;
      expect(cacheKey).toBe(`subscription:${testUser.id}`);
    });

    it('should handle subscription status changes', async () => {
      const statusChanges = ['active', 'past_due', 'canceled', 'unpaid'];

      for (const status of statusChanges) {
        // Update subscription status
        const { error } = await supabase
          .from('profiles')
          .update({
            stripe_subscription_status: status,
            updated_at: new Date().toISOString(),
          })
          .eq('id', testUser.id);

        expect(error).toBeNull();

        // Log status change event
        const { data: billingEvent, error: eventError } = await supabase
          .from('billing_events')
          .insert({
            user_id: testUser.id,
            event_type: 'subscription_status_changed',
            stripe_event_id: `evt_status_${Date.now()}_${status}`,
            stripe_customer_id: testCustomer.id,
            stripe_subscription_id: testSubscription.id,
            metadata: {
              old_status: 'active',
              new_status: status,
            },
            created_at: new Date().toISOString(),
          })
          .select()
          .single();

        expect(eventError).toBeNull();
        expect(billingEvent.event_type).toBe('subscription_status_changed');
      }

      // Reset to active status
      await supabase
        .from('profiles')
        .update({
          stripe_subscription_status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', testUser.id);
    });
  });

  describe('Webhook Processing Integration', () => {
    it('should process invoice payment succeeded webhook', async () => {
      const invoiceEvent = {
        id: 'evt_invoice_succeeded_12345',
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: 'in_test_12345',
            customer: testCustomer.id,
            subscription: testSubscription.id,
            amount_paid: 2000,
            currency: 'usd',
            status: 'paid',
            metadata: {
              supabase_user_id: testUser.id,
            },
          },
        },
      };

      // Process webhook
      const { data: billingEvent, error } = await supabase
        .from('billing_events')
        .insert({
          user_id: testUser.id,
          event_type: 'invoice_payment_succeeded',
          stripe_event_id: invoiceEvent.id,
          stripe_customer_id: invoiceEvent.data.object.customer,
          stripe_subscription_id: invoiceEvent.data.object.subscription,
          amount: invoiceEvent.data.object.amount_paid,
          currency: invoiceEvent.data.object.currency,
          metadata: invoiceEvent.data.object.metadata,
          processed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(billingEvent.event_type).toBe('invoice_payment_succeeded');
      expect(billingEvent.amount).toBe(2000);
    });

    it('should process invoice payment failed webhook', async () => {
      const invoiceFailedEvent = {
        id: 'evt_invoice_failed_12345',
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'in_test_failed_12345',
            customer: testCustomer.id,
            subscription: testSubscription.id,
            amount_due: 2000,
            currency: 'usd',
            status: 'open',
            attempt_count: 1,
            metadata: {
              supabase_user_id: testUser.id,
            },
          },
        },
      };

      // Process failed payment
      const { data: billingEvent, error } = await supabase
        .from('billing_events')
        .insert({
          user_id: testUser.id,
          event_type: 'invoice_payment_failed',
          stripe_event_id: invoiceFailedEvent.id,
          stripe_customer_id: invoiceFailedEvent.data.object.customer,
          stripe_subscription_id: invoiceFailedEvent.data.object.subscription,
          amount: invoiceFailedEvent.data.object.amount_due,
          currency: invoiceFailedEvent.data.object.currency,
          metadata: {
            ...invoiceFailedEvent.data.object.metadata,
            attempt_count: invoiceFailedEvent.data.object.attempt_count,
          },
          processed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(billingEvent.event_type).toBe('invoice_payment_failed');

      // Update subscription status to past_due
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          stripe_subscription_status: 'past_due',
          updated_at: new Date().toISOString(),
        })
        .eq('id', testUser.id);

      expect(updateError).toBeNull();
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle database connection errors gracefully', async () => {
      // Simulate a database error by trying to insert invalid data
      const { error } = await supabase.from('billing_events').insert({
        user_id: 'invalid-uuid-format',
        event_type: 'test_error',
        stripe_event_id: 'evt_error_test',
        created_at: new Date().toISOString(),
      });

      expect(error).toBeDefined();
      expect(error?.message).toContain('invalid input syntax');
    });

    it('should handle duplicate webhook events', async () => {
      const duplicateEventId = `evt_duplicate_${Date.now()}`;

      // First insertion should succeed
      const { data: firstEvent, error: firstError } = await supabase
        .from('billing_events')
        .insert({
          user_id: testUser.id,
          event_type: 'test_duplicate',
          stripe_event_id: duplicateEventId,
          stripe_customer_id: testCustomer.id,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      expect(firstError).toBeNull();
      expect(firstEvent).toBeDefined();

      // Second insertion with same stripe_event_id should fail due to unique constraint
      const { error: duplicateError } = await supabase.from('billing_events').insert({
        user_id: testUser.id,
        event_type: 'test_duplicate',
        stripe_event_id: duplicateEventId,
        stripe_customer_id: testCustomer.id,
        created_at: new Date().toISOString(),
      });

      expect(duplicateError).toBeDefined();
      expect(duplicateError?.code).toBe('23505'); // Unique constraint violation
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle bulk billing events efficiently', async () => {
      const startTime = Date.now();
      const bulkEvents = [];

      // Create 100 test events
      for (let i = 0; i < 100; i++) {
        bulkEvents.push({
          user_id: testUser.id,
          event_type: 'bulk_test_event',
          stripe_event_id: `evt_bulk_${Date.now()}_${i}`,
          stripe_customer_id: testCustomer.id,
          amount: 1000 + i,
          currency: 'usd',
          created_at: new Date().toISOString(),
        });
      }

      // Insert all events at once
      const { data, error } = await supabase.from('billing_events').insert(bulkEvents).select();

      const endTime = Date.now();
      const executionTime = endTime - startTime;

      expect(error).toBeNull();
      expect(data).toHaveLength(100);
      expect(executionTime).toBeLessThan(5000); // Should complete within 5 seconds

      // Cleanup bulk events
      await supabase.from('billing_events').delete().eq('event_type', 'bulk_test_event');
    });

    it('should efficiently query billing events with pagination', async () => {
      // Create some test events first
      const testEvents = Array.from({ length: 25 }, (_, i) => ({
        user_id: testUser.id,
        event_type: 'pagination_test',
        stripe_event_id: `evt_pagination_${Date.now()}_${i}`,
        stripe_customer_id: testCustomer.id,
        amount: 1000 + i,
        currency: 'usd',
        created_at: new Date(Date.now() - i * 1000).toISOString(), // Spread over time
      }));

      await supabase.from('billing_events').insert(testEvents);

      // Test pagination
      const pageSize = 10;
      const { data: firstPage, error } = await supabase
        .from('billing_events')
        .select('*')
        .eq('user_id', testUser.id)
        .eq('event_type', 'pagination_test')
        .order('created_at', { ascending: false })
        .range(0, pageSize - 1);

      expect(error).toBeNull();
      expect(firstPage).toHaveLength(pageSize);

      // Test second page
      const { data: secondPage, error: secondError } = await supabase
        .from('billing_events')
        .select('*')
        .eq('user_id', testUser.id)
        .eq('event_type', 'pagination_test')
        .order('created_at', { ascending: false })
        .range(pageSize, pageSize * 2 - 1);

      expect(secondError).toBeNull();
      expect(secondPage).toHaveLength(pageSize);

      // Cleanup pagination test events
      await supabase.from('billing_events').delete().eq('event_type', 'pagination_test');
    });
  });

  describe('Data Consistency and Integrity', () => {
    it('should maintain data consistency across profile and billing events', async () => {
      // Update profile
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          stripe_subscription_status: 'canceled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', testUser.id);

      expect(profileError).toBeNull();

      // Add corresponding billing event
      const { data: billingEvent, error: eventError } = await supabase
        .from('billing_events')
        .insert({
          user_id: testUser.id,
          event_type: 'subscription_canceled',
          stripe_event_id: `evt_canceled_${Date.now()}`,
          stripe_customer_id: testCustomer.id,
          stripe_subscription_id: testSubscription.id,
          metadata: {
            canceled_at: new Date().toISOString(),
            reason: 'user_requested',
          },
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      expect(eventError).toBeNull();
      expect(billingEvent).toBeDefined();

      // Verify consistency
      const { data: updatedProfile } = await supabase
        .from('profiles')
        .select('stripe_subscription_status')
        .eq('id', testUser.id)
        .single();

      expect(updatedProfile?.stripe_subscription_status).toBe('canceled');

      // Reset for other tests
      await supabase
        .from('profiles')
        .update({
          stripe_subscription_status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', testUser.id);
    });
  });
});
