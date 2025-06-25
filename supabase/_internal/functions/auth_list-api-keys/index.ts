// - API key listing with pagination, filtering, and comprehensive metadata (secure - no plain text keys)

import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '_shared/cors.ts';

/**
 * API Key listing query parameters interface
 */
interface ListApiKeysQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: 'active' | 'expired' | 'revoked' | 'all';
  sortBy?: 'name' | 'created_at' | 'expires_at' | 'last_used';
  sortOrder?: 'asc' | 'desc';
  includeRevoked?: boolean;
}

/**
 * API Key metadata interface (secure - no sensitive data)
 */
interface ApiKeyMetadata {
  id: string;
  keyPrefix: string;
  name: string;
  description?: string;
  permissions?: string[];
  status: 'active' | 'expired' | 'revoked';
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
  revocationReason?: string;
  usageStats?: {
    totalRequests: number;
    lastRequest?: string;
    requestsThisMonth: number;
  };
  metadata?: Record<string, unknown>;
}

/**
 * Paginated API key response interface
 */
interface ListApiKeysResponse {
  apiKeys: ApiKeyMetadata[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  summary: {
    totalActive: number;
    totalExpired: number;
    totalRevoked: number;
    expiringIn7Days: number;
    neverUsed: number;
  };
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
  'Cache-Control': 'private, max-age=300', // Cache for 5 minutes
};

/**
 * Query parameter validator
 */
class QueryValidator {
  /**
   * Validate and sanitize query parameters
   */
  static validateQuery(url: URL): {
    isValid: boolean;
    errors: string[];
    sanitized: ListApiKeysQuery;
  } {
    const errors: string[] = [];
    const sanitized: ListApiKeysQuery = {};
    const params = url.searchParams;

    // Validate page
    const pageParam = params.get('page');
    if (pageParam !== null) {
      const page = parseInt(pageParam, 10);
      if (isNaN(page) || page < 1) {
        errors.push('page must be a positive integer');
      } else {
        sanitized.page = page;
      }
    } else {
      sanitized.page = 1;
    }

    // Validate limit
    const limitParam = params.get('limit');
    if (limitParam !== null) {
      const limit = parseInt(limitParam, 10);
      if (isNaN(limit) || limit < 1 || limit > 100) {
        errors.push('limit must be between 1 and 100');
      } else {
        sanitized.limit = limit;
      }
    } else {
      sanitized.limit = 20;
    }

    // Validate search
    const searchParam = params.get('search');
    if (searchParam !== null) {
      if (searchParam.length > 100) {
        errors.push('search term must be 100 characters or less');
      } else {
        sanitized.search = searchParam.trim();
      }
    }

    // Validate status
    const statusParam = params.get('status');
    if (statusParam !== null) {
      const validStatuses = ['active', 'expired', 'revoked', 'all'];
      if (!validStatuses.includes(statusParam)) {
        errors.push(`status must be one of: ${validStatuses.join(', ')}`);
      } else {
        sanitized.status = statusParam as any;
      }
    } else {
      sanitized.status = 'active';
    }

    // Validate sortBy
    const sortByParam = params.get('sortBy');
    if (sortByParam !== null) {
      const validSortFields = ['name', 'created_at', 'expires_at', 'last_used'];
      if (!validSortFields.includes(sortByParam)) {
        errors.push(`sortBy must be one of: ${validSortFields.join(', ')}`);
      } else {
        sanitized.sortBy = sortByParam as any;
      }
    } else {
      sanitized.sortBy = 'created_at';
    }

    // Validate sortOrder
    const sortOrderParam = params.get('sortOrder');
    if (sortOrderParam !== null) {
      if (!['asc', 'desc'].includes(sortOrderParam)) {
        errors.push('sortOrder must be "asc" or "desc"');
      } else {
        sanitized.sortOrder = sortOrderParam as any;
      }
    } else {
      sanitized.sortOrder = 'desc';
    }

    // Validate includeRevoked
    const includeRevokedParam = params.get('includeRevoked');
    if (includeRevokedParam !== null) {
      if (includeRevokedParam === 'true') {
        sanitized.includeRevoked = true;
      } else if (includeRevokedParam === 'false') {
        sanitized.includeRevoked = false;
      } else {
        errors.push('includeRevoked must be "true" or "false"');
      }
    } else {
      sanitized.includeRevoked = false;
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitized,
    };
  }
}

/**
 * API Key listing service
 */
class ApiKeyListingService {
  private supabase: any;

  constructor() {
    this.supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );
  }

  /**
   * Determine API key status
   */
  private determineStatus(apiKey: any): 'active' | 'expired' | 'revoked' {
    if (apiKey.revoked_at) {
      return 'revoked';
    }
    
    if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
      return 'expired';
    }
    
    return 'active';
  }

  /**
   * Build database query filters
   */
  private buildQueryFilters(query: ListApiKeysQuery, userId: string) {
    let dbQuery = this.supabase
      .from('api_keys')
      .select('*', { count: 'exact' })
      .eq('user_id', userId);

    // Filter by status
    if (query.status !== 'all') {
      if (query.status === 'revoked') {
        dbQuery = dbQuery.not('revoked_at', 'is', null);
      } else if (query.status === 'expired') {
        dbQuery = dbQuery
          .is('revoked_at', null)
          .lt('expires_at', new Date().toISOString());
      } else if (query.status === 'active') {
        dbQuery = dbQuery
          .is('revoked_at', null)
          .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
      }
    }

    // Search filter
    if (query.search) {
      dbQuery = dbQuery.or(
        `name.ilike.%${query.search}%,description.ilike.%${query.search}%,key_prefix.ilike.%${query.search}%`
      );
    }

    // Exclude revoked keys unless explicitly requested
    if (!query.includeRevoked && query.status !== 'revoked' && query.status !== 'all') {
      dbQuery = dbQuery.is('revoked_at', null);
    }

    return dbQuery;
  }

  /**
   * Apply sorting to query
   */
  private applySorting(dbQuery: any, sortBy: string, sortOrder: string) {
    const sortField = sortBy === 'last_used' ? 'updated_at' : sortBy;
    return dbQuery.order(sortField, { ascending: sortOrder === 'asc' });
  }

  /**
   * Apply pagination to query
   */
  private applyPagination(dbQuery: any, page: number, limit: number) {
    const offset = (page - 1) * limit;
    return dbQuery.range(offset, offset + limit - 1);
  }

  /**
   * Transform database record to API key metadata
   */
  private transformToMetadata(record: any): ApiKeyMetadata {
    const status = this.determineStatus(record);
    
    return {
      id: record.id,
      keyPrefix: record.key_prefix,
      name: record.name,
      description: record.description,
      permissions: record.permissions ? JSON.parse(record.permissions) : undefined,
      status,
      createdAt: record.created_at,
      expiresAt: record.expires_at,
      lastUsedAt: record.updated_at !== record.created_at ? record.updated_at : undefined,
      revokedAt: record.revoked_at,
      revocationReason: record.revocation_reason,
      usageStats: {
        totalRequests: 0, // TODO: Implement usage tracking
        requestsThisMonth: 0, // TODO: Implement usage tracking
      },
      metadata: record.metadata ? JSON.parse(record.metadata) : undefined,
    };
  }

  /**
   * Get summary statistics
   */
  async getSummaryStats(userId: string): Promise<{
    totalActive: number;
    totalExpired: number;
    totalRevoked: number;
    expiringIn7Days: number;
    neverUsed: number;
  }> {
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Get all keys for this user
    const { data: allKeys, error } = await this.supabase
      .from('api_keys')
      .select('revoked_at, expires_at, created_at, updated_at')
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to fetch summary stats: ${error.message}`);
    }

    let totalActive = 0;
    let totalExpired = 0;
    let totalRevoked = 0;
    let expiringIn7Days = 0;
    let neverUsed = 0;

    for (const key of allKeys || []) {
      if (key.revoked_at) {
        totalRevoked++;
      } else if (key.expires_at && new Date(key.expires_at) < now) {
        totalExpired++;
      } else {
        totalActive++;
        
        // Check if expiring in 7 days
        if (key.expires_at && new Date(key.expires_at) <= in7Days) {
          expiringIn7Days++;
        }
      }

      // Check if never used (updated_at equals created_at)
      if (key.updated_at === key.created_at) {
        neverUsed++;
      }
    }

    return {
      totalActive,
      totalExpired,
      totalRevoked,
      expiringIn7Days,
      neverUsed,
    };
  }

  /**
   * List API keys with pagination and filtering
   */
  async listApiKeys(userId: string, query: ListApiKeysQuery): Promise<ListApiKeysResponse> {
    // Build and execute query
    let dbQuery = this.buildQueryFilters(query, userId);
    dbQuery = this.applySorting(dbQuery, query.sortBy!, query.sortOrder!);
    dbQuery = this.applyPagination(dbQuery, query.page!, query.limit!);

    const { data: apiKeys, error, count } = await dbQuery;

    if (error) {
      throw new Error(`Failed to fetch API keys: ${error.message}`);
    }

    // Transform to metadata objects
    const transformedKeys = (apiKeys || []).map(key => this.transformToMetadata(key));

    // Calculate pagination info
    const total = count || 0;
    const totalPages = Math.ceil(total / query.limit!);
    const hasNext = query.page! < totalPages;
    const hasPrev = query.page! > 1;

    // Get summary statistics
    const summary = await this.getSummaryStats(userId);

    return {
      apiKeys: transformedKeys,
      pagination: {
        page: query.page!,
        limit: query.limit!,
        total,
        totalPages,
        hasNext,
        hasPrev,
      },
      summary,
    };
  }
}

/**
 * Main serve function
 */
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: { ...corsHeaders },
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
          ...corsHeaders,
          ...securityHeaders,
          'Allow': 'GET, OPTIONS',
        },
      }
    );
  }

  const requestId = crypto.randomUUID();

  try {
    // Initialize service
    const listingService = new ApiKeyListingService();

    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'AUTHENTICATION_ERROR',
            message: 'Missing or invalid authorization header',
          },
          timestamp: new Date().toISOString(),
          requestId,
        }),
        {
          status: 401,
          headers: { ...corsHeaders, ...securityHeaders },
        }
      );
    }

    const token = authHeader.substring(7);

    // Verify JWT and get user
    const { data: { user }, error: userError } = await listingService.supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'AUTHENTICATION_ERROR',
            message: 'Invalid or expired token',
          },
          timestamp: new Date().toISOString(),
          requestId,
        }),
        {
          status: 401,
          headers: { ...corsHeaders, ...securityHeaders },
        }
      );
    }

    // Parse and validate query parameters
    const url = new URL(req.url);
    const validation = QueryValidator.validateQuery(url);
    
    if (!validation.isValid) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: validation.errors,
          },
          timestamp: new Date().toISOString(),
          requestId,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, ...securityHeaders },
        }
      );
    }

    // List API keys
    const result = await listingService.listApiKeys(user.id, validation.sanitized);

    // Add response metadata
    const response = {
      ...result,
      _meta: {
        timestamp: new Date().toISOString(),
        requestId,
        query: validation.sanitized,
      },
    };

    return new Response(JSON.stringify(response, null, 2), {
      status: 200,
      headers: {
        ...corsHeaders,
        ...securityHeaders,
        'X-Request-ID': requestId,
        'X-Total-Count': result.pagination.total.toString(),
        'X-Page': result.pagination.page.toString(),
        'X-Per-Page': result.pagination.limit.toString(),
      },
    });

  } catch (error) {
    console.error('API key listing error:', error);

    return new Response(
      JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          details: Deno.env.get('NODE_ENV') === 'development' ? error.message : undefined,
        },
        timestamp: new Date().toISOString(),
        requestId,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, ...securityHeaders },
      }
    );
  }
});