// - Enhanced health check with comprehensive service monitoring and error handling

import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

/**
 * Service status enum
 */
enum ServiceStatus {
  OK = 'ok',
  DEGRADED = 'degraded',
  ERROR = 'error',
  UNKNOWN = 'unknown',
}

/**
 * Overall health status
 */
enum HealthStatus {
  OK = 'ok',
  DEGRADED = 'degraded',
  ERROR = 'error',
}

/**
 * Service health information
 */
interface ServiceHealth {
  status: ServiceStatus;
  latency?: number;
  message?: string;
  details?: Record<string, unknown>;
  lastChecked: string;
}

/**
 * Complete health response
 */
interface HealthResponse {
  status: HealthStatus;
  timestamp: string;
  version: string;
  environment: string;
  uptime: number;
  services: {
    database: ServiceHealth;
    auth: ServiceHealth;
    storage: ServiceHealth;
    stripe: ServiceHealth;
    resend: ServiceHealth;
    edge_functions: ServiceHealth;
  };
  performance: {
    responseTime: number;
    memoryUsage?: number;
    cpuUsage?: number;
  };
  metadata: {
    region?: string;
    buildVersion?: string;
    commitHash?: string;
    deploymentTime?: string;
  };
}

/**
 * Health checker class
 */
class HealthChecker {
  private supabase: any;
  private stripe: any;
  private startTime: number;

  constructor() {
    this.startTime = Date.now();

    // Initialize services
    try {
      this.supabase = createClient(
        Deno.env.get('SUPABASE_URL') || '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
      );
    } catch (error: any) {
      console.error('Failed to initialize Supabase client:', error);
    }

    try {
      if (Deno.env.get('STRIPE_SECRET_KEY')) {
        this.stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
          apiVersion: '2023-10-16',
        });
      }
    } catch (error: any) {
      console.error('Failed to initialize Stripe client:', error);
    }
  }

  /**
   * Check database health
   */
  async checkDatabase(): Promise<ServiceHealth> {
    const startTime = Date.now();

    try {
      if (!this.supabase) {
        return {
          status: ServiceStatus.ERROR,
          message: 'Supabase client not initialized',
          lastChecked: new Date().toISOString(),
        };
      }

      // Test basic connectivity with a simple query
      const { data, error } = await this.supabase
        .from('profiles')
        .select('count')
        .limit(1)
        .single();

      const latency = Date.now() - startTime;

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned (acceptable)
        return {
          status: ServiceStatus.ERROR,
          latency,
          message: `Database query failed: ${error.message}`,
          details: { errorCode: error.code },
          lastChecked: new Date().toISOString(),
        };
      }

      // Check latency thresholds
      let status = ServiceStatus.OK;
      if (latency > 1000) {
        status = ServiceStatus.ERROR;
      } else if (latency > 500) {
        status = ServiceStatus.DEGRADED;
      }

      return {
        status,
        latency,
        message: status === ServiceStatus.OK
          ? 'Database is healthy'
          : `High latency: ${latency}ms`,
        details: {
          connectionPool: 'active',
          queryTime: latency,
        },
        lastChecked: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        status: ServiceStatus.ERROR,
        latency: Date.now() - startTime,
        message: `Database health check failed: ${error.message}`,
        details: { error: error.toString() },
        lastChecked: new Date().toISOString(),
      };
    }
  }

  /**
   * Check authentication service health
   */
  async checkAuth(): Promise<ServiceHealth> {
    const startTime = Date.now();

    try {
      if (!this.supabase) {
        return {
          status: ServiceStatus.ERROR,
          message: 'Supabase client not initialized',
          lastChecked: new Date().toISOString(),
        };
      }

      // Test auth service by checking user count (admin operation)
      const { data, error } = await this.supabase.auth.admin.listUsers({
        page: 1,
        perPage: 1,
      });

      const latency = Date.now() - startTime;

      if (error) {
        return {
          status: ServiceStatus.ERROR,
          latency,
          message: `Auth service error: ${error.message}`,
          lastChecked: new Date().toISOString(),
        };
      }

      return {
        status: ServiceStatus.OK,
        latency,
        message: 'Auth service is healthy',
        details: {
          userCount: data.users?.length || 0,
          responseTime: latency,
        },
        lastChecked: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        status: ServiceStatus.ERROR,
        latency: Date.now() - startTime,
        message: `Auth health check failed: ${error.message}`,
        lastChecked: new Date().toISOString(),
      };
    }
  }

  /**
   * Check storage service health
   */
  async checkStorage(): Promise<ServiceHealth> {
    const startTime = Date.now();

    try {
      if (!this.supabase) {
        return {
          status: ServiceStatus.ERROR,
          message: 'Supabase client not initialized',
          lastChecked: new Date().toISOString(),
        };
      }

      // Test storage by listing buckets
      const { data, error } = await this.supabase.storage.listBuckets();

      const latency = Date.now() - startTime;

      if (error) {
        return {
          status: ServiceStatus.ERROR,
          latency,
          message: `Storage service error: ${error.message}`,
          lastChecked: new Date().toISOString(),
        };
      }

      return {
        status: ServiceStatus.OK,
        latency,
        message: 'Storage service is healthy',
        details: {
          bucketsCount: data?.length || 0,
          responseTime: latency,
        },
        lastChecked: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        status: ServiceStatus.ERROR,
        latency: Date.now() - startTime,
        message: `Storage health check failed: ${error.message}`,
        lastChecked: new Date().toISOString(),
      };
    }
  }

  /**
   * Check Stripe service health
   */
  async checkStripe(): Promise<ServiceHealth> {
    const startTime = Date.now();

    try {
      if (!this.stripe) {
        return {
          status: ServiceStatus.DEGRADED,
          message: 'Stripe not configured',
          lastChecked: new Date().toISOString(),
        };
      }

      // Test Stripe connectivity
      const account = await this.stripe.accounts.retrieve();

      const latency = Date.now() - startTime;

      return {
        status: ServiceStatus.OK,
        latency,
        message: 'Stripe service is healthy',
        details: {
          accountId: account.id,
          country: account.country,
          responseTime: latency,
        },
        lastChecked: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        status: ServiceStatus.ERROR,
        latency: Date.now() - startTime,
        message: `Stripe health check failed: ${error.message}`,
        lastChecked: new Date().toISOString(),
      };
    }
  }

  /**
   * Check Resend service health
   */
  async checkResend(): Promise<ServiceHealth> {
    const startTime = Date.now();

    try {
      const resendApiKey = Deno.env.get('RESEND_API_KEY');

      if (!resendApiKey) {
        return {
          status: ServiceStatus.DEGRADED,
          message: 'Resend not configured',
          lastChecked: new Date().toISOString(),
        };
      }

      // Test Resend API connectivity
      const response = await fetch('https://api.resend.com/domains', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
      });

      const latency = Date.now() - startTime;

      if (!response.ok) {
        return {
          status: ServiceStatus.ERROR,
          latency,
          message: `Resend API error: ${response.status}`,
          lastChecked: new Date().toISOString(),
        };
      }

      return {
        status: ServiceStatus.OK,
        latency,
        message: 'Resend service is healthy',
        details: {
          responseTime: latency,
          statusCode: response.status,
        },
        lastChecked: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        status: ServiceStatus.ERROR,
        latency: Date.now() - startTime,
        message: `Resend health check failed: ${error.message}`,
        lastChecked: new Date().toISOString(),
      };
    }
  }

  /**
   * Check Edge Functions health
   */
  async checkEdgeFunctions(): Promise<ServiceHealth> {
    const startTime = Date.now();

    try {
      // Since we're running in an Edge Function, we can assume it's working
      // But we can check memory and other runtime metrics
      const latency = Date.now() - startTime;

      return {
        status: ServiceStatus.OK,
        latency,
        message: 'Edge Functions are healthy',
        details: {
          runtime: 'Deno',
          version: Deno.version.deno,
          typescript: Deno.version.typescript,
          responseTime: latency,
        },
        lastChecked: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        status: ServiceStatus.ERROR,
        latency: Date.now() - startTime,
        message: `Edge Functions health check failed: ${error.message}`,
        lastChecked: new Date().toISOString(),
      };
    }
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(startTime: number) {
    const responseTime = Date.now() - startTime;

    return {
      responseTime,
      // Note: Memory and CPU metrics may not be available in Edge Functions
      memoryUsage: undefined,
      cpuUsage: undefined,
    };
  }

  /**
   * Get metadata information
   */
  getMetadata() {
    return {
      region: Deno.env.get('DENO_REGION') || undefined,
      buildVersion: Deno.env.get('APP_VERSION') || '0.1.0',
      commitHash: Deno.env.get('VERCEL_GIT_COMMIT_SHA') || undefined,
      deploymentTime: Deno.env.get('VERCEL_GIT_COMMIT_DATE') || undefined,
    };
  }

  /**
   * Determine overall health status
   */
  determineOverallStatus(
    services: Record<string, ServiceHealth>,
  ): HealthStatus {
    const statuses = Object.values(services).map((service) => service.status);

    if (statuses.includes(ServiceStatus.ERROR)) {
      return HealthStatus.ERROR;
    }

    if (statuses.includes(ServiceStatus.DEGRADED)) {
      return HealthStatus.DEGRADED;
    }

    return HealthStatus.OK;
  }

  /**
   * Run complete health check
   */
  async checkHealth(): Promise<HealthResponse> {
    const checkStartTime = Date.now();

    // Run all health checks in parallel
    const [database, auth, storage, stripe, resend, edgeFunctions] =
      await Promise.all([
        this.checkDatabase(),
        this.checkAuth(),
        this.checkStorage(),
        this.checkStripe(),
        this.checkResend(),
        this.checkEdgeFunctions(),
      ]);

    const services = {
      database,
      auth,
      storage,
      stripe,
      resend,
      edge_functions: edgeFunctions,
    };

    const overallStatus = this.determineOverallStatus(services);
    const performance = this.getPerformanceMetrics(checkStartTime);
    const metadata = this.getMetadata();

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: Deno.env.get('APP_VERSION') || '0.1.0',
      environment: Deno.env.get('NODE_ENV') || 'development',
      uptime: Date.now() - this.startTime,
      services,
      performance,
      metadata,
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
  'Pragma': 'no-cache',
  'Expires': '0',
};

/**
 * Main serve function
 */
serve(async (req) => {
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
          message: 'Only GET method is allowed',
        },
        timestamp: new Date().toISOString(),
      }),
      {
        status: 405,
        headers: {
          ...securityHeaders,
          'Allow': 'GET, OPTIONS',
        },
      },
    );
  }

  try {
    const healthChecker = new HealthChecker();
    const healthData = await healthChecker.checkHealth();

    // Determine HTTP status code based on health status
    let statusCode = 200;
    if (healthData.status === HealthStatus.DEGRADED) {
      statusCode = 200; // Still return 200 for degraded services
    } else if (healthData.status === HealthStatus.ERROR) {
      statusCode = 503; // Service Unavailable
    }

    return new Response(JSON.stringify(healthData, null, 2), {
      status: statusCode,
      headers: {
        ...securityHeaders,
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    console.error('Health check failed:', error);

    return new Response(
      JSON.stringify(
        {
          status: HealthStatus.ERROR,
          message: 'Health check system failure',
          timestamp: new Date().toISOString(),
          error: {
            code: 'HEALTH_CHECK_FAILURE',
            message: error.message,
            details: Deno.env.get('NODE_ENV') === 'development'
              ? error.stack
              : undefined,
          },
        },
        null,
        2,
      ),
      {
        status: 500,
        headers: securityHeaders,
      },
    );
  }
});
