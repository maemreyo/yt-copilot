import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { createCorsResponse } from '@/cors';

interface CreateCheckoutSessionRequest {
  priceId: string;
  successUrl?: string;
  cancelUrl?: string;
}

interface CheckoutSessionResponse {
  sessionId: string;
  url: string;
  customerId: string;
  expiresAt: string;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return createCorsResponse();
  }

  // Validate HTTP method
  if (req.method !== 'POST') {
    return createErrorResponse(
      'Method not allowed. Only POST requests are supported.',
      405,
    );
  }

  try {
    // Initialize Stripe with better error handling
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set');
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16',
    });

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Extract and validate JWT token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return createErrorResponse(
        'Missing or invalid authorization header',
        401,
      );
    }

    const token = authHeader.split(' ')[1];

    // Verify JWT and get user
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      token,
    );

    if (userError || !user) {
      console.error('Auth error:', userError);
      return createErrorResponse(
        'Unauthorized - Invalid or expired token',
        401,
      );
    }

    // Parse and validate request body
    let requestData: CreateCheckoutSessionRequest;
    try {
      requestData = await req.json();
    } catch {
      return createErrorResponse('Invalid JSON in request body', 400);
    }

    const validation = validateRequest(requestData);
    if (!validation.isValid) {
      return createErrorResponse(
        'Validation failed',
        400,
        { errors: validation.errors },
      );
    }

    const { priceId, successUrl, cancelUrl } = requestData;

    // Get user profile and Stripe customer ID
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();

    if (profileError) {
      console.error('Profile fetch error:', profileError);
      return createErrorResponse('Failed to fetch user profile', 500);
    }

    let customerId = profile.stripe_customer_id;

    // Create Stripe customer if doesn't exist
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          supabase_id: user.id,
        },
      });

      customerId = customer.id;

      // Update profile with Stripe customer ID
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);

      if (updateError) {
        console.error('Profile update error:', updateError);
        // Continue anyway - the customer was created successfully
      }
    }

    // Create checkout session
    const defaultAppUrl = Deno.env.get('APP_URL') || 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: successUrl ||
        `${defaultAppUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${defaultAppUrl}/billing/cancel`,
      subscription_data: {
        metadata: {
          supabase_id: user.id,
        },
      },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      customer_update: {
        address: 'auto',
        name: 'auto',
      },
    });

    // Log successful session creation
    console.log(`Checkout session created: ${session.id} for user: ${user.id}`);

    return createSuccessResponse({
      sessionId: session.id,
      url: session.url || '',
      customerId,
      expiresAt: new Date(session.expires_at * 1000).toISOString(),
    });
  } catch (error) {
    console.error('Error in create-checkout-session function:', error);

    // Handle Stripe-specific errors
    if (error.type === 'StripeCardError') {
      return createErrorResponse('Payment failed - invalid card', 400, {
        code: error.code,
        decline_code: error.decline_code,
      });
    }

    if (error.type === 'StripeInvalidRequestError') {
      return createErrorResponse('Invalid request to payment processor', 400, {
        code: error.code,
        param: error.param,
      });
    }

    return createErrorResponse('Internal server error', 500);
  }
});
