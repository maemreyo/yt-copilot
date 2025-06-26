
import { serve } from 'std/http/server.ts';
import { z } from 'zod';
import { createRateLimiter } from '@/rate-limiting';
import { ErrorType } from '@/errors';
import { AuthService } from '@/auth';
import { TranslateRequestSchema, type TranslateResponse } from '../types';
import { translationClient, wordsAPIClient } from '../utils/translation-client';
import { aiCacheManager } from '../utils/cache-manager';

// Rate limiting configuration
const rateLimiterFree = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: parseInt(Deno.env.get('TRANSLATION_RATE_LIMIT_FREE') || '100'),
  keyGenerator: (request) => {
    const auth = request.headers.get('authorization');
    return auth ? `translate:${auth}` : `translate:${request.headers.get('x-real-ip')}`;
  }
});

const rateLimiterPremium = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: parseInt(Deno.env.get('TRANSLATION_RATE_LIMIT_PREMIUM') || '500'),
  keyGenerator: (request) => {
    const auth = request.headers.get('authorization');
    return auth ? `translate:${auth}` : `translate:${request.headers.get('x-real-ip')}`;
  }
});

const requestSchema = z.object({
  text: z.string().min(1).max(5000),
  source_lang: z.string().length(2).optional(),
  target_lang: z.string().length(2),
  context: z.string().max(500).optional()
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, content-type',
};

serve(async (request) => {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST method allowed' } 
      }),
      { 
        status: 405, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }

  // Authenticate user
  const authService = new AuthService();
  const { user, authType } = await authService.authenticateRequest(request);
  
  if (!user) {
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' } 
      }),
      { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }

  // Parse and validate request
  const body = await request.json();
  const validation = requestSchema.safeParse({
    ...body,
    user_id: user.id
  });

  if (!validation.success) {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: validation.error.errors
        }
      }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }

  const { text, source_lang, target_lang, context } = validation.data;

  // Apply rate limiting based on user tier
  const isPremium = user.subscription_tier === 'premium' || user.subscription_tier === 'pro';
  const rateLimiter = isPremium ? rateLimiterPremium : rateLimiterFree;
  
  try {
    await rateLimiter(request);
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: isPremium 
            ? `Premium rate limit exceeded: ${Deno.env.get('TRANSLATION_RATE_LIMIT_PREMIUM')} translations per hour`
            : `Free rate limit exceeded: ${Deno.env.get('TRANSLATION_RATE_LIMIT_FREE')} translations per hour`
        }
      }),
      { 
        status: 429, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }

  try {
    // Check cache first
    const cachedTranslation = await aiCacheManager.getCachedTranslation(
      text,
      source_lang || 'auto',
      target_lang,
      'google' // Or detect provider from env
    );

    if (cachedTranslation) {
      // Get definitions from WordsAPI if it's a single word
      const isSingleWord = text.split(' ').length === 1;
      const definitions = isSingleWord 
        ? await wordsAPIClient.getDefinitions(text)
        : undefined;
      const pronunciation = isSingleWord
        ? await wordsAPIClient.getPronunciation(text)
        : undefined;

      const response: TranslateResponse = {
        original_text: cachedTranslation.original_text,
        translated_text: cachedTranslation.translated_text,
        source_lang: cachedTranslation.source_lang,
        target_lang: cachedTranslation.target_lang,
        definitions,
        pronunciation,
        cached: true,
        provider: cachedTranslation.provider as any
      };

      return new Response(
        JSON.stringify({ success: true, data: response }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Perform translation
    const translationResult = await translationClient.translate(
      text,
      target_lang,
      source_lang
    );

    // Get additional data for single words
    const isSingleWord = text.split(' ').length === 1;
    const definitions = isSingleWord 
      ? await wordsAPIClient.getDefinitions(text)
      : undefined;
    const pronunciation = isSingleWord
      ? await wordsAPIClient.getPronunciation(text)
      : undefined;

    // Cache the translation
    await aiCacheManager.cacheTranslation(
      user.id,
      text,
      translationResult.translatedText,
      translationResult.detectedSourceLang || source_lang || 'auto',
      target_lang,
      translationResult.provider,
      context
    );

    const response: TranslateResponse = {
      original_text: text,
      translated_text: translationResult.translatedText,
      source_lang: translationResult.detectedSourceLang || source_lang || 'auto',
      target_lang,
      definitions,
      pronunciation,
      cached: false,
      provider: translationResult.provider as any
    };

    return new Response(
      JSON.stringify({ success: true, data: response }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: any) {
    console.error('Translation error:', error);
    
    // Determine error code based on error type
    let errorCode = 'TRANSLATION_FAILED';
    let statusCode = 500;
    
    if (error.type === ErrorType.EXTERNAL_SERVICE_ERROR) {
      errorCode = 'EXTERNAL_SERVICE_ERROR';
      statusCode = 503;
    } else if (error.type === ErrorType.VALIDATION_ERROR) {
      errorCode = 'INVALID_LANGUAGE';
      statusCode = 400;
    } else if (error.type === ErrorType.CONFIGURATION_ERROR) {
      errorCode = 'CONFIGURATION_ERROR';
      statusCode = 500;
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: errorCode,
          message: error.message || 'Translation failed',
          details: error.details
        }
      }),
      { 
        status: statusCode, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
}, {
  name: 'translate',
  version: 'v1',
  schema: requestSchema,
  middleware: [],
  rateLimit: {
    enabled: false // We handle rate limiting internally based on user tier
  }
});