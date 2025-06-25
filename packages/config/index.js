// Enhanced configuration exports with all utilities support

// Export all configuration modules
const api = require('./api');
const environment = require('./environment');
const billing = require('./billing');

// Core configuration object
const config = {
  api,
  environment,
  billing,
  
  // Utility configurations
  security: {
    cors: {
      allowedOrigins: process.env.CORS_ALLOWED_ORIGINS?.split(',') || [],
      credentials: process.env.CORS_CREDENTIALS === 'true',
      maxAge: parseInt(process.env.CORS_MAX_AGE || '86400', 10),
    },
    headers: {
      enableCSP: process.env.CSP_POLICY !== 'false',
      cspPolicy: process.env.CSP_POLICY,
      enableHSTS: process.env.SSL_REQUIRED === 'true',
      enableHelmet: process.env.ENABLE_HELMET === 'true',
    },
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    enableConsole: process.env.LOG_ENABLE_CONSOLE !== 'false',
    enableStructured: process.env.LOG_ENABLE_STRUCTURED === 'true',
    enableColors: process.env.LOG_ENABLE_COLORS !== 'false',
    includeStackTrace: process.env.LOG_INCLUDE_STACK_TRACE !== 'false',
    maxMessageLength: parseInt(process.env.LOG_MAX_MESSAGE_LENGTH || '10000', 10),
    redactSensitive: process.env.LOG_REDACT_SENSITIVE !== 'false',
    externalEndpoint: process.env.LOG_EXTERNAL_ENDPOINT,
    externalApiKey: process.env.LOG_EXTERNAL_API_KEY,
  },
  
  cache: {
    enabled: process.env.CACHE_ENABLED !== 'false',
    ttl: parseInt(process.env.CACHE_TTL || '300000', 10),
    maxSize: parseInt(process.env.CACHE_MAX_SIZE || '1000', 10),
    cleanupInterval: parseInt(process.env.CACHE_CLEANUP_INTERVAL || '60000', 10),
    namespace: process.env.CACHE_NAMESPACE || 'cache',
    redis: {
      url: process.env.REDIS_URL,
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      keyPrefix: process.env.REDIS_KEY_PREFIX || 'saas_starter:',
    },
  },
  
  rateLimiting: {
    global: parseInt(process.env.RATE_LIMIT_GLOBAL || '1000', 10),
    auth: parseInt(process.env.RATE_LIMIT_AUTH || '10', 10),
    apiKeys: parseInt(process.env.RATE_LIMIT_API_KEYS || '5', 10),
    billing: parseInt(process.env.RATE_LIMIT_BILLING || '20', 10),
    uploads: parseInt(process.env.RATE_LIMIT_UPLOADS || '10', 10),
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    skipSuccessful: process.env.RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS === 'true',
  },
  
  monitoring: {
    enabled: process.env.METRICS_ENABLED === 'true',
    analytics: process.env.ANALYTICS_ENABLED === 'true',
    performance: process.env.PERFORMANCE_MONITORING === 'true',
    memory: process.env.MEMORY_MONITORING === 'true',
    healthCheck: {
      interval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000', 10),
      timeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT || '5000', 10),
    },
    sentry: {
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    },
  },
  
  uploads: {
    maxSize: parseInt(process.env.UPLOAD_MAX_SIZE || '10485760', 10), // 10MB
    allowedTypes: process.env.UPLOAD_ALLOWED_TYPES?.split(',') || [
      'image/jpeg',
      'image/png',
      'application/pdf',
    ],
    maxFiles: parseInt(process.env.UPLOAD_MAX_FILES || '5', 10),
  },
  
  database: {
    maxConnections: parseInt(process.env.DATABASE_MAX_CONNECTIONS || '10', 10),
    timeout: parseInt(process.env.DATABASE_TIMEOUT || '30000', 10),
    retryAttempts: parseInt(process.env.DATABASE_RETRY_ATTEMPTS || '3', 10),
  },
  
  testing: {
    timeout: parseInt(process.env.TEST_TIMEOUT || '30000', 10),
    coverageThreshold: parseInt(process.env.TEST_COVERAGE_THRESHOLD || '80', 10),
    parallel: process.env.TEST_PARALLEL !== 'false',
    databaseUrl: process.env.TEST_DATABASE_URL,
  },
  
  features: {
    // Feature flags
    apiDocs: process.env.API_DOCS_ENABLED !== 'false',
    playground: process.env.ENABLE_PLAYGROUND === 'true',
    devBypassAuth: process.env.DEV_BYPASS_AUTH === 'true',
    devSeedData: process.env.DEV_SEED_DATA !== 'false',
    debugMode: process.env.DEBUG_MODE === 'true',
    hotReload: process.env.HOT_RELOAD !== 'false',
    mockServices: process.env.MOCK_SERVICES === 'true',
  },
  
  deployment: {
    buildNumber: process.env.BUILD_NUMBER,
    buildDate: process.env.BUILD_DATE,
    commitHash: process.env.COMMIT_HASH,
    commitBranch: process.env.COMMIT_BRANCH,
    commitMessage: process.env.COMMIT_MESSAGE,
    deploymentDate: process.env.DEPLOYMENT_DATE,
    platform: this.detectPlatform(),
    region: process.env.DENO_REGION || process.env.VERCEL_REGION,
  },
  
  // Helper methods
  isDevelopment: () => (process.env.NODE_ENV || 'development') === 'development',
  isTest: () => (process.env.NODE_ENV || 'development') === 'test',
  isProduction: () => (process.env.NODE_ENV || 'development') === 'production',
  isLocal: () => {
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    return appUrl.includes('localhost') || appUrl.includes('127.0.0.1');
  },
  
  detectPlatform: () => {
    if (process.env.VERCEL) return 'Vercel';
    if (process.env.NETLIFY) return 'Netlify';
    if (process.env.RAILWAY_ENVIRONMENT) return 'Railway';
    if (process.env.RENDER) return 'Render';
    if (process.env.CF_PAGES) return 'Cloudflare Pages';
    return 'Unknown';
  },
  
  // Validation
  validate: () => {
    const required = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'APP_URL',
    ];
    
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
    
    return true;
  },
};

module.exports = config;