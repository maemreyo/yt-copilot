// - Version information endpoint with build details, environment info, and deployment metadata

import { serve } from 'std/http/server.ts';

/**
 * Version information interface
 */
interface VersionInfo {
  version: string;
  buildNumber?: string;
  buildDate?: string;
  commitHash?: string;
  commitBranch?: string;
  commitMessage?: string;
  environment: string;
  runtime: {
    name: string;
    version: string;
    typescript?: string;
  };
  api: {
    version: string;
    basePath: string;
    documentation?: string;
  };
  services: {
    supabase: {
      url: string;
      region?: string;
    };
    deployment: {
      platform?: string;
      region?: string;
      deployedAt?: string;
      deployedBy?: string;
    };
  };
  features: {
    [key: string]: boolean | string;
  };
  dependencies: {
    [key: string]: string;
  };
  metadata?: {
    [key: string]: unknown;
  };
}

/**
 * Version information builder
 */
class VersionInfoBuilder {
  /**
   * Get application version from environment or package
   */
  private getAppVersion(): string {
    return Deno.env.get('APP_VERSION') || 
           Deno.env.get('npm_package_version') || 
           '0.1.0';
  }

  /**
   * Get build information
   */
  private getBuildInfo() {
    return {
      buildNumber: Deno.env.get('BUILD_NUMBER') || 
                   Deno.env.get('GITHUB_RUN_NUMBER') ||
                   Deno.env.get('VERCEL_GIT_COMMIT_SHA')?.substring(0, 8),
      buildDate: Deno.env.get('BUILD_DATE') || 
                 Deno.env.get('VERCEL_GIT_COMMIT_DATE') ||
                 new Date().toISOString(),
    };
  }

  /**
   * Get Git commit information
   */
  private getCommitInfo() {
    return {
      commitHash: Deno.env.get('COMMIT_HASH') || 
                  Deno.env.get('VERCEL_GIT_COMMIT_SHA') ||
                  Deno.env.get('GITHUB_SHA'),
      commitBranch: Deno.env.get('COMMIT_BRANCH') || 
                    Deno.env.get('VERCEL_GIT_COMMIT_REF') ||
                    Deno.env.get('GITHUB_REF_NAME') ||
                    'main',
      commitMessage: Deno.env.get('COMMIT_MESSAGE') || 
                     Deno.env.get('VERCEL_GIT_COMMIT_MESSAGE') ||
                     undefined,
    };
  }

  /**
   * Get runtime information
   */
  private getRuntimeInfo() {
    return {
      name: 'Deno',
      version: Deno.version.deno,
      typescript: Deno.version.typescript,
    };
  }

  /**
   * Get API information
   */
  private getApiInfo() {
    const baseUrl = Deno.env.get('APP_URL') || 'http://localhost:3000';
    
    return {
      version: 'v1',
      basePath: '/api/v1',
      documentation: `${baseUrl}/docs`,
    };
  }

  /**
   * Get services information
   */
  private getServicesInfo() {
    return {
      supabase: {
        url: Deno.env.get('SUPABASE_URL') || 'http://localhost:54321',
        region: Deno.env.get('SUPABASE_REGION') || undefined,
      },
      deployment: {
        platform: this.getDeploymentPlatform(),
        region: Deno.env.get('DENO_REGION') || 
                Deno.env.get('VERCEL_REGION') ||
                undefined,
        deployedAt: Deno.env.get('VERCEL_GIT_COMMIT_DATE') ||
                    Deno.env.get('DEPLOYMENT_DATE') ||
                    undefined,
        deployedBy: Deno.env.get('VERCEL_GIT_COMMIT_AUTHOR_NAME') ||
                    Deno.env.get('GITHUB_ACTOR') ||
                    undefined,
      },
    };
  }

  /**
   * Detect deployment platform
   */
  private getDeploymentPlatform(): string {
    if (Deno.env.get('VERCEL')) return 'Vercel';
    if (Deno.env.get('NETLIFY')) return 'Netlify';
    if (Deno.env.get('RAILWAY_ENVIRONMENT')) return 'Railway';
    if (Deno.env.get('RENDER')) return 'Render';
    if (Deno.env.get('GITHUB_ACTIONS')) return 'GitHub Actions';
    if (Deno.env.get('CF_PAGES')) return 'Cloudflare Pages';
    return 'Unknown';
  }

  /**
   * Get feature flags
   */
  private getFeatures() {
    return {
      authentication: true,
      billing: Boolean(Deno.env.get('STRIPE_SECRET_KEY')),
      email: Boolean(Deno.env.get('RESEND_API_KEY')),
      analytics: Boolean(Deno.env.get('ANALYTICS_ENABLED')),
      monitoring: Boolean(Deno.env.get('SENTRY_DSN')),
      cache: Boolean(Deno.env.get('CACHE_ENABLED')),
      rateLimit: true,
      apiKeys: true,
      webhooks: true,
      healthCheck: true,
      cors: true,
      compression: false, // Not implemented yet
      fileUpload: false, // Not implemented yet
    };
  }

  /**
   * Get dependency versions
   */
  private getDependencies() {
    // In a real implementation, these would be read from package.json or lock file
    return {
      'deno': Deno.version.deno,
      'typescript': Deno.version.typescript,
      'supabase-js': '2.38.4', // Approximate from imports
      'stripe': '12.18.0', // Approximate from imports
      'zod': '3.22.4', // From package.json in documents
    };
  }

  /**
   * Get additional metadata
   */
  private getMetadata() {
    const nodeEnv = Deno.env.get('NODE_ENV') || 'development';
    
    return {
      startupTime: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      architecture: Deno.build.arch,
      os: Deno.build.os,
      vendor: Deno.build.vendor,
      isDevelopment: nodeEnv === 'development',
      isProduction: nodeEnv === 'production',
      isTest: nodeEnv === 'test',
    };
  }

  /**
   * Build complete version information
   */
  build(): VersionInfo {
    const build = this.getBuildInfo();
    const commit = this.getCommitInfo();
    const runtime = this.getRuntimeInfo();
    const api = this.getApiInfo();
    const services = this.getServicesInfo();
    const features = this.getFeatures();
    const dependencies = this.getDependencies();
    const metadata = this.getMetadata();

    return {
      version: this.getAppVersion(),
      buildNumber: build.buildNumber,
      buildDate: build.buildDate,
      commitHash: commit.commitHash,
      commitBranch: commit.commitBranch,
      commitMessage: commit.commitMessage,
      environment: Deno.env.get('NODE_ENV') || 'development',
      runtime,
      api,
      services,
      features,
      dependencies,
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
  'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
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
      }
    );
  }

  try {
    const builder = new VersionInfoBuilder();
    const versionInfo = builder.build();

    // Check if client wants minimal version info
    const url = new URL(req.url);
    const minimal = url.searchParams.get('minimal') === 'true';

    let responseData: any = versionInfo;

    if (minimal) {
      // Return only essential version information
      responseData = {
        version: versionInfo.version,
        environment: versionInfo.environment,
        buildNumber: versionInfo.buildNumber,
        commitHash: versionInfo.commitHash?.substring(0, 8),
        api: {
          version: versionInfo.api.version,
        },
      };
    }

    // Add response timestamp
    const response = {
      ...responseData,
      _meta: {
        timestamp: new Date().toISOString(),
        requestId: crypto.randomUUID(),
        responseTime: Date.now(),
      },
    };

    return new Response(JSON.stringify(response, null, minimal ? 0 : 2), {
      status: 200,
      headers: {
        ...securityHeaders,
        'Access-Control-Allow-Origin': '*',
        'X-API-Version': versionInfo.api.version,
        'X-Build-Number': versionInfo.buildNumber || 'unknown',
        'X-Commit-Hash': versionInfo.commitHash?.substring(0, 8) || 'unknown',
      },
    });
  } catch (error) {
    console.error('Version endpoint error:', error);
    
    // Return minimal version info even if full build fails
    const fallbackVersion = {
      version: Deno.env.get('APP_VERSION') || '0.1.0',
      environment: Deno.env.get('NODE_ENV') || 'development',
      error: {
        code: 'VERSION_BUILD_ERROR',
        message: 'Failed to build complete version information',
        details: Deno.env.get('NODE_ENV') === 'development' ? error.message : undefined,
      },
      timestamp: new Date().toISOString(),
    };

    return new Response(JSON.stringify(fallbackVersion, null, 2), {
      status: 200, // Still return 200 since basic version info is available
      headers: {
        ...securityHeaders,
        'Access-Control-Allow-Origin': '*',
        'X-API-Version': 'v1',
        'X-Warning': 'Partial version information',
      },
    });
  }
});