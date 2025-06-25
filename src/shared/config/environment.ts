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
    
    // App Configuration
    APP_URL: z.string().url('APP_URL must be a valid URL'),
    APP_NAME: z.string().default('Lean SaaS Starter'),
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
    
    // Monitoring & Observability
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default(
      isDevelopment ? 'debug' : isProduction ? 'warn' : 'info'
    ),
    METRICS_ENABLED: z.coerce.boolean().default(isProduction),
    SENTRY_DSN: z.string().url().optional(),
    ANALYTICS_ENABLED: z.coerce.boolean().default(isProduction),
    
    // Database Configuration
    DATABASE_MAX_CONNECTIONS: z.coerce.number().min(1).max(100).default(10),
    DATABASE_TIMEOUT: z.coerce.number().default(30000), // 30 seconds
    
    // Cache Configuration  
    CACHE_TTL: z.coerce.number().default(300), // 5 minutes
    CACHE_ENABLED: z.coerce.boolean().default(!isTest),
    
    // API Configuration
    API_TIMEOUT: z.coerce.number().default(30000), // 30 seconds
    API_RETRY_ATTEMPTS: z.coerce.number().min(0).max(5).default(3),
    
    // Development specific
    ...(isDevelopment && {
      DEBUG_MODE: z.coerce.boolean().default(true),
      HOT_RELOAD: z.coerce.boolean().default(true),
      MOCK_SERVICES: z.coerce.boolean().default(false),
    }),
    
    // Test specific
    ...(isTest && {
      TEST_DATABASE_URL: z.string().url().optional(),
      TEST_TIMEOUT: z.coerce.number().default(30000),
    }),
    
    // Production specific
    ...(isProduction && {
      HEALTH_CHECK_INTERVAL: z.coerce.number().default(30000), // 30 seconds
      BACKUP_ENABLED: z.coerce.boolean().default(true),
      SSL_REQUIRED: z.coerce.boolean().default(true),
    }),
  });
};

/**
 * Environment validation with detailed error messages
 */
function validateEnvironment() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const schema = createEnvironmentSchema(nodeEnv);
  
  try {
    return schema.parse(process.env);
  } catch (error) {
    console.error('❌ Environment validation failed:');
    
    if (error instanceof z.ZodError) {
      error.errors.forEach((err) => {
        const path = err.path.join('.');
        console.error(`  ${path}: ${err.message}`);
      });
      
      console.error('\n💡 Please check your .env file and ensure all required environment variables are set.');
      console.error('📚 See .env.example for reference.\n');
    } else {
      console.error(error);
    }
    
    process.exit(1);
  }
}

/**
 * Environment detection utilities
 */
export const environment = {
  isDevelopment: () => env.NODE_ENV === 'development',
  isTest: () => env.NODE_ENV === 'test',
  isProduction: () => env.NODE_ENV === 'production',
  isLocal: () => env.APP_URL.includes('localhost') || env.APP_URL.includes('127.0.0.1'),
  
  // Environment-specific getters
  getLogLevel: () => env.LOG_LEVEL,
  isMetricsEnabled: () => env.METRICS_ENABLED,
  isDebugMode: () => env.NODE_ENV === 'development',
  
  // Validation helpers
  validateRequired: (key: string, value?: string) => {
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
  console.log(`  App URL: ${env.APP_URL}`);
  console.log(`  Log Level: ${env.LOG_LEVEL}`);
  console.log(`  Metrics: ${env.METRICS_ENABLED ? 'Enabled' : 'Disabled'}`);
  console.log(`  Rate Limit: ${env.RATE_LIMIT_REQUESTS_PER_MINUTE}/min`);
  console.log(`  Stripe: ${environment.getStripeConfig().isLiveMode ? 'Live' : 'Test'} mode`);
  console.log(`  Cache: ${env.CACHE_ENABLED ? 'Enabled' : 'Disabled'}`);
  console.log('');
}

// Auto-run configuration summary in development
if (environment.isDevelopment() && typeof window === 'undefined') {
  printConfigSummary();
}