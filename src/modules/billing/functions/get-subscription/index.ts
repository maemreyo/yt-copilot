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
 * Service for handling subscription-related operations.
 */
class SubscriptionService {
  private stripe: Stripe;
  private supabase: any;

  constructor() {
    this.stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
      apiVersion: '2023-10-16',
    });
    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );
  }

  /**
   * Retrieves the subscription details for a given user.
   * @param userId The ID of the user.
   * @returns The subscription details or null if not found.
   */
  async getSubscription(userId: string): Promise<any | null> {
    const { data: profile, error: profileError } = await this.supabase
      .from('profiles')
      .select('stripe_subscription_id')
      .eq('id', userId)
      .single();

    if (profileError) {
      throw new Error(`Failed to fetch user profile: ${profileError.message}`);
    }

    if (!profile.stripe_subscription_id) {
      return null;
    }

    const subscription = await this.stripe.subscriptions.retrieve(
      profile.stripe_subscription_id,
    );

    return {
      id: subscription.id,
      status: subscription.status,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000)
        .toISOString(),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      priceId: subscription.items.data[0].price.id,
      customerId: subscription.customer,
    };
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
    const subscriptionService = new SubscriptionService();
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    );

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

    const subscription = await subscriptionService.getSubscription(user.id);

    return createCorsSuccessResponse({ subscription }, 200, requestId);
  } catch (error) {
    console.error('Error in get-subscription:', error);

    if (error instanceof AppError) {
      return error.toHttpResponse();
    }

    const appError = handleUnknownError(error, requestId);
    return appError.toHttpResponse();
  }
});
