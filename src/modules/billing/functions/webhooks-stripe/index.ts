// src/modules/billing/functions/webhooks-stripe/index.ts

import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import {
  createCorsErrorResponse,
  createCorsResponse,
  createCorsSuccessResponse,
} from '@/cors';
import {
  AppError,
  createAppError,
  ErrorType,
  handleUnknownError,
} from '@/shared-errors';

/**
 * Service for handling Stripe webhooks.
 */
class WebhookService {
  private stripe: Stripe;
  private supabase: any;

  constructor() {
    this.stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
      apiVersion: '2023-10-16',
    });
    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );
  }

  /**
   * Verifies and constructs a Stripe event from a request.
   * @param body The raw request body.
   * @param signature The Stripe signature header.
   * @returns The verified Stripe event.
   */
  async constructEvent(body: string, signature: string): Promise<Stripe.Event> {
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not set');
    }
    return this.stripe.webhooks.constructEvent(body, signature, webhookSecret);
  }

  /**
   * Handles the logic for different event types.
   * @param event The Stripe event.
   */
  async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  }

  private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
    const subscription = await this.stripe.subscriptions.retrieve(session.subscription as string);
    const { error } = await this.supabase
      .from('profiles')
      .update({
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        stripe_subscription_status: subscription.status,
      })
      .eq('id', subscription.metadata.supabase_id);

    if (error) {
      console.error('Error updating profile on checkout completion:', error);
    }
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    const { error } = await this.supabase
      .from('profiles')
      .update({ stripe_subscription_status: subscription.status })
      .eq('stripe_subscription_id', subscription.id);

    if (error) {
      console.error('Error updating profile on subscription update:', error);
    }
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    const { error } = await this.supabase
      .from('profiles')
      .update({
        stripe_subscription_id: null,
        stripe_subscription_status: 'canceled',
      })
      .eq('stripe_subscription_id', subscription.id);

    if (error) {
      console.error('Error updating profile on subscription deletion:', error);
    }
  }
}

/**
 * Main request handler.
 */
serve(async (req) => {
  const requestId = crypto.randomUUID();

  if (req.method === 'OPTIONS') {
    return createCorsResponse();
  }

  try {
    const webhookService = new WebhookService();

    const signature = req.headers.get('stripe-signature');
    if (!signature) {
      throw createAppError(ErrorType.VALIDATION_ERROR, 'Missing Stripe signature', { code: 'INVALID_WEBHOOK' }, requestId);
    }

    const body = await req.text();
    const event = await webhookService.constructEvent(body, signature);

    await webhookService.handleEvent(event);

    return createCorsSuccessResponse({ received: true, eventType: event.type }, 200, requestId);

  } catch (error) {
    console.error('Error in webhook handler:', error);

    if (error instanceof AppError) {
      return error.toHttpResponse();
    }

    if (error.type === 'StripeSignatureVerificationError') {
        const appError = createAppError(ErrorType.AUTHENTICATION_ERROR, 'Webhook signature verification failed', {
            code: 'INVALID_SIGNATURE',
            details: error.message,
        }, requestId);
        return appError.toHttpResponse();
    }

    const appError = handleUnknownError(error, requestId);
    return appError.toHttpResponse();
  }
});
