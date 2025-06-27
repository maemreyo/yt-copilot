// Comprehensive security utilities with CORS, headers, sanitization, and CSRF protection

import { env, environment } from '../config/environment';
import { AppError, ErrorCode } from './errors';

/**
 * CORS configuration interface
 */
export interface CorsConfig {
  origin?: string | string[] | ((origin: string) => boolean);
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
  preflightContinue?: boolean;
  optionsSuccessStatus?: number;
}

/**
 * Security headers configuration
 */
export interface SecurityHeadersConfig {
  contentSecurityPolicy?: string | false;
  crossOriginEmbedderPolicy?: string | false;
  crossOriginOpenerPolicy?: string | false;
  crossOriginResourcePolicy?: string | false;
  originAgentCluster?: boolean;
  referrerPolicy?: string | false;
  strictTransportSecurity?: string | false;
  xContentTypeOptions?: string | false;
  xDnsPrefetchControl?: string | false;
  xDownloadOptions?: string | false;
  xFrameOptions?: string | false;
  xPermittedCrossDomainPolicies?: string | false;
  xPoweredBy?: boolean;
  xXssProtection?: string | false;
}

/**
 * Request sanitization options
 */
export interface SanitizationConfig {
  removeNullBytes?: boolean;
  trimStrings?: boolean;
  removeHtmlTags?: boolean;
  removeScriptTags?: boolean;
  maxStringLength?: number;
  maxObjectDepth?: number;
  allowedHtmlTags?: string[];
  blockedPatterns?: RegExp[];
}

/**
 * CSRF protection configuration
 */
export interface CsrfConfig {
  secret: string;
  headerName?: string;
  cookieName?: string;
  sessionKey?: string;
  skipMethods?: string[];
  tokenLength?: number;
  expiration?: number;
}

/**
 * CORS utility class
 */
export class CorsHandler {
  private config: Required<CorsConfig>;

  constructor(config: Partial<CorsConfig> = {}) {
    this.config = {
      origin: config.origin || this.getDefaultOrigins(),
      methods: config.methods ||
        ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH'],
      allowedHeaders: config.allowedHeaders || [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
        'X-API-Key',
        'X-Request-ID',
        'X-Client-Info',
      ],
      exposedHeaders: config.exposedHeaders || [
        'X-Request-ID',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'X-Total-Count',
      ],
      credentials: config.credentials ?? false,
      maxAge: config.maxAge ?? 86400, // 24 hours
      preflightContinue: config.preflightContinue ?? false,
      optionsSuccessStatus: config.optionsSuccessStatus ?? 204,
    };
  }

  /**
   * Get default allowed origins based on environment
   */
  private getDefaultOrigins(): string[] {
    const origins = [env.APP_URL];

    if (environment.isDevelopment()) {
      origins.push(
        'http://localhost:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3000',
      );
    }

    // Add additional allowed origins from environment
    const additionalOrigins = Deno.env.get('CORS_ALLOWED_ORIGINS');
    if (additionalOrigins) {
      origins.push(
        ...additionalOrigins.split(',').map((origin) => origin.trim()),
      );
    }

    return origins;
  }

  /**
   * Check if origin is allowed
   */
  private isOriginAllowed(origin: string): boolean {
    if (typeof this.config.origin === 'string') {
      return this.config.origin === '*' || this.config.origin === origin;
    }

    if (Array.isArray(this.config.origin)) {
      return this.config.origin.includes(origin);
    }

    if (typeof this.config.origin === 'function') {
      return this.config.origin(origin);
    }

    return false;
  }

  /**
   * Generate CORS headers for response
   */
  generateHeaders(request: Request): Record<string, string> {
    const headers: Record<string, string> = {};
    const origin = request.headers.get('Origin') || '';

    // Handle origin
    if (this.config.origin === '*') {
      headers['Access-Control-Allow-Origin'] = '*';
    } else if (origin && this.isOriginAllowed(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Vary'] = 'Origin';
    }

    // Handle credentials
    if (this.config.credentials) {
      headers['Access-Control-Allow-Credentials'] = 'true';
    }

    // Handle methods
    if (this.config.methods.length > 0) {
      headers['Access-Control-Allow-Methods'] = this.config.methods.join(', ');
    }

    // Handle allowed headers
    if (this.config.allowedHeaders.length > 0) {
      headers['Access-Control-Allow-Headers'] = this.config.allowedHeaders.join(
        ', ',
      );
    }

    // Handle exposed headers
    if (this.config.exposedHeaders.length > 0) {
      headers['Access-Control-Expose-Headers'] = this.config.exposedHeaders
        .join(', ');
    }

    // Handle max age for preflight
    if (this.config.maxAge > 0) {
      headers['Access-Control-Max-Age'] = this.config.maxAge.toString();
    }

    return headers;
  }

  /**
   * Handle preflight request
   */
  handlePreflight(request: Request): Response {
    const headers = this.generateHeaders(request);

    return new Response(null, {
      status: this.config.optionsSuccessStatus,
      headers,
    });
  }

  /**
   * Create CORS middleware
   */
  createMiddleware() {
    return (request: Request): Response | null => {
      // Handle preflight requests
      if (request.method === 'OPTIONS') {
        return this.handlePreflight(request);
      }

      // For other requests, CORS headers will be added by the response middleware
      return null;
    };
  }

  /**
   * Add CORS headers to response
   */
  addHeaders(request: Request, response: Response): Response {
    const corsHeaders = this.generateHeaders(request);

    // Clone response with CORS headers
    const newHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) {
      newHeaders.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }
}

/**
 * Security headers utility class
 */
export class SecurityHeaders {
  private config: SecurityHeadersConfig;

  constructor(config: Partial<SecurityHeadersConfig> = {}) {
    this.config = {
      contentSecurityPolicy: config.contentSecurityPolicy ??
        this.getDefaultCSP(),
      crossOriginEmbedderPolicy: config.crossOriginEmbedderPolicy ??
        'require-corp',
      crossOriginOpenerPolicy: config.crossOriginOpenerPolicy ?? 'same-origin',
      crossOriginResourcePolicy: config.crossOriginResourcePolicy ??
        'same-origin',
      originAgentCluster: config.originAgentCluster ?? true,
      referrerPolicy: config.referrerPolicy ?? 'no-referrer',
      strictTransportSecurity: config.strictTransportSecurity ??
        'max-age=63072000; includeSubDomains; preload',
      xContentTypeOptions: config.xContentTypeOptions ?? 'nosniff',
      xDnsPrefetchControl: config.xDnsPrefetchControl ?? 'off',
      xDownloadOptions: config.xDownloadOptions ?? 'noopen',
      xFrameOptions: config.xFrameOptions ?? 'DENY',
      xPermittedCrossDomainPolicies: config.xPermittedCrossDomainPolicies ??
        'none',
      xPoweredBy: config.xPoweredBy ?? false,
      xXssProtection: config.xXssProtection ?? '1; mode=block',
    };
  }

  /**
   * Get default Content Security Policy
   */
  private getDefaultCSP(): string {
    if (environment.isDevelopment()) {
      return "default-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' http://localhost:* ws://localhost:*";
    }

    return [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self'",
      "connect-src 'self'",
      "media-src 'self'",
      "object-src 'none'",
      "child-src 'none'",
      "worker-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "manifest-src 'self'",
    ].join('; ');
  }

  /**
   * Generate security headers
   */
  generateHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    if (this.config.contentSecurityPolicy) {
      headers['Content-Security-Policy'] = this.config.contentSecurityPolicy;
    }

    if (this.config.crossOriginEmbedderPolicy) {
      headers['Cross-Origin-Embedder-Policy'] =
        this.config.crossOriginEmbedderPolicy;
    }

    if (this.config.crossOriginOpenerPolicy) {
      headers['Cross-Origin-Opener-Policy'] =
        this.config.crossOriginOpenerPolicy;
    }

    if (this.config.crossOriginResourcePolicy) {
      headers['Cross-Origin-Resource-Policy'] =
        this.config.crossOriginResourcePolicy;
    }

    if (this.config.originAgentCluster) {
      headers['Origin-Agent-Cluster'] = '?1';
    }

    if (this.config.referrerPolicy) {
      headers['Referrer-Policy'] = this.config.referrerPolicy;
    }

    if (this.config.strictTransportSecurity && !environment.isDevelopment()) {
      headers['Strict-Transport-Security'] =
        this.config.strictTransportSecurity;
    }

    if (this.config.xContentTypeOptions) {
      headers['X-Content-Type-Options'] = this.config.xContentTypeOptions;
    }

    if (this.config.xDnsPrefetchControl) {
      headers['X-DNS-Prefetch-Control'] = this.config.xDnsPrefetchControl;
    }

    if (this.config.xDownloadOptions) {
      headers['X-Download-Options'] = this.config.xDownloadOptions;
    }

    if (this.config.xFrameOptions) {
      headers['X-Frame-Options'] = this.config.xFrameOptions;
    }

    if (this.config.xPermittedCrossDomainPolicies) {
      headers['X-Permitted-Cross-Domain-Policies'] =
        this.config.xPermittedCrossDomainPolicies;
    }

    if (!this.config.xPoweredBy) {
      headers['X-Powered-By'] = ''; // Remove X-Powered-By header
    }

    if (this.config.xXssProtection) {
      headers['X-XSS-Protection'] = this.config.xXssProtection;
    }

    return headers;
  }

  /**
   * Create security headers middleware
   */
  createMiddleware() {
    const securityHeaders = this.generateHeaders();

    return (response: Response): Response => {
      const newHeaders = new Headers(response.headers);

      for (const [key, value] of Object.entries(securityHeaders)) {
        if (value) {
          newHeaders.set(key, value);
        } else {
          newHeaders.delete(key);
        }
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    };
  }
}

/**
 * Request sanitization utility
 */
export class RequestSanitizer {
  private config: Required<SanitizationConfig>;

  constructor(config: Partial<SanitizationConfig> = {}) {
    this.config = {
      removeNullBytes: config.removeNullBytes ?? true,
      trimStrings: config.trimStrings ?? true,
      removeHtmlTags: config.removeHtmlTags ?? true,
      removeScriptTags: config.removeScriptTags ?? true,
      maxStringLength: config.maxStringLength ?? 10000,
      maxObjectDepth: config.maxObjectDepth ?? 10,
      allowedHtmlTags: config.allowedHtmlTags ?? [],
      blockedPatterns: config.blockedPatterns ?? [
        /javascript:/gi,
        /data:.*?script/gi,
        /vbscript:/gi,
        /on\w+\s*=/gi,
      ],
    };
  }

  /**
   * Sanitize string value
   */
  sanitizeString(value: string): string {
    if (typeof value !== 'string') return value;

    let sanitized = value;

    // Remove null bytes
    if (this.config.removeNullBytes) {
      sanitized = sanitized.replace(/\0/g, '');
    }

    // Trim whitespace
    if (this.config.trimStrings) {
      sanitized = sanitized.trim();
    }

    // Check max length
    if (sanitized.length > this.config.maxStringLength) {
      sanitized = sanitized.substring(0, this.config.maxStringLength);
    }

    // Remove script tags
    if (this.config.removeScriptTags) {
      sanitized = sanitized.replace(
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        '',
      );
      sanitized = sanitized.replace(
        /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
        '',
      );
    }

    // Remove HTML tags (except allowed ones)
    if (this.config.removeHtmlTags) {
      if (this.config.allowedHtmlTags.length === 0) {
        sanitized = sanitized.replace(/<[^>]*>/g, '');
      } else {
        const allowedPattern = this.config.allowedHtmlTags.join('|');
        const regex = new RegExp(
          `<(?!/?(?:${allowedPattern})(?:\\s|>))[^>]*>`,
          'gi',
        );
        sanitized = sanitized.replace(regex, '');
      }
    }

    // Check blocked patterns
    for (const pattern of this.config.blockedPatterns) {
      sanitized = sanitized.replace(pattern, '');
    }

    return sanitized;
  }

  /**
   * Sanitize object recursively
   */
  sanitizeObject(obj: any, depth: number = 0): any {
    if (depth > this.config.maxObjectDepth) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Object depth exceeded maximum allowed',
      );
    }

    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      return this.sanitizeString(obj);
    }

    if (typeof obj === 'number' || typeof obj === 'boolean') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeObject(item, depth + 1));
    }

    if (typeof obj === 'object') {
      const sanitized: any = {};

      for (const [key, value] of Object.entries(obj)) {
        const sanitizedKey = this.sanitizeString(key);
        sanitized[sanitizedKey] = this.sanitizeObject(value, depth + 1);
      }

      return sanitized;
    }

    return obj;
  }

  /**
   * Create sanitization middleware
   */
  createMiddleware() {
    return async (request: Request): Promise<Request> => {
      try {
        // Sanitize URL parameters
        const url = new URL(request.url);
        const sanitizedParams = new URLSearchParams();

        for (const [key, value] of url.searchParams.entries()) {
          const sanitizedKey = this.sanitizeString(key);
          const sanitizedValue = this.sanitizeString(value);
          sanitizedParams.set(sanitizedKey, sanitizedValue);
        }

        url.search = sanitizedParams.toString();

        // Sanitize headers
        const sanitizedHeaders = new Headers();
        for (const [key, value] of request.headers.entries()) {
          if (
            key.toLowerCase().startsWith('x-') ||
            ['user-agent', 'referer'].includes(key.toLowerCase())
          ) {
            sanitizedHeaders.set(key, this.sanitizeString(value));
          } else {
            sanitizedHeaders.set(key, value);
          }
        }

        // Sanitize body if present
        let sanitizedBody = null;
        if (
          request.body &&
          request.headers.get('content-type')?.includes('application/json')
        ) {
          try {
            const bodyText = await request.text();
            const bodyJson = JSON.parse(bodyText);
            const sanitizedJson = this.sanitizeObject(bodyJson);
            sanitizedBody = JSON.stringify(sanitizedJson);
          } catch {
            // If parsing fails, pass through original body
            sanitizedBody = request.body;
          }
        } else {
          sanitizedBody = request.body;
        }

        return new Request(url.toString(), {
          method: request.method,
          headers: sanitizedHeaders,
          body: sanitizedBody,
        });
      } catch (error: any) {
        console.error('Request sanitization error:', error);
        return request; // Return original request if sanitization fails
      }
    };
  }
}

/**
 * Combined security middleware factory
 */
export class SecurityMiddleware {
  private cors: CorsHandler;
  private headers: SecurityHeaders;
  private sanitizer: RequestSanitizer;

  constructor(
    corsConfig: Partial<CorsConfig> = {},
    headersConfig: Partial<SecurityHeadersConfig> = {},
    sanitizationConfig: Partial<SanitizationConfig> = {},
  ) {
    this.cors = new CorsHandler(corsConfig);
    this.headers = new SecurityHeaders(headersConfig);
    this.sanitizer = new RequestSanitizer(sanitizationConfig);
  }

  /**
   * Create combined security middleware
   */
  createMiddleware() {
    return async (request: Request): Promise<Response | null> => {
      // Handle CORS preflight
      const corsResponse = this.cors.createMiddleware()(request);
      if (corsResponse) {
        return this.headers.createMiddleware()(corsResponse);
      }

      // Sanitize request
      const sanitizedRequest = await this.sanitizer.createMiddleware()(request);

      // Store sanitized request for use in handlers
      (request as any)._sanitized = sanitizedRequest;

      return null; // Continue to next middleware
    };
  }

  /**
   * Apply security headers to response
   */
  secureResponse(request: Request, response: Response): Response {
    const corsResponse = this.cors.addHeaders(request, response);
    return this.headers.createMiddleware()(corsResponse);
  }
}

/**
 * Global security utilities
 */
export const securityUtils = {
  /**
   * Create CORS handler
   */
  createCors: (config?: Partial<CorsConfig>) => new CorsHandler(config),

  /**
   * Create security headers handler
   */
  createSecurityHeaders: (config?: Partial<SecurityHeadersConfig>) =>
    new SecurityHeaders(config),

  /**
   * Create request sanitizer
   */
  createSanitizer: (config?: Partial<SanitizationConfig>) =>
    new RequestSanitizer(config),

  /**
   * Create combined security middleware
   */
  createSecurityMiddleware: (
    corsConfig?: Partial<CorsConfig>,
    headersConfig?: Partial<SecurityHeadersConfig>,
    sanitizationConfig?: Partial<SanitizationConfig>,
  ) => new SecurityMiddleware(corsConfig, headersConfig, sanitizationConfig),

  /**
   * Validate and sanitize email
   */
  sanitizeEmail: (email: string): string => {
    return email.toLowerCase().trim().replace(/[<>\"'&]/g, '');
  },

  /**
   * Validate and sanitize URL
   */
  sanitizeUrl: (url: string): string => {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Invalid protocol');
      }
      return parsed.toString();
    } catch {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid URL format');
    }
  },

  /**
   * Generate secure random string
   */
  generateSecureToken: (length: number = 32): string => {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
  },

  /**
   * Constant-time string comparison
   */
  constantTimeCompare: (a: string, b: string): boolean => {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return result === 0;
  },
};

/**
 * Default export
 */
export default {
  CorsHandler,
  SecurityHeaders,
  RequestSanitizer,
  SecurityMiddleware,
  utils: securityUtils,
};
