import { serve } from 'std/http/server.ts';
import Stripe from 'stripe';

import { createCorsErrorResponse } from '@/cors';
import { Logger, LogLevel } from '@/logging';
import { SecurityMiddleware } from '@/security';
import { createAppError, ErrorType, handleUnknownError } from '@/shared-errors';

import { AuditLogger } from '@/audit-logging';
import database, { QueryHelper } from '@/database';
import { denoEnv } from '@/shared-deno-env';

/**
 * Stripe Webhook Handler Service
 * Uses comprehensive Layer 1 & 2 utilities for robust webhook processing
 */
class StripeWebhookService {
  private stripe: Stripe;
  private logger: Logger;
  private security: SecurityMiddleware;
  private database: QueryHelper;
  private auditLogger: AuditLogger;

  constructor() {
    // Initialize services
    this.stripe = new Stripe(denoEnv.get('STRIPE_SECRET_KEY') || '', {
      apiVersion: '2023-10-16',
    });

    this.logger = new Logger({
      level: LogLevel.INFO,
    }).child({ service: 'stripe-webhooks' });

    // Initialize security middleware with proper config
    this.security = new SecurityMiddleware(
      {
        // CORS config
        origin: ['https://stripe.com', 'https://js.stripe.com'],
        methods: ['POST'],
        allowedHeaders: ['Content-Type', 'Stripe-Signature'],
      },
      {
        // Security headers config
        contentSecurityPolicy: false, // Stripe webhook doesn't need CSP
        xFrameOptions: 'DENY',
      }
    );

    this.database = database.createQueryHelper(database.getServiceClient());
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
        throw createAppError(ErrorType.VALIDATION_ERROR, 'Method not allowed', {
          method: req.method,
        });
      }

      // Get and validate signature
      const signature = req.headers.get('stripe-signature');
      if (!signature) {
        throw createAppError(ErrorType.VALIDATION_ERROR, 'Missing Stripe signature');
      }

      // Get raw body for signature verification
      const rawBody = await req.text();

      // Verify webhook signature
      let event: Stripe.Event;
      try {
        event = this.stripe.webhooks.constructEvent(
          rawBody,
          signature,
          denoEnv.get('STRIPE_WEBHOOK_SECRET') || ''
        );
      } catch (err: unknown) {
        const appError = handleUnknownError(err, requestId);
        this.logger.error('Webhook signature verification failed', appError);
        throw appError;
      }

      // Process the webhook event
      const result = await this.handleWebhookEvent(event, requestId);

      // Log successful processing
      this.logger.info('Webhook processed successfully', {
        requestId,
        eventType: event.type,
        duration: Date.now() - startTime,
      });

      // Create response with security headers
      const response = new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

      return this.security.secureResponse(req, response);
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const appError = handleUnknownError(error, requestId);

      this.logger.error('Webhook processing failed', appError, {
        duration,
      });

      // Log audit event for webhook failure
      await this.auditLogger.logSecurityEvent(
        'webhook_processing_failed',
        'stripe',
        {
          error: appError.message,
          requestId,
          duration,
        },
        requestId
      );

      // Return error response with security headers
      const errorResponse = createCorsErrorResponse(
        appError.message,
        appError.status,
        requestId,
        appError.details
      );

      return this.security.secureResponse(req, errorResponse);
    }
  }

  /**
   * Handle specific webhook events
   */
  private async handleWebhookEvent(event: Stripe.Event, requestId: string): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, requestId);
        break;

      case 'customer.subscription.created':
        await this.handleSubscriptionCreated(event.data.object as Stripe.Subscription, requestId);
        break;

      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription, requestId);
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription, requestId);
        break;

      case 'invoice.payment_succeeded':
        await this.handlePaymentSucceeded(event.data.object as Stripe.Invoice, requestId);
        break;

      case 'invoice.payment_failed':
        await this.handlePaymentFailed(event.data.object as Stripe.Invoice, requestId);
        break;

      default:
        this.logger.info('Unhandled webhook event type', {
          eventType: event.type,
          requestId,
        });
    }
  }

  /**
   * Handle checkout session completed
   */
  private async handleCheckoutCompleted(
    session: Stripe.Checkout.Session,
    requestId: string
  ): Promise<void> {
    const { data: result, error } = await this.database.insert('billing_events', {
      event_type: 'checkout_completed',
      stripe_customer_id: session.customer as string,
      stripe_session_id: session.id,
      amount: session.amount_total,
      currency: session.currency,
      metadata: session.metadata,
      created_at: new Date().toISOString(),
    });

    if (error) {
      throw createAppError(ErrorType.DATABASE_ERROR, 'Failed to save checkout event', {
        sessionId: session.id,
        error: error.message,
      });
    }

    // Log audit event
    await this.auditLogger.log(
      'checkout_completed',
      session.customer as string,
      {
        sessionId: session.id,
        amount: session.amount_total,
        currency: session.currency,
      },
      requestId
    );
  }

  /**
   * Handle subscription created
   */
  private async handleSubscriptionCreated(
    subscription: Stripe.Subscription,
    requestId: string
  ): Promise<void> {
    const { data: result, error } = await this.database.insert('billing_events', {
      event_type: 'subscription_created',
      stripe_customer_id: subscription.customer as string,
      stripe_subscription_id: subscription.id,
      status: subscription.status,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      created_at: new Date().toISOString(),
    });

    if (error) {
      throw createAppError(ErrorType.DATABASE_ERROR, 'Failed to save subscription event', {
        subscriptionId: subscription.id,
        error: error.message,
      });
    }

    // Log audit event
    await this.auditLogger.log(
      'subscription_created',
      subscription.customer as string,
      {
        subscriptionId: subscription.id,
        status: subscription.status,
      },
      requestId
    );
  }

  /**
   * Handle subscription updated
   */
  private async handleSubscriptionUpdated(
    subscription: Stripe.Subscription,
    requestId: string
  ): Promise<void> {
    const { data: result, error } = await this.database.update(
      'billing_events',
      {
        status: subscription.status,
        current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        stripe_subscription_id: subscription.id,
      }
    );

    if (error) {
      this.logger.warn('Failed to update subscription event', {
        subscriptionId: subscription.id,
        error: error.message,
      });
    }

    // Log audit event
    await this.auditLogger.log(
      'subscription_updated',
      subscription.customer as string,
      {
        subscriptionId: subscription.id,
        status: subscription.status,
      },
      requestId
    );
  }

  /**
   * Handle subscription deleted
   */
  private async handleSubscriptionDeleted(
    subscription: Stripe.Subscription,
    requestId: string
  ): Promise<void> {
    const { data: result, error } = await this.database.insert('billing_events', {
      event_type: 'subscription_deleted',
      stripe_customer_id: subscription.customer as string,
      stripe_subscription_id: subscription.id,
      status: subscription.status,
      canceled_at: subscription.canceled_at
        ? new Date(subscription.canceled_at * 1000).toISOString()
        : null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      throw createAppError(ErrorType.DATABASE_ERROR, 'Failed to save subscription deletion event', {
        subscriptionId: subscription.id,
        error: error.message,
      });
    }

    // Log audit event
    await this.auditLogger.log(
      'subscription_deleted',
      subscription.customer as string,
      {
        subscriptionId: subscription.id,
        canceledAt: subscription.canceled_at,
      },
      requestId
    );
  }

  /**
   * Handle payment succeeded
   */
  private async handlePaymentSucceeded(invoice: Stripe.Invoice, requestId: string): Promise<void> {
    const { data: result, error } = await this.database.insert('billing_events', {
      event_type: 'payment_succeeded',
      stripe_customer_id: invoice.customer as string,
      stripe_invoice_id: invoice.id,
      stripe_subscription_id: invoice.subscription as string,
      amount: invoice.amount_paid,
      currency: invoice.currency,
      created_at: new Date().toISOString(),
    });

    if (error) {
      throw createAppError(ErrorType.DATABASE_ERROR, 'Failed to save payment event', {
        invoiceId: invoice.id,
        error: error.message,
      });
    }

    // Log audit event
    await this.auditLogger.log(
      'payment_succeeded',
      invoice.customer as string,
      {
        invoiceId: invoice.id,
        subscriptionId: invoice.subscription,
        amount: invoice.amount_paid,
        currency: invoice.currency,
      },
      requestId
    );
  }

  /**
   * Handle payment failed
   */
  private async handlePaymentFailed(invoice: Stripe.Invoice, requestId: string): Promise<void> {
    const { data: result, error } = await this.database.insert('billing_events', {
      event_type: 'payment_failed',
      stripe_customer_id: invoice.customer as string,
      stripe_invoice_id: invoice.id,
      stripe_subscription_id: invoice.subscription as string,
      amount: invoice.amount_due,
      currency: invoice.currency,
      created_at: new Date().toISOString(),
    });

    if (error) {
      throw createAppError(ErrorType.DATABASE_ERROR, 'Failed to save payment failure event', {
        invoiceId: invoice.id,
        error: error.message,
      });
    }

    // Log security event for payment failure
    await this.auditLogger.logSecurityEvent(
      'payment_failed',
      invoice.customer as string,
      {
        invoiceId: invoice.id,
        subscriptionId: invoice.subscription,
        amount: invoice.amount_due,
        currency: invoice.currency,
      },
      requestId
    );
  }

  /**
   * Create CORS response for OPTIONS requests
   */
  private createCorsResponse(): Response {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://stripe.com',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
}

// Initialize service
const webhookService = new StripeWebhookService();

// Main handler
serve(async (req: Request) => {
  return await webhookService.processWebhook(req);
});
