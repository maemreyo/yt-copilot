// UPDATED: 2025-06-24 - Enhanced webhook handler with Layer 1 & 2 utilities

import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// Import Layer 1 utilities
import { createAppError, ErrorType } from '@/shared-errors';
import { Logger } from '@/logging';
import { SecurityService } from '@/security';
import { ValidationService } from '@/validation';

// Import Layer 2 utilities
import { DatabaseService } from '@/database';
import { AuditLogger } from '@/audit-logging';

/**
 * Enhanced Stripe Webhook Handler Service
 * Uses comprehensive Layer 1 & 2 utilities for robust webhook processing
 */
class EnhancedStripeWebhookService {
  private stripe: Stripe;
  private supabase: any;
  private logger: Logger;
  private security: SecurityService;
  private validator: ValidationService;
  private database: DatabaseService;
  private auditLogger: AuditLogger;

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
      service: 'stripe-webhooks',
      level: 'info',
      enablePerformanceTracking: true,
    });

    this.security = new SecurityService();
    this.validator = new ValidationService();
    this.database = new DatabaseService();
    this.auditLogger = new AuditLogger();
  }

  /**
   * Process webhook request
   */
  async processWebhook(req: Request): Promise<Response> {
    const startTime = Date.now();
    const requestId = crypto.randomUUID();

    try {
      // Log incoming webhook
      this.logger.info('Webhook received', {
        requestId,
        headers: Object.fromEntries(req.headers.entries()),
        method: req.method,
        url: req.url,
      });

      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        return this.createCorsResponse();
      }

      // Validate HTTP method
      if (req.method !== 'POST') {
        throw createAppError(
          ErrorType.VALIDATION_ERROR,
          'Method not allowed',
          { method: req.method },
        );
      }

      // Get and validate signature
      const signature = req.headers.get('stripe-signature');
      if (!signature) {
        throw createAppError(
          ErrorType.VALIDATION_ERROR,
          'Missing Stripe signature',
          { headers: Object.fromEntries(req.headers.entries()) },
        );
      }

      // Get raw body
      const body = await req.text();
      if (!body) {
        throw createAppError(
          ErrorType.VALIDATION_ERROR,
          'Empty request body',
        );
      }

      // Verify webhook signature
      const event = await this.verifyWebhookSignature(body, signature);

      // Log verified event
      this.logger.info('Webhook signature verified', {
        requestId,
        eventId: event.id,
        eventType: event.type,
        created: event.created,
      });

      // Process the event
      const result = await this.processStripeEvent(event, requestId);

      // Log successful processing
      const processingTime = Date.now() - startTime;
      this.logger.info('Webhook processed successfully', {
        requestId,
        eventId: event.id,
        eventType: event.type,
        processingTime,
        result,
      });

      // Audit log successful webhook processing
      await this.auditLogger.log({
        userId: null, // Webhook is system-level
        action: 'webhook_processed',
        resource: 'stripe_webhook',
        resourceId: event.id,
        details: {
          eventType: event.type,
          processingTime,
          result,
        },
        metadata: {
          requestId,
          source: 'stripe',
          success: true,
        },
      });

      // Return success response
      return this.createSuccessResponse({
        received: true,
        eventId: event.id,
        eventType: event.type,
        processingTime,
      });
    } catch (error: any) {
      // Log error with comprehensive details
      const processingTime = Date.now() - startTime;
      this.logger.error('Webhook processing failed', {
        requestId,
        error: error.message,
        stack: error.stack,
        processingTime,
        headers: Object.fromEntries(req.headers.entries()),
      });

      // Audit log failed webhook processing
      await this.auditLogger.log({
        userId: null,
        action: 'webhook_failed',
        resource: 'stripe_webhook',
        resourceId: null,
        details: {
          error: error.message,
          processingTime,
        },
        metadata: {
          requestId,
          success: false,
          errorType: error.type || 'unknown',
        },
      });

      // Return error response
      return this.createErrorResponse(error, requestId);
    }
  }

  /**
   * Verify webhook signature with comprehensive validation
   */
  private async verifyWebhookSignature(
    body: string,
    signature: string,
  ): Promise<Stripe.Event> {
    try {
      const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
      if (!webhookSecret) {
        throw createAppError(
          ErrorType.CONFIGURATION_ERROR,
          'Stripe webhook secret not configured',
        );
      }

      const event = this.stripe.webhooks.constructEvent(
        body,
        signature,
        webhookSecret,
      );

      // Additional validation
      if (!event.id || !event.type || !event.data) {
        throw createAppError(
          ErrorType.VALIDATION_ERROR,
          'Invalid webhook event structure',
          { eventId: event.id, eventType: event.type },
        );
      }

      // Check event age (prevent replay attacks)
      const eventAge = Date.now() - (event.created * 1000);
      const maxEventAge = 5 * 60 * 1000; // 5 minutes

      if (eventAge > maxEventAge) {
        throw createAppError(
          ErrorType.VALIDATION_ERROR,
          'Webhook event too old',
          { eventAge, maxEventAge, eventId: event.id },
        );
      }

      return event;
    } catch (error: any) {
      if (error.type === 'StripeSignatureVerificationError') {
        throw createAppError(
          ErrorType.AUTHENTICATION_ERROR,
          'Webhook signature verification failed',
          { originalError: error.message },
        );
      }
      throw error;
    }
  }

  /**
   * Process different Stripe event types
   */
  private async processStripeEvent(
    event: Stripe.Event,
    requestId: string,
  ): Promise<any> {
    this.logger.info('Processing Stripe event', {
      requestId,
      eventId: event.id,
      eventType: event.type,
    });

    switch (event.type) {
      case 'checkout.session.completed':
        return await this.handleCheckoutSessionCompleted(event, requestId);

      case 'customer.subscription.created':
        return await this.handleSubscriptionCreated(event, requestId);

      case 'customer.subscription.updated':
        return await this.handleSubscriptionUpdated(event, requestId);

      case 'customer.subscription.deleted':
        return await this.handleSubscriptionDeleted(event, requestId);

      case 'invoice.payment_succeeded':
        return await this.handlePaymentSucceeded(event, requestId);

      case 'invoice.payment_failed':
        return await this.handlePaymentFailed(event, requestId);

      default:
        this.logger.info('Unhandled event type', {
          requestId,
          eventType: event.type,
          eventId: event.id,
        });
        return { handled: false, reason: 'Unhandled event type' };
    }
  }

  /**
   * Handle checkout session completed
   */
  private async handleCheckoutSessionCompleted(
    event: Stripe.Event,
    requestId: string,
  ) {
    const session = event.data.object as Stripe.Checkout.Session;

    this.logger.info('Processing checkout session completed', {
      requestId,
      sessionId: session.id,
      customerId: session.customer,
      subscriptionId: session.subscription,
    });

    // Get subscription details
    if (!session.subscription) {
      throw createAppError(
        ErrorType.VALIDATION_ERROR,
        'No subscription found in checkout session',
        { sessionId: session.id },
      );
    }

    const subscription = await this.stripe.subscriptions.retrieve(
      session.subscription as string,
    );

    // Extract user ID from metadata
    const supabaseUserId = subscription.metadata?.supabase_user_id ||
      subscription.metadata?.supabase_id;

    if (!supabaseUserId) {
      throw createAppError(
        ErrorType.VALIDATION_ERROR,
        'No Supabase user ID found in subscription metadata',
        { subscriptionId: subscription.id },
      );
    }

    // Update user profile
    const { error } = await this.supabase
      .from('profiles')
      .update({
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        stripe_subscription_status: subscription.status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', supabaseUserId);

    if (error) {
      throw createAppError(
        ErrorType.DATABASE_ERROR,
        'Failed to update user profile after checkout',
        { error: error.message, userId: supabaseUserId },
      );
    }

    // Audit log subscription creation
    await this.auditLogger.log({
      userId: supabaseUserId,
      action: 'subscription_created',
      resource: 'stripe_subscription',
      resourceId: subscription.id,
      details: {
        customerId: session.customer,
        subscriptionStatus: subscription.status,
        checkoutSessionId: session.id,
      },
      metadata: {
        requestId,
        source: 'stripe_webhook',
        eventType: 'checkout.session.completed',
      },
    });

    return {
      handled: true,
      action: 'profile_updated',
      userId: supabaseUserId,
      subscriptionId: subscription.id,
      status: subscription.status,
    };
  }

  /**
   * Handle subscription created
   */
  private async handleSubscriptionCreated(
    event: Stripe.Event,
    requestId: string,
  ) {
    const subscription = event.data.object as Stripe.Subscription;

    this.logger.info('Processing subscription created', {
      requestId,
      subscriptionId: subscription.id,
      customerId: subscription.customer,
      status: subscription.status,
    });

    const supabaseUserId = subscription.metadata?.supabase_user_id ||
      subscription.metadata?.supabase_id;

    if (!supabaseUserId) {
      this.logger.warning('No Supabase user ID in subscription metadata', {
        requestId,
        subscriptionId: subscription.id,
      });
      return { handled: false, reason: 'No user ID in metadata' };
    }

    // Update profile
    const { error } = await this.supabase
      .from('profiles')
      .update({
        stripe_subscription_id: subscription.id,
        stripe_subscription_status: subscription.status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', supabaseUserId);

    if (error) {
      throw createAppError(
        ErrorType.DATABASE_ERROR,
        'Failed to update subscription status',
        { error: error.message, userId: supabaseUserId },
      );
    }

    return {
      handled: true,
      action: 'subscription_created',
      userId: supabaseUserId,
      subscriptionId: subscription.id,
    };
  }

  /**
   * Handle subscription updated
   */
  private async handleSubscriptionUpdated(
    event: Stripe.Event,
    requestId: string,
  ) {
    const subscription = event.data.object as Stripe.Subscription;

    this.logger.info('Processing subscription updated', {
      requestId,
      subscriptionId: subscription.id,
      status: subscription.status,
    });

    // Update all profiles with this subscription
    const { error } = await this.supabase
      .from('profiles')
      .update({
        stripe_subscription_status: subscription.status,
        updated_at: new Date().toISOString(),
      })
      .eq('stripe_subscription_id', subscription.id);

    if (error) {
      throw createAppError(
        ErrorType.DATABASE_ERROR,
        'Failed to update subscription status',
        { error: error.message, subscriptionId: subscription.id },
      );
    }

    return {
      handled: true,
      action: 'subscription_updated',
      subscriptionId: subscription.id,
      status: subscription.status,
    };
  }

  /**
   * Handle subscription deleted
   */
  private async handleSubscriptionDeleted(
    event: Stripe.Event,
    requestId: string,
  ) {
    const subscription = event.data.object as Stripe.Subscription;

    this.logger.info('Processing subscription deleted', {
      requestId,
      subscriptionId: subscription.id,
    });

    // Update profile to remove subscription
    const { error } = await this.supabase
      .from('profiles')
      .update({
        stripe_subscription_id: null,
        stripe_subscription_status: 'canceled',
        updated_at: new Date().toISOString(),
      })
      .eq('stripe_subscription_id', subscription.id);

    if (error) {
      throw createAppError(
        ErrorType.DATABASE_ERROR,
        'Failed to update profile after subscription deletion',
        { error: error.message, subscriptionId: subscription.id },
      );
    }

    return {
      handled: true,
      action: 'subscription_deleted',
      subscriptionId: subscription.id,
    };
  }

  /**
   * Handle payment succeeded
   */
  private async handlePaymentSucceeded(event: Stripe.Event, requestId: string) {
    const invoice = event.data.object as Stripe.Invoice;

    this.logger.info('Processing payment succeeded', {
      requestId,
      invoiceId: invoice.id,
      subscriptionId: invoice.subscription,
      amount: invoice.amount_paid,
    });

    // Could add logic to update payment history, send notifications, etc.
    return {
      handled: true,
      action: 'payment_succeeded',
      invoiceId: invoice.id,
      amount: invoice.amount_paid,
    };
  }

  /**
   * Handle payment failed
   */
  private async handlePaymentFailed(event: Stripe.Event, requestId: string) {
    const invoice = event.data.object as Stripe.Invoice;

    this.logger.error('Payment failed', {
      requestId,
      invoiceId: invoice.id,
      subscriptionId: invoice.subscription,
      attemptCount: invoice.attempt_count,
    });

    // Could add logic to notify user, pause service, etc.
    return {
      handled: true,
      action: 'payment_failed',
      invoiceId: invoice.id,
      attemptCount: invoice.attempt_count,
    };
  }

  /**
   * Create CORS response
   */
  private createCorsResponse(): Response {
    return new Response(null, {
      status: 200,
      headers: this.security.getCorsHeaders(),
    });
  }

  /**
   * Create success response
   */
  private createSuccessResponse(data: any): Response {
    return new Response(
      JSON.stringify(data),
      {
        status: 200,
        headers: {
          ...this.security.getCorsHeaders(),
          ...this.security.getSecurityHeaders(),
          'Content-Type': 'application/json',
        },
      },
    );
  }

  /**
   * Create error response
   */
  private createErrorResponse(error: any, requestId: string): Response {
    const isAppError = error.type && error.code;

    const response = {
      error: {
        code: isAppError ? error.code : 'WEBHOOK_ERROR',
        message: isAppError ? error.message : 'Webhook processing failed',
        details: isAppError ? error.details : { originalError: error.message },
      },
      timestamp: new Date().toISOString(),
      requestId,
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
        },
      },
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
      default:
        return 500;
    }
  }
}

// Initialize service and serve
const webhookService = new EnhancedStripeWebhookService();

serve(async (req: Request) => {
  return await webhookService.processWebhook(req);
});
