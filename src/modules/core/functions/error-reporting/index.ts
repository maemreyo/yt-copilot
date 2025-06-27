// - Central error reporting and logging endpoint using Layer 1 & 2 utilities

import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';

/**
 * Error report schema for validation
 */
interface ErrorReportRequest {
  // Error details
  message: string;
  errorCode?: string;
  stack?: string;

  // Context information
  url?: string;
  userAgent?: string;
  userId?: string;
  sessionId?: string;

  // Application context
  module: string;
  function?: string;
  version?: string;
  environment?: 'development' | 'test' | 'production';

  // Error metadata
  severity?: 'low' | 'medium' | 'high' | 'critical';
  category?:
    | 'frontend'
    | 'backend'
    | 'api'
    | 'database'
    | 'network'
    | 'security'
    | 'performance';
  tags?: string[];

  // Additional data
  additionalData?: Record<string, unknown>;
  fingerprint?: string; // For grouping similar errors

  // Client information
  timestamp?: string;
  browserInfo?: {
    name?: string;
    version?: string;
    platform?: string;
  };
}

/**
 * Error aggregation result
 */
interface ErrorAggregation {
  fingerprint: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  message: string;
  module: string;
  severity: string;
  category: string;
}

/**
 * Error statistics
 */
interface ErrorStats {
  totalErrors: number;
  errorsByModule: Record<string, number>;
  errorsBySeverity: Record<string, number>;
  errorsByCategory: Record<string, number>;
  timeRange: {
    start: string;
    end: string;
  };
}

/**
 * Error reporting service
 */
class ErrorReportingService {
  private supabase: any;
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
      {
        auth: { persistSession: false },
        global: {
          headers: { 'x-application-name': 'error-reporting-service' },
        },
      },
    );
  }

  /**
   * Validate error report request
   */
  private validateErrorReport(
    data: any,
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Required fields
    if (!data.message || typeof data.message !== 'string') {
      errors.push('message is required and must be a string');
    }
    if (!data.module || typeof data.module !== 'string') {
      errors.push('module is required and must be a string');
    }

    // Length validations
    if (data.message && data.message.length > 1000) {
      errors.push('message must be less than 1000 characters');
    }
    if (data.module && data.module.length > 50) {
      errors.push('module must be less than 50 characters');
    }
    if (data.function && data.function.length > 100) {
      errors.push('function must be less than 100 characters');
    }

    // Enum validations
    const validSeverities = ['low', 'medium', 'high', 'critical'];
    if (data.severity && !validSeverities.includes(data.severity)) {
      errors.push(`severity must be one of: ${validSeverities.join(', ')}`);
    }

    const validCategories = [
      'frontend',
      'backend',
      'api',
      'database',
      'network',
      'security',
      'performance',
    ];
    if (data.category && !validCategories.includes(data.category)) {
      errors.push(`category must be one of: ${validCategories.join(', ')}`);
    }

    const validEnvironments = ['development', 'test', 'production'];
    if (data.environment && !validEnvironments.includes(data.environment)) {
      errors.push(
        `environment must be one of: ${validEnvironments.join(', ')}`,
      );
    }

    // Array validations
    if (data.tags && (!Array.isArray(data.tags) || data.tags.length > 10)) {
      errors.push('tags must be an array with maximum 10 items');
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Generate error fingerprint for grouping
   */
  private generateFingerprint(errorReport: ErrorReportRequest): string {
    if (errorReport.fingerprint) {
      return errorReport.fingerprint;
    }

    // Create fingerprint from error message, module, and function
    const components = [
      errorReport.module,
      errorReport.function || '',
      errorReport.errorCode || '',
      // Normalize error message (remove dynamic parts like IDs, timestamps)
      errorReport.message.replace(/\d+/g, 'X').replace(
        /[a-f0-9-]{36}/g,
        'UUID',
      ),
    ];

    const fingerprint = components.join('|').toLowerCase();
    return btoa(fingerprint).substring(0, 32);
  }

  /**
   * Store error report in database
   */
  private async storeErrorReport(
    errorReport: ErrorReportRequest,
    fingerprint: string,
  ): Promise<void> {
    try {
      const reportData = {
        message: errorReport.message,
        error_code: errorReport.errorCode,
        stack_trace: errorReport.stack,
        url: errorReport.url,
        user_agent: errorReport.userAgent,
        user_id: errorReport.userId,
        session_id: errorReport.sessionId,
        module: errorReport.module,
        function_name: errorReport.function,
        version: errorReport.version,
        environment: errorReport.environment || 'unknown',
        severity: errorReport.severity || 'medium',
        category: errorReport.category || 'backend',
        tags: errorReport.tags || [],
        additional_data: errorReport.additionalData,
        fingerprint,
        browser_info: errorReport.browserInfo,
        created_at: new Date().toISOString(),
      };

      const { error } = await this.supabase
        .from('error_reports')
        .insert(reportData);

      if (error) {
        console.error('Failed to store error report:', error);
        throw new Error(`Database error: ${error.message}`);
      }
    } catch (error: any) {
      console.error('Error storing error report:', error);
      throw error;
    }
  }

  /**
   * Update error aggregation stats
   */
  private async updateErrorAggregation(
    fingerprint: string,
    errorReport: ErrorReportRequest,
  ): Promise<void> {
    try {
      // Try to get existing aggregation
      const { data: existing } = await this.supabase
        .from('error_aggregations')
        .select('*')
        .eq('fingerprint', fingerprint)
        .single();

      if (existing) {
        // Update existing aggregation
        const { error } = await this.supabase
          .from('error_aggregations')
          .update({
            count: existing.count + 1,
            last_seen: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('fingerprint', fingerprint);

        if (error) {
          console.error('Failed to update error aggregation:', error);
        }
      } else {
        // Create new aggregation
        const aggregationData = {
          fingerprint,
          count: 1,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          message: errorReport.message,
          module: errorReport.module,
          severity: errorReport.severity || 'medium',
          category: errorReport.category || 'backend',
          created_at: new Date().toISOString(),
        };

        const { error } = await this.supabase
          .from('error_aggregations')
          .insert(aggregationData);

        if (error) {
          console.error('Failed to create error aggregation:', error);
        }
      }
    } catch (error: any) {
      console.error('Error updating aggregation:', error);
      // Don't throw - this is not critical for the main operation
    }
  }

  /**
   * Log error to structured logging system
   */
  private logError(errorReport: ErrorReportRequest, fingerprint: string): void {
    const logData = {
      fingerprint,
      module: errorReport.module,
      function: errorReport.function,
      severity: errorReport.severity,
      category: errorReport.category,
      userId: errorReport.userId,
      environment: errorReport.environment,
      timestamp: new Date().toISOString(),
    };

    console.log(JSON.stringify({
      level: 'error',
      message: `Error reported: ${errorReport.message}`,
      metadata: logData,
    }));
  }

  /**
   * Process error report
   */
  async processErrorReport(
    errorReport: ErrorReportRequest,
  ): Promise<{ fingerprint: string; success: boolean }> {
    const fingerprint = this.generateFingerprint(errorReport);

    try {
      // Store in database
      await this.storeErrorReport(errorReport, fingerprint);

      // Update aggregation (non-blocking)
      this.updateErrorAggregation(fingerprint, errorReport).catch((err) => {
        console.error('Background aggregation update failed:', err);
      });

      // Log error
      this.logError(errorReport, fingerprint);

      return { fingerprint, success: true };
    } catch (error: any) {
      console.error('Failed to process error report:', error);

      // At minimum, log the error even if database fails
      this.logError(errorReport, fingerprint);

      throw error;
    }
  }

  /**
   * Get error statistics
   */
  async getErrorStats(
    timeRange: { start: string; end: string },
    module?: string,
  ): Promise<ErrorStats> {
    try {
      let query = this.supabase
        .from('error_reports')
        .select('module, severity, category, created_at')
        .gte('created_at', timeRange.start)
        .lte('created_at', timeRange.end);

      if (module) {
        query = query.eq('module', module);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch error stats: ${error.message}`);
      }

      const totalErrors = data.length;
      const errorsByModule: Record<string, number> = {};
      const errorsBySeverity: Record<string, number> = {};
      const errorsByCategory: Record<string, number> = {};

      data.forEach((error: any) => {
        errorsByModule[error.module] = (errorsByModule[error.module] || 0) + 1;
        errorsBySeverity[error.severity] =
          (errorsBySeverity[error.severity] || 0) + 1;
        errorsByCategory[error.category] =
          (errorsByCategory[error.category] || 0) + 1;
      });

      return {
        totalErrors,
        errorsByModule,
        errorsBySeverity,
        errorsByCategory,
        timeRange,
      };
    } catch (error: any) {
      console.error('Error getting stats:', error);
      throw error;
    }
  }

  /**
   * Get aggregated errors
   */
  async getAggregatedErrors(
    limit = 50,
    module?: string,
  ): Promise<ErrorAggregation[]> {
    try {
      let query = this.supabase
        .from('error_aggregations')
        .select('*')
        .order('count', { ascending: false })
        .limit(limit);

      if (module) {
        query = query.eq('module', module);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch aggregated errors: ${error.message}`);
      }

      return data.map((item: any) => ({
        fingerprint: item.fingerprint,
        count: item.count,
        firstSeen: new Date(item.first_seen),
        lastSeen: new Date(item.last_seen),
        message: item.message,
        module: item.module,
        severity: item.severity,
        category: item.category,
      }));
    } catch (error: any) {
      console.error('Error getting aggregated errors:', error);
      throw error;
    }
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
  const startTime = Date.now();

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        ...securityHeaders,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers':
          'Content-Type, Authorization, X-API-Key',
      },
    });
  }

  try {
    const service = new ErrorReportingService();
    const url = new URL(req.url);
    const path = url.pathname;

    // Route handling
    if (req.method === 'POST' && path.endsWith('/report')) {
      return await handleErrorReport(req, service);
    } else if (req.method === 'GET' && path.endsWith('/stats')) {
      return await handleGetStats(req, service);
    } else if (req.method === 'GET' && path.endsWith('/aggregated')) {
      return await handleGetAggregated(req, service);
    } else {
      return new Response(
        JSON.stringify({
          error: {
            code: 'NOT_FOUND',
            message: 'Endpoint not found',
            availableEndpoints: [
              'POST /report - Submit error report',
              'GET /stats - Get error statistics',
              'GET /aggregated - Get aggregated errors',
            ],
          },
          timestamp: new Date().toISOString(),
        }),
        {
          status: 404,
          headers: securityHeaders,
        },
      );
    }
  } catch (error: any) {
    console.error('Error handling request:', error);

    return new Response(
      JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          details: Deno.env.get('NODE_ENV') === 'development'
            ? error.message
            : undefined,
        },
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: securityHeaders,
      },
    );
  }
});

/**
 * Handle error report submission
 */
async function handleErrorReport(
  req: Request,
  service: ErrorReportingService,
): Promise<Response> {
  try {
    const body = await req.json();

    // Validate request
    const validation = service['validateErrorReport'](body);
    if (!validation.isValid) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid error report',
            details: validation.errors,
          },
          timestamp: new Date().toISOString(),
        }),
        {
          status: 400,
          headers: securityHeaders,
        },
      );
    }

    // Process error report
    const result = await service.processErrorReport(body);

    return new Response(
      JSON.stringify({
        success: true,
        fingerprint: result.fingerprint,
        message: 'Error report processed successfully',
        timestamp: new Date().toISOString(),
      }),
      {
        status: 201,
        headers: {
          ...securityHeaders,
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  } catch (error: any) {
    console.error('Error processing error report:', error);

    return new Response(
      JSON.stringify({
        error: {
          code: 'PROCESSING_ERROR',
          message: 'Failed to process error report',
          details: error.message,
        },
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: securityHeaders,
      },
    );
  }
}

/**
 * Handle get error statistics
 */
async function handleGetStats(
  req: Request,
  service: ErrorReportingService,
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const start = url.searchParams.get('start') ||
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const end = url.searchParams.get('end') || new Date().toISOString();
    const module = url.searchParams.get('module') || undefined;

    const stats = await service.getErrorStats({ start, end }, module);

    return new Response(
      JSON.stringify({
        stats,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          ...securityHeaders,
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  } catch (error: any) {
    console.error('Error getting stats:', error);

    return new Response(
      JSON.stringify({
        error: {
          code: 'STATS_ERROR',
          message: 'Failed to get error statistics',
          details: error.message,
        },
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: securityHeaders,
      },
    );
  }
}

/**
 * Handle get aggregated errors
 */
async function handleGetAggregated(
  req: Request,
  service: ErrorReportingService,
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const module = url.searchParams.get('module') || undefined;

    const aggregated = await service.getAggregatedErrors(limit, module);

    return new Response(
      JSON.stringify({
        aggregated,
        count: aggregated.length,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          ...securityHeaders,
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  } catch (error: any) {
    console.error('Error getting aggregated errors:', error);

    return new Response(
      JSON.stringify({
        error: {
          code: 'AGGREGATED_ERROR',
          message: 'Failed to get aggregated errors',
          details: error.message,
        },
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: securityHeaders,
      },
    );
  }
}
