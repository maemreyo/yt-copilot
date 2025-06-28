// Security utilities for Supabase Edge Functions

import { denoEnv } from './deno-env.ts';

/**
 * Standard security headers for all responses
 */
export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

/**
 * Content Security Policy for different response types
 */
export const cspHeaders = {
  api: "default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none';",
  json: "default-src 'none'; frame-ancestors 'none';",
};

/**
 * Rate limiting headers
 */
export function createRateLimitHeaders(
  limit: number,
  remaining: number,
  reset: number
): Record<string, string> {
  return {
    'X-RateLimit-Limit': limit.toString(),
    'X-RateLimit-Remaining': remaining.toString(),
    'X-RateLimit-Reset': reset.toString(),
  };
}

/**
 * Generate secure request ID
 */
export function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Validate request method
 */
export function validateHttpMethod(request: Request, allowedMethods: string[]): boolean {
  return allowedMethods.includes(request.method.toUpperCase());
}

/**
 * Extract and validate Authorization header
 */
export function extractAuthToken(request: Request): {
  token: string | null;
  type: 'Bearer' | 'ApiKey' | null;
  error?: string;
} {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader) {
    return { token: null, type: null, error: 'Missing Authorization header' };
  }

  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    return { token, type: 'Bearer' };
  }

  if (authHeader.startsWith('ApiKey ')) {
    const token = authHeader.substring(7);
    return { token, type: 'ApiKey' };
  }

  return {
    token: null,
    type: null,
    error: 'Invalid Authorization header format. Expected "Bearer <token>" or "ApiKey <key>"',
  };
}

/**
 * Sanitize request body to prevent injection attacks
 */
export function sanitizeRequestBody(body: unknown): unknown {
  if (typeof body === 'string') {
    // Basic HTML/script tag removal
    return body
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim();
  }

  if (Array.isArray(body)) {
    return body.map(item => sanitizeRequestBody(item));
  }

  if (body && typeof body === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      sanitized[key] = sanitizeRequestBody(value);
    }
    return sanitized;
  }

  return body;
}

/**
 * Validate request content type
 */
export function validateContentType(request: Request, expectedTypes: string[]): boolean {
  const contentType = request.headers.get('Content-Type');
  if (!contentType) return false;

  return expectedTypes.some(type => contentType.toLowerCase().includes(type.toLowerCase()));
}

/**
 * Create secure response with all headers
 */
export function createSecureResponse(
  body: unknown,
  status: number = 200,
  additionalHeaders: Record<string, string> = {}
): Response {
  const responseBody = typeof body === 'string' ? body : JSON.stringify(body);

  return new Response(responseBody, {
    status,
    headers: {
      ...securityHeaders,
      'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json',
      'Content-Security-Policy': cspHeaders.json,
      ...additionalHeaders,
    },
  });
}

/**
 * Log security event for monitoring
 */
export function logSecurityEvent(
  event: string,
  request: Request,
  details?: Record<string, unknown>
): void {
  const logData = {
    timestamp: new Date().toISOString(),
    event,
    method: request.method,
    url: request.url,
    userAgent: request.headers.get('User-Agent'),
    origin: request.headers.get('Origin'),
    referer: request.headers.get('Referer'),
    ...details,
  };

  console.warn(`[SECURITY] ${event}:`, JSON.stringify(logData));
}

/**
 * Check for suspicious request patterns
 */
export function detectSuspiciousActivity(request: Request): {
  isSuspicious: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const url = new URL(request.url);

  // Check for common attack patterns in URL
  const suspiciousPatterns = [
    /\.\.\//, // Directory traversal
    /<script/i, // XSS
    /union.*select/i, // SQL injection
    /javascript:/i, // JavaScript protocol
    /data:/i, // Data protocol
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(url.pathname + url.search)) {
      reasons.push(`Suspicious pattern in URL: ${pattern.source}`);
    }
  }

  // Check User-Agent
  const userAgent = request.headers.get('User-Agent');
  if (!userAgent || userAgent.length < 10) {
    reasons.push('Missing or suspicious User-Agent header');
  }

  // Check for rate limiting bypass attempts
  const xForwardedFor = request.headers.get('X-Forwarded-For');
  const xRealIp = request.headers.get('X-Real-IP');
  if (xForwardedFor && xRealIp && xForwardedFor !== xRealIp) {
    reasons.push('Potential IP spoofing attempt');
  }

  return {
    isSuspicious: reasons.length > 0,
    reasons,
  };
}

/**
 * Environment-aware security configuration
 */
export function getSecurityConfig(): {
  headers: Record<string, string>;
  csp: string;
  enableLogging: boolean;
} {
  const isProduction = denoEnv.get('NODE_ENV') === 'production';

  if (isProduction) {
    return {
      headers: {
        ...securityHeaders,
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
      },
      csp: cspHeaders.api,
      enableLogging: true,
    };
  } else {
    return {
      headers: {
        ...securityHeaders,
        'Strict-Transport-Security': 'max-age=0', // Disable HSTS in development
      },
      csp: cspHeaders.json,
      enableLogging: false,
    };
  }
}
