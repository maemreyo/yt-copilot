// ENHANCED: Global CORS configuration for all Supabase Edge Functions

/**
 * Basic CORS headers for all Edge Functions
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Max-Age': '86400', // 24 hours
};

/**
 * Enhanced CORS headers with additional security and monitoring
 */
export const secureCorsHeaders = {
  ...corsHeaders,
  'Access-Control-Expose-Headers': 'x-request-id, x-rate-limit-remaining, x-rate-limit-reset',
  'Vary': 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
};

/**
 * Create CORS response for OPTIONS requests
 */
export function createCorsResponse(
  status: number = 200, 
  additionalHeaders: Record<string, string> = {}
): Response {
  return new Response(null, {
    status,
    headers: {
      ...secureCorsHeaders,
      ...additionalHeaders,
    },
  });
}

/**
 * Add CORS headers to existing response
 */
export function addCorsHeaders(
  response: Response, 
  secure: boolean = true
): Response {
  const headers = secure ? secureCorsHeaders : corsHeaders;
  
  // Clone response with CORS headers
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      ...Object.fromEntries(response.headers.entries()),
      ...headers,
    },
  });
}

/**
 * Validate CORS origin for production environments
 */
export function validateOrigin(
  origin: string | null, 
  allowedOrigins: string[]
): boolean {
  if (!origin) return false;
  
  // In development, allow localhost and related
  const isDevelopment = Deno.env.get('DENO_ENV') === 'development' || 
                       Deno.env.get('NODE_ENV') === 'development';
  
  if (isDevelopment) {
    // Allow localhost with any port
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return true;
    }
    
    // Allow Supabase local development
    if (origin.includes('supabase.co') || origin.includes('supabase.com')) {
      return true;
    }
  }
  
  return allowedOrigins.includes(origin);
}

/**
 * Create origin-specific CORS headers (for production with allowed origins)
 */
export function createOriginSpecificCorsHeaders(
  origin: string | null, 
  allowedOrigins: string[]
): Record<string, string> {
  const isValidOrigin = validateOrigin(origin, allowedOrigins);
  
  return {
    'Access-Control-Allow-Origin': isValidOrigin && origin ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'x-request-id, x-rate-limit-remaining',
    'Vary': 'Origin',
  };
}

/**
 * Create comprehensive error response with CORS
 */
export function createCorsErrorResponse(
  message: string,
  status: number = 400,
  requestId?: string,
  details?: Record<string, unknown>
): Response {
  const errorBody = {
    error: {
      message,
      status,
      timestamp: new Date().toISOString(),
      ...(requestId && { requestId }),
      ...(details && { details }),
    },
  };

  return new Response(JSON.stringify(errorBody), {
    status,
    headers: {
      ...secureCorsHeaders,
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      ...(requestId && { 'X-Request-ID': requestId }),
    },
  });
}

/**
 * Create comprehensive success response with CORS
 */
export function createCorsSuccessResponse(
  data: unknown,
  status: number = 200,
  requestId?: string,
  additionalHeaders: Record<string, string> = {}
): Response {
  const responseBody = {
    ...data,
    timestamp: new Date().toISOString(),
    ...(requestId && { requestId }),
  };

  return new Response(JSON.stringify(responseBody), {
    status,
    headers: {
      ...secureCorsHeaders,
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      ...(requestId && { 'X-Request-ID': requestId }),
      ...additionalHeaders,
    },
  });
}

/**
 * CORS middleware factory for request validation
 */
export function createCorsMiddleware(allowedOrigins?: string[]) {
  return (request: Request): Response | null => {
    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      if (allowedOrigins && allowedOrigins.length > 0) {
        const origin = request.headers.get('Origin');
        const corsHeaders = createOriginSpecificCorsHeaders(origin, allowedOrigins);
        return new Response(null, { status: 200, headers: corsHeaders });
      } else {
        return createCorsResponse();
      }
    }
    
    // For non-preflight requests, return null to continue processing
    return null;
  };
}

/**
 * Environment-aware CORS configuration
 */
export function getEnvironmentCorsConfig(): {
  headers: Record<string, string>;
  allowedOrigins: string[];
} {
  const isProduction = Deno.env.get('NODE_ENV') === 'production';
  const appUrl = Deno.env.get('APP_URL') || 'http://localhost:3000';
  
  if (isProduction) {
    // Production: restrictive CORS
    const allowedOrigins = [
      appUrl,
      // Add other production domains here
    ];
    
    return {
      headers: createOriginSpecificCorsHeaders(appUrl, allowedOrigins),
      allowedOrigins,
    };
  } else {
    // Development: permissive CORS
    return {
      headers: secureCorsHeaders,
      allowedOrigins: [], // Empty array means use permissive headers
    };
  }
}