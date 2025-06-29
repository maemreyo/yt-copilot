// Runtime configuration display endpoint (development only)

import { denoEnv } from '@/shared-deno-env';
import { serve } from 'std/http/server.ts';

/**
 * Configuration section interface
 */
interface ConfigSection {
  name: string;
  description: string;
  variables: Record<
    string,
    {
      value: string | number | boolean;
      type: 'string' | 'number' | 'boolean' | 'url' | 'email';
      sensitive: boolean;
      source: 'environment' | 'default' | 'computed';
      description?: string;
    }
  >;
}

/**
 * Feature flags interface
 */
interface FeatureFlags {
  development: Record<string, boolean>;
  features: Record<string, boolean>;
  experiments: Record<string, boolean>;
}

/**
 * Runtime configuration response
 */
interface ConfigurationResponse {
  timestamp: string;
  environment: string;
  version: string;
  accessLevel: 'development' | 'production';
  sections: ConfigSection[];
  featureFlags: FeatureFlags;
  runtime: {
    uptime: number;
    nodeVersion: string;
    platform: string;
    region?: string;
    buildInfo?: {
      number?: string;
      date?: string;
      commit?: string;
      branch?: string;
    };
  };
  warnings: string[];
}

/**
 * Configuration service
 */
class ConfigurationService {
  private sensitivePatterns = [
    /secret/i,
    /key$/i,
    /password/i,
    /token/i,
    /credential/i,
    /_dsn$/i,
    /webhook/i,
    /private/i,
  ];

  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Check if a key contains sensitive information
   */
  private isSensitive(key: string): boolean {
    return this.sensitivePatterns.some(pattern => pattern.test(key));
  }

  /**
   * Mask sensitive values
   */
  private maskSensitiveValue(value: string, key: string): string {
    if (!this.isSensitive(key)) {
      return value;
    }

    if (value.length <= 8) {
      return '***';
    }

    // Show first 3 and last 3 characters for longer values
    return `${value.substring(0, 3)}***${value.substring(value.length - 3)}`;
  }

  /**
   * Determine variable type
   */
  private determineType(value: string): 'string' | 'number' | 'boolean' | 'url' | 'email' {
    // Check for boolean
    if (value === 'true' || value === 'false') {
      return 'boolean';
    }

    // Check for number
    if (!isNaN(Number(value)) && value.trim() !== '') {
      return 'number';
    }

    // Check for URL
    try {
      new URL(value);
      return 'url';
    } catch {}

    // Check for email
    if (value.includes('@') && value.includes('.')) {
      return 'email';
    }

    return 'string';
  }

  /**
   * Process environment variable
   */
  private processEnvVar(key: string, value: string | undefined) {
    if (value === undefined) {
      return null;
    }

    const isSensitive = this.isSensitive(key);
    const type = this.determineType(value);
    let processedValue: string | number | boolean = value;

    // Convert to appropriate type
    if (type === 'boolean') {
      processedValue = value === 'true';
    } else if (type === 'number') {
      processedValue = Number(value);
    } else if (isSensitive) {
      processedValue = this.maskSensitiveValue(value, key);
    }

    return {
      value: processedValue,
      type,
      sensitive: isSensitive,
      source: 'environment' as const,
    };
  }

  /**
   * Get Supabase configuration section
   */
  private getSupabaseConfig(): ConfigSection {
    const variables: Record<string, any> = {};

    [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_PROJECT_ID',
    ].forEach(key => {
      const processed = this.processEnvVar(key, denoEnv.get(key));
      if (processed) {
        variables[key] = processed;
      }
    });

    return {
      name: 'Supabase',
      description: 'Supabase platform configuration',
      variables,
    };
  }

  /**
   * Get Stripe configuration section
   */
  private getStripeConfig(): ConfigSection {
    const variables: Record<string, any> = {};

    ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID'].forEach(key => {
      const processed = this.processEnvVar(key, denoEnv.get(key));
      if (processed) {
        variables[key] = processed;
      }
    });

    // Add computed values
    const stripeKey = denoEnv.get('STRIPE_SECRET_KEY') || '';
    variables['STRIPE_MODE'] = {
      value: stripeKey.startsWith('sk_live_') ? 'live' : 'test',
      type: 'string' as const,
      sensitive: false,
      source: 'computed' as const,
      description: 'Stripe operating mode',
    };

    return {
      name: 'Stripe',
      description: 'Payment processing configuration',
      variables,
    };
  }

  /**
   * Get application configuration section
   */
  private getAppConfig(): ConfigSection {
    const variables: Record<string, any> = {};

    ['APP_URL', 'APP_NAME', 'APP_VERSION', 'NODE_ENV'].forEach(key => {
      const processed = this.processEnvVar(key, denoEnv.get(key));
      if (processed) {
        variables[key] = processed;
      }
    });

    return {
      name: 'Application',
      description: 'Core application settings',
      variables,
    };
  }

  /**
   * Get security configuration section
   */
  private getSecurityConfig(): ConfigSection {
    const variables: Record<string, any> = {};

    [
      'JWT_SECRET',
      'ENCRYPTION_KEY',
      'RATE_LIMIT_REQUESTS_PER_MINUTE',
      'RATE_LIMIT_WINDOW_MS',
    ].forEach(key => {
      const processed = this.processEnvVar(key, denoEnv.get(key));
      if (processed) {
        variables[key] = processed;
      }
    });

    return {
      name: 'Security',
      description: 'Security and authentication settings',
      variables,
    };
  }

  /**
   * Get monitoring configuration section
   */
  private getMonitoringConfig(): ConfigSection {
    const variables: Record<string, any> = {};

    ['LOG_LEVEL', 'METRICS_ENABLED', 'SENTRY_DSN', 'ANALYTICS_ENABLED'].forEach(key => {
      const processed = this.processEnvVar(key, denoEnv.get(key));
      if (processed) {
        variables[key] = processed;
      }
    });

    return {
      name: 'Monitoring',
      description: 'Logging, metrics, and observability',
      variables,
    };
  }

  /**
   * Get database configuration section
   */
  private getDatabaseConfig(): ConfigSection {
    const variables: Record<string, any> = {};

    ['DATABASE_MAX_CONNECTIONS', 'DATABASE_TIMEOUT', 'CACHE_ENABLED', 'CACHE_TTL'].forEach(key => {
      const processed = this.processEnvVar(key, denoEnv.get(key));
      if (processed) {
        variables[key] = processed;
      }
    });

    return {
      name: 'Database & Cache',
      description: 'Database and caching configuration',
      variables,
    };
  }

  /**
   * Get feature flags
   */
  private getFeatureFlags(): FeatureFlags {
    const env = denoEnv.get('NODE_ENV') || 'development';

    return {
      development: {
        debugMode: env === 'development',
        hotReload: denoEnv.get('HOT_RELOAD') === 'true',
        mockServices: denoEnv.get('MOCK_SERVICES') === 'true',
        seedData: env !== 'production',
      },
      features: {
        metricsEnabled: denoEnv.get('METRICS_ENABLED') === 'true',
        analyticsEnabled: denoEnv.get('ANALYTICS_ENABLED') === 'true',
        cacheEnabled: denoEnv.get('CACHE_ENABLED') !== 'false',
        rateLimitingEnabled: env === 'production',
        errorReporting: denoEnv.get('ERROR_REPORTING') !== 'false',
      },
      experiments: {
        newAuthFlow: false, // Example experimental feature
        enhancedMetrics: false,
        betaFeatures: env === 'development',
      },
    };
  }

  /**
   * Get runtime information
   */
  private getRuntimeInfo() {
    return {
      uptime: Date.now() - this.startTime,
      nodeVersion: Deno.version.deno || 'unknown',
      platform: Deno.build.os || 'unknown',
      region: denoEnv.get('DENO_REGION') || denoEnv.get('VERCEL_REGION'),
      buildInfo: {
        number: denoEnv.get('BUILD_NUMBER'),
        date: denoEnv.get('BUILD_DATE'),
        commit: denoEnv.get('COMMIT_HASH')?.substring(0, 8),
        branch: denoEnv.get('COMMIT_BRANCH'),
      },
    };
  }

  /**
   * Get configuration warnings
   */
  private getWarnings(): string[] {
    const warnings: string[] = [];
    const env = denoEnv.get('NODE_ENV') || 'development';

    // Check for development secrets in production
    if (env === 'production') {
      const jwtSecret = denoEnv.get('JWT_SECRET') || '';
      const encryptionKey = denoEnv.get('ENCRYPTION_KEY') || '';

      if (jwtSecret.includes('dev-') || jwtSecret.includes('development')) {
        warnings.push('JWT_SECRET appears to be a development key in production');
      }

      if (encryptionKey.includes('dev-') || encryptionKey.includes('development')) {
        warnings.push('ENCRYPTION_KEY appears to be a development key in production');
      }

      const stripeKey = denoEnv.get('STRIPE_SECRET_KEY') || '';
      if (stripeKey.startsWith('sk_test_')) {
        warnings.push('Using Stripe test keys in production environment');
      }
    }

    // Check for missing optional configs
    if (!denoEnv.get('SENTRY_DSN') && env === 'production') {
      warnings.push('SENTRY_DSN not configured for production error tracking');
    }

    if (!denoEnv.get('STRIPE_PRICE_ID')) {
      warnings.push('STRIPE_PRICE_ID not configured for subscription billing');
    }

    return warnings;
  }

  /**
   * Generate complete configuration response
   */
  generateConfig(): ConfigurationResponse {
    const env = denoEnv.get('NODE_ENV') || 'development';

    return {
      timestamp: new Date().toISOString(),
      environment: env,
      version: denoEnv.get('APP_VERSION') || '0.1.0',
      accessLevel: env === 'development' ? 'development' : 'production',
      sections: [
        this.getAppConfig(),
        this.getSupabaseConfig(),
        this.getStripeConfig(),
        this.getSecurityConfig(),
        this.getMonitoringConfig(),
        this.getDatabaseConfig(),
      ],
      featureFlags: this.getFeatureFlags(),
      runtime: this.getRuntimeInfo(),
      warnings: this.getWarnings(),
    };
  }
}

/**
 * Security headers for responses
 */
const securityHeaders = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

/**
 * Main serve function
 */
serve(async req => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        ...securityHeaders,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'Only GET method is allowed for configuration endpoint',
        },
        timestamp: new Date().toISOString(),
      }),
      {
        status: 405,
        headers: {
          ...securityHeaders,
          Allow: 'GET, OPTIONS',
        },
      }
    );
  }

  try {
    const environment = denoEnv.get('NODE_ENV') || 'development';

    // Restrict access to development environment only
    if (environment !== 'development') {
      return new Response(
        JSON.stringify({
          error: {
            code: 'ACCESS_DENIED',
            message: 'Configuration endpoint is only available in development environment',
            environment,
          },
          timestamp: new Date().toISOString(),
        }),
        {
          status: 403,
          headers: securityHeaders,
        }
      );
    }

    // Generate configuration
    const service = new ConfigurationService();
    const config = service.generateConfig();

    // Add response metadata
    const response = {
      ...config,
      _meta: {
        generatedAt: new Date().toISOString(),
        requestId: crypto.randomUUID(),
        note: 'This endpoint is only available in development environment',
      },
    };

    return new Response(JSON.stringify(response, null, 2), {
      status: 200,
      headers: {
        ...securityHeaders,
        'Access-Control-Allow-Origin': '*',
        'X-Environment': environment,
        'X-Config-Version': config.version,
        'X-Warning-Count': config.warnings.length.toString(),
      },
    });
  } catch (error: any) {
    console.error('Configuration endpoint error:', error);

    return new Response(
      JSON.stringify({
        error: {
          code: 'CONFIG_GENERATION_ERROR',
          message: 'Failed to generate configuration',
          details: denoEnv.get('NODE_ENV') === 'development' ? error.message : undefined,
        },
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: securityHeaders,
      }
    );
  }
});
