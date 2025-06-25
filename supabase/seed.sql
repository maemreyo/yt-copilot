-- Seed data for development environment
-- This file will be executed when running 'supabase db reset'

-- Create test users
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
VALUES 
  ('00000000-0000-0000-0000-000000000001', 'test@example.com', '$2a$10$abcdefghijklmnopqrstuvwxyz012345', now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000002', 'admin@example.com', '$2a$10$abcdefghijklmnopqrstuvwxyz012345', now(), '{"provider":"email","providers":["email"]}', '{}');

-- Create profiles for test users
INSERT INTO public.profiles (id, stripe_customer_id, stripe_subscription_id, stripe_subscription_status)
VALUES 
  ('00000000-0000-0000-0000-000000000001', 'cus_test1', 'sub_test1', 'active'),
  ('00000000-0000-0000-0000-000000000002', 'cus_test2', 'sub_test2', 'active');

-- Create API keys for test users
INSERT INTO public.api_keys (user_id, key_hash, key_prefix, created_at)
VALUES 
  ('00000000-0000-0000-0000-000000000001', '$2a$10$abcdefghijklmnopqrstuvwxyz012345', 'test_key_1', now()),
  ('00000000-0000-0000-0000-000000000002', '$2a$10$abcdefghijklmnopqrstuvwxyz012345', 'test_key_2', now());