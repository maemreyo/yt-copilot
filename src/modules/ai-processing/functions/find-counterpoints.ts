import { serve } from 'std/http/server.ts';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { createRateLimiter } from '@/rate-limiting';
import { createAppError, ErrorType } from '@/errors';
import { AuthService } from '@/auth';
import { Logger } from '@/logging';
import { FindCounterpointsRequestSchema, type FindCounterpointsResponse } from '../types';
import { openAIClient } from '../utils/openai-client';
import { aiCacheManager } from '../utils/cache-manager';

const logger = new Logger({ service: 'find-counterpoints-function' });

// Rate limiting configuration - more restrictive for premium features
const rateLimiterFree = createRateLimiter({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  maxRequests: parseInt(Deno.env.get('COUNTERPOINTS_RATE_LIMIT_FREE') || '1'),
  keyGenerator: (request) => {
    const auth = request.headers.get('authorization');
    return auth ? `counterpoints:${auth}` : `counterpoints:${request.headers.get('x-real-ip')}`;
  }
});

const rateLimiterPremium = createRateLimiter({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  maxRequests: parseInt(Deno.env.get('COUNTERPOINTS_RATE_LIMIT_PREMIUM') || '10'),
  keyGenerator: (request) => {
    const auth = request.headers.get('authorization');
    return auth ? `counterpoints:${auth}` : `counterpoints:${request.headers.get('x-real-ip')}`;
  }
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
  const validation = FindCounterpointsRequestSchema.safeParse({
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

  const { video_id, main_topics, original_perspective, user_id } = validation.data;

  // Check if user has premium features (counter-perspective is premium-only)
  const isPremium = user.subscription_tier === 'premium' || user.subscription_tier === 'pro';
  
  if (!isPremium) {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'PREMIUM_REQUIRED',
          message: 'Counter-perspective discovery is a premium feature. Please upgrade your subscription.'
        }
      }),
      { 
        status: 403, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }

  // Apply rate limiting
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
            ? `Premium rate limit exceeded: ${Deno.env.get('COUNTERPOINTS_RATE_LIMIT_PREMIUM')} requests per day`
            : `Free rate limit exceeded: ${Deno.env.get('COUNTERPOINTS_RATE_LIMIT_FREE')} request per day. Upgrade to premium for more.`
        }
      }),
      { 
        status: 429, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }

  const supabase = createClient();

  try {
    // Check cache first
    const cachedCounterpoints = await aiCacheManager.getCachedCounterPerspectives(video_id);

    if (cachedCounterpoints) {
      const response: FindCounterpointsResponse = {
        video_id,
        counter_perspectives: cachedCounterpoints.counter_perspectives,
        search_keywords: cachedCounterpoints.search_keywords,
        tokens_used: cachedCounterpoints.tokens_used || 0,
        cached: true,
        model: cachedCounterpoints.model
      };

      logger.info('Returning cached counter-perspectives', { video_id });

      return new Response(
        JSON.stringify({ success: true, data: response }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Fetch video data
    const { data: video, error: videoError } = await supabase
      .from('youtube_videos')
      .select('*')
      .eq('id', video_id)
      .single();

    if (videoError || !video) {
      throw createAppError(
        ErrorType.NOT_FOUND,
        'Video not found',
        { video_id }
      );
    }

    // Check if user has access to this video
    const { data: userHistory } = await supabase
      .from('user_video_history')
      .select('id')
      .eq('video_id', video_id)
      .eq('user_id', user_id)
      .single();

    if (!userHistory) {
      throw createAppError(
        ErrorType.AUTHORIZATION_ERROR,
        'You do not have access to this video. Please analyze the video first.',
        { video_id }
      );
    }

    // Fetch transcript
    const { data: transcript, error: transcriptError } = await supabase
      .from('video_transcripts')
      .select('*')
      .eq('video_id', video_id)
      .single();

    if (transcriptError || !transcript) {
      throw createAppError(
        ErrorType.NOT_FOUND,
        'No transcript available for this video',
        { video_id }
      );
    }

    // Extract text from transcript segments
    const transcriptText = transcript.segments
      .map((segment: any) => segment.text)
      .join(' ');

    // Find counter-perspectives using OpenAI
    logger.info('Finding counter-perspectives with OpenAI', {
      video_id,
      transcript_length: transcriptText.length,
      main_topics_provided: !!main_topics,
      original_perspective_provided: !!original_perspective
    });

    const { 
      counterPerspectives, 
      searchKeywords, 
      tokensUsed 
    } = await openAIClient.findCounterPerspectives(
      video.title,
      transcriptText,
      main_topics,
      original_perspective
    );

    // Extract main topics and original perspective from the response if not provided
    const extractedMainTopics = main_topics || 
      (counterPerspectives[0]?.main_topics || ['general']);
    
    const extractedOriginalPerspective = original_perspective || 
      (counterPerspectives[0]?.original_perspective || 'No clear perspective detected');

    // Cache the counter-perspectives
    await aiCacheManager.cacheCounterPerspectives(
      video_id,
      user_id,
      extractedMainTopics,
      extractedOriginalPerspective,
      counterPerspectives,
      searchKeywords,
      Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini',
      tokensUsed
    );

    // Log cost estimation
    const estimatedCost = openAIClient.estimateCost(tokensUsed);
    logger.info('Counter-perspectives generation completed', {
      video_id,
      tokensUsed,
      estimatedCost,
      perspectives_found: counterPerspectives.length
    });

    const response: FindCounterpointsResponse = {
      video_id,
      counter_perspectives: counterPerspectives,
      search_keywords: searchKeywords,
      tokens_used: tokensUsed,
      cached: false,
      model: Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini'
    };

    return new Response(
      JSON.stringify({ success: true, data: response }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: any) {
    logger.error('Counter-perspectives generation error:', error);
    
    // Determine error code and status based on error type
    let errorCode = 'COUNTERPOINTS_FAILED';
    let statusCode = 500;
    let message = error.message || 'Failed to generate counter-perspectives';
    
    if (error.type === ErrorType.NOT_FOUND) {
      errorCode = error.message.includes('transcript') ? 'TRANSCRIPT_NOT_FOUND' : 'VIDEO_NOT_FOUND';
      statusCode = 404;
    } else if (error.type === ErrorType.AUTHORIZATION_ERROR) {
      errorCode = 'UNAUTHORIZED';
      statusCode = 403;
    } else if (error.type === ErrorType.VALIDATION_ERROR) {
      errorCode = 'VALIDATION_ERROR';
      statusCode = 400;
    } else if (error.type === ErrorType.EXTERNAL_SERVICE_ERROR) {
      errorCode = 'MODEL_ERROR';
      statusCode = 503;
      message = 'AI service temporarily unavailable. Please try again later.';
    } else if (error.message?.includes('quota')) {
      errorCode = 'QUOTA_EXCEEDED';
      statusCode = 503;
      message = 'AI service quota exceeded. Please try again later.';
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: errorCode,
          message,
          details: error.details
        }
      }),
      { 
        status: statusCode, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});