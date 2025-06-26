// - Enhanced with comprehensive validation, fallbacks, and environment-specific configs

import { z } from 'zod';

/**
 * Environment-specific configuration schema
 * Provides different validation rules for different environments
 */
const createEnvironmentSchema = (env: string) => {
  const isProduction = env === 'production';
  const isDevelopment = env === 'development';
  const isTest = env === 'test';

  return z.object({
    // Environment Detection
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    
    // Supabase Configuration
    SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
    SUPABASE_ANON_KEY: z.string().min(1, 'SUPABASE_ANON_KEY is required'),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
    SUPABASE_PROJECT_ID: z.string().optional(),
    
    // Stripe Configuration
    STRIPE_SECRET_KEY: isProduction 
      ? z.string().startsWith('sk_live_', 'Production must use live Stripe keys')
      : z.string().startsWith('sk_test_', 'Development/Test should use test Stripe keys'),
    STRIPE_WEBHOOK_SECRET: z.string().min(1, 'STRIPE_WEBHOOK_SECRET is required'),
    STRIPE_PRICE_ID: z.string().optional(),
    
    // Resend Configuration
    RESEND_API_KEY: z.string().startsWith('re_', 'RESEND_API_KEY must start with re_'),
    RESEND_FROM_EMAIL: z.string().email().optional(),
    
    // YouTube API Configuration
    YOUTUBE_API_KEY: z.string().min(1, 'YOUTUBE_API_KEY is required'),
    YOUTUBE_API_QUOTA_PER_DAY: z.coerce.number().default(10000), // Default YouTube quota
    YOUTUBE_CACHE_TTL_SECONDS: z.coerce.number().default(86400), // 24 hours
    
    // Translation API Configuration (for future use)
    GOOGLE_TRANSLATE_API_KEY: z.string().optional(),
    GOOGLE_TRANSLATE_PROJECT_ID: z.string().optional(),
    
    // App Configuration
    APP_URL: z.string().url('APP_URL must be a valid URL'),
    APP_NAME: z.string().default('YouTube Learning Co-pilot'),
    APP_VERSION: z.string().default('0.1.0'),
    
    // Security Configuration
    JWT_SECRET: isProduction 
      ? z.string().min(32, 'JWT_SECRET must be at least 32 characters in production')
      : z.string().default('dev-jwt-secret-key-not-for-production'),
    ENCRYPTION_KEY: isProduction
      ? z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters in production')
      : z.string().default('dev-encryption-key-not-for-production'),
    
    // Rate Limiting Configuration
    RATE_LIMIT_REQUESTS_PER_MINUTE: z.coerce.number().min(1).max(10000).default(60),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000), // 1 minute
    RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS: z.coerce.boolean().default(false),
    
    // YouTube Module Rate Limits
    YOUTUBE_RATE_LIMIT_PER_MINUTE: z.coerce.number().default(20), // YouTube API calls per minute
    YOUTUBE_RATE_LIMIT_PER_HOUR: z.coerce.number().default(600), // YouTube API calls per hour
    
    // Monitoring & Observability
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default(
      isDevelopment ? 'debug' : isProduction ? 'error' : 'info'
    ),
    METRICS_ENABLED: z.coerce.boolean().default(isProduction),
    SENTRY_DSN: z.string().url().optional(),
    
    // Database Configuration
    DATABASE_MAX_CONNECTIONS: z.coerce.number().min(1).max(100).default(20),
    DATABASE_TIMEOUT: z.coerce.number().min(1000).max(60000).default(5000),
    
    // Cache Configuration
    CACHE_ENABLED: z.coerce.boolean().default(true),
    CACHE_TTL: z.coerce.number().min(0).default(300), // 5 minutes
    CACHE_REDIS_URL: z.string().url().optional(),
    
    // Feature Flags
    FEATURE_AUTH_ENABLED: z.coerce.boolean().default(true),
    FEATURE_BILLING_ENABLED: z.coerce.boolean().default(true),
    FEATURE_YOUTUBE_ENABLED: z.coerce.boolean().default(true),
    FEATURE_TRANSLATION_ENABLED: z.coerce.boolean().default(false),
    FEATURE_AI_SUMMARY_ENABLED: z.coerce.boolean().default(false),
    
    // Development Tools
    DEV_TOOLS_ENABLED: z.coerce.boolean().default(isDevelopment),
    DEV_SEED_DATA: z.coerce.boolean().default(isDevelopment),
    DEV_API_LOGGING: z.coerce.boolean().default(isDevelopment),
    
    // Test Configuration
    TEST_USER_EMAIL: isTest ? z.string().email().default('test@example.com') : z.string().optional(),
    TEST_USER_PASSWORD: isTest ? z.string().default('test-password') : z.string().optional(),
  });
};

/**
 * Validate environment variables
 */
function validateEnvironment() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const schema = createEnvironmentSchema(nodeEnv);
  
  try {
    const parsed = schema.parse(process.env);
    console.log(`✅ Environment validation passed for ${nodeEnv} environment`);
    return parsed;
  } catch (error) {
    console.error('❌ Environment validation failed:');
    if (error instanceof z.ZodError) {
      error.errors.forEach(err => {
        console.error(`  ${err.path.join('.')}: ${err.message}`);
      });
    }
    throw new Error('Invalid environment configuration');
  }
}

/**
 * Environment utilities
 */
export const environment = {
  // Environment checks
  isDevelopment: () => env.NODE_ENV === 'development',
  isProduction: () => env.NODE_ENV === 'production',
  isTest: () => env.NODE_ENV === 'test',
  
  // Require helper for critical configs
  require: (key: string) => {
    const value = (env as any)[key];
    if (!value) {
      throw new Error(`Required environment variable ${key} is not set`);
    }
    return value;
  },
  
  // Configuration helpers
  getDatabaseConfig: () => ({
    url: env.SUPABASE_URL,
    maxConnections: env.DATABASE_MAX_CONNECTIONS,
    timeout: env.DATABASE_TIMEOUT,
  }),
  
  getRedisConfig: () => ({
    enabled: env.CACHE_ENABLED,
    ttl: env.CACHE_TTL,
  }),
  
  getStripeConfig: () => ({
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    priceId: env.STRIPE_PRICE_ID,
    isLiveMode: env.STRIPE_SECRET_KEY.startsWith('sk_live_'),
  }),
  
  getSupabaseConfig: () => ({
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    projectId: env.SUPABASE_PROJECT_ID,
  }),
  
  getYouTubeConfig: () => ({
    apiKey: env.YOUTUBE_API_KEY,
    quotaPerDay: env.YOUTUBE_API_QUOTA_PER_DAY,
    cacheTtlSeconds: env.YOUTUBE_CACHE_TTL_SECONDS,
    rateLimits: {
      perMinute: env.YOUTUBE_RATE_LIMIT_PER_MINUTE,
      perHour: env.YOUTUBE_RATE_LIMIT_PER_HOUR,
    },
  }),
  
  getTranslationConfig: () => ({
    googleApiKey: env.GOOGLE_TRANSLATE_API_KEY,
    googleProjectId: env.GOOGLE_TRANSLATE_PROJECT_ID,
    enabled: env.FEATURE_TRANSLATION_ENABLED,
  }),
  
  getRateLimitConfig: () => ({
    requestsPerMinute: env.RATE_LIMIT_REQUESTS_PER_MINUTE,
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    skipSuccessful: env.RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS,
  }),
};

/**
 * Runtime configuration validation
 */
export function validateRuntimeConfig() {
  const checks = [
    {
      name: 'Supabase connectivity',
      check: () => env.SUPABASE_URL && env.SUPABASE_ANON_KEY,
      message: 'Supabase configuration is incomplete',
    },
    {
      name: 'Stripe configuration',
      check: () => env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET,
      message: 'Stripe configuration is incomplete',
    },
    {
      name: 'YouTube API configuration',
      check: () => env.YOUTUBE_API_KEY,
      message: 'YouTube API key is not configured',
    },
    {
      name: 'App URL configuration',
      check: () => env.APP_URL && !env.APP_URL.endsWith('/'),
      message: 'APP_URL should not end with trailing slash',
    },
    {
      name: 'Rate limiting configuration',
      check: () => env.RATE_LIMIT_REQUESTS_PER_MINUTE > 0,
      message: 'Rate limiting must allow at least 1 request per minute',
    },
  ];
  
  const failures = checks.filter(check => !check.check());
  
  if (failures.length > 0) {
    console.error('❌ Runtime configuration validation failed:');
    failures.forEach(failure => {
      console.error(`  ${failure.name}: ${failure.message}`);
    });
    throw new Error('Configuration validation failed');
  }
  
  console.log('✅ Runtime configuration validation passed');
}

/**
 * Environment configuration with fallbacks and validation
 */
export const env = validateEnvironment();

/**
 * Configuration summary for debugging
 */
export function printConfigSummary() {
  if (!environment.isDevelopment()) return;
  
  console.log('\n📋 Configuration Summary:');
  console.log(`  Environment: ${env.NODE_ENV}`);
  console.log(`  App: ${env.APP_NAME} v${env.APP_VERSION}`);
  console.log(`  App URL: ${env.APP_URL}`);
  console.log(`  Log Level: ${env.LOG_LEVEL}`);
  console.log(`  Metrics: ${env.METRICS_ENABLED ? 'Enabled' : 'Disabled'}`);
  console.log(`  Rate Limit: ${env.RATE_LIMIT_REQUESTS_PER_MINUTE}/min`);
  console.log(`  Stripe: ${environment.getStripeConfig().isLiveMode ? 'Live' : 'Test'} mode`);
  console.log(`  YouTube: API configured, ${env.YOUTUBE_API_QUOTA_PER_DAY} quota/day`);
  console.log(`  Cache: ${env.CACHE_ENABLED ? 'Enabled' : 'Disabled'} (TTL: ${env.CACHE_TTL}s)`);
  console.log(`  Features: YouTube=${env.FEATURE_YOUTUBE_ENABLED}, Translation=${env.FEATURE_TRANSLATION_ENABLED}`);
  console.log('\n');
}