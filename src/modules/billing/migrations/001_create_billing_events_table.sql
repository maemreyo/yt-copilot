-- Create billing_events table for tracking billing-related events
-- This table stores all billing events from Stripe webhooks and other billing operations

-- First, add missing columns to profiles table if they don't exist
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS name TEXT;

-- Create billing_events table
CREATE TABLE IF NOT EXISTS public.billing_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  
  -- Event identification
  event_type TEXT NOT NULL,
  stripe_event_id TEXT UNIQUE NOT NULL,
  
  -- Stripe identifiers
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_session_id TEXT,
  stripe_invoice_id TEXT,
  stripe_payment_intent_id TEXT,
  
  -- Financial data
  amount INTEGER, -- Amount in cents
  currency TEXT DEFAULT 'usd',
  
  -- Event metadata
  metadata JSONB DEFAULT '{}',
  
  -- Processing timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  processed_at TIMESTAMPTZ,
  
  -- Constraint for valid event types
  CONSTRAINT billing_events_event_type_check CHECK (event_type IN (
    'checkout_session_created',
    'checkout_session_completed',
    'customer_portal_accessed',
    'subscription_created',
    'subscription_updated', 
    'subscription_canceled',
    'subscription_status_changed',
    'invoice_payment_succeeded',
    'invoice_payment_failed',
    'customer_created',
    'customer_updated',
    'payment_method_attached',
    'payment_method_detached',
    'test_duplicate',
    'bulk_test_event',
    'pagination_test'
  ))
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_billing_events_user_id ON public.billing_events(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_stripe_customer_id ON public.billing_events(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_stripe_subscription_id ON public.billing_events(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_event_type ON public.billing_events(event_type);
CREATE INDEX IF NOT EXISTS idx_billing_events_created_at ON public.billing_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_events_processed_at ON public.billing_events(processed_at);

-- Create composite index for efficient pagination queries
CREATE INDEX IF NOT EXISTS idx_billing_events_user_event_created ON public.billing_events(user_id, event_type, created_at DESC);

-- Add RLS (Row Level Security) policies
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own billing events
CREATE POLICY "Users can view own billing events" ON public.billing_events
  FOR SELECT USING (auth.uid() = user_id);

-- Policy: Service role can insert billing events (for webhooks)
CREATE POLICY "Service role can insert billing events" ON public.billing_events
  FOR INSERT WITH CHECK (true);

-- Policy: Service role can update billing events (for processing)
CREATE POLICY "Service role can update billing events" ON public.billing_events
  FOR UPDATE USING (true);

-- Add comments for documentation
COMMENT ON TABLE public.billing_events IS 'Stores billing-related events from Stripe webhooks and internal billing operations';
COMMENT ON COLUMN public.billing_events.stripe_event_id IS 'Unique identifier from Stripe to prevent duplicate processing';
COMMENT ON COLUMN public.billing_events.amount IS 'Amount in cents (lowest currency unit)';
COMMENT ON COLUMN public.billing_events.metadata IS 'Additional event data as JSON';
COMMENT ON COLUMN public.billing_events.processed_at IS 'When the event was successfully processed';