import { serve } from 'std/http/server.ts';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { createRateLimiter } from '@/rate-limiting';
import { createAppError, ErrorType } from '@/errors';
import { AuthService } from '@/auth';
import { Logger } from '@/logging';
import { SummarizeRequestSchema, type SummarizeResponse } from '../types';
import { openAIClient } from '../utils/openai-client.ts';
import { aiCacheManager } from '../utils/cache-manager.ts';

const logger = new Logger({ service: 'summarize-function' });

// Rate limiting configuration
const rateLimiterFree = createRateLimiter({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  maxRequests: parseInt(Deno.env.get('SUMMARY_RATE_LIMIT_FREE') || '5'),
  keyGenerator: (request) => {
    const auth = request.headers.get('authorization');
    return auth
      ? `summarize:${auth}`
      : `summarize:${request.headers.get('x-real-ip')}`;
  },
});

const rateLimiterPremium = createRateLimiter({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  maxRequests: parseInt(Deno.env.get('SUMMARY_RATE_LIMIT_PREMIUM') || '50'),
  keyGenerator: (request) => {
    const auth = request.headers.get('authorization');
    return auth
      ? `summarize:${auth}`
      : `summarize:${request.headers.get('x-real-ip')}`;
  },
});

const requestSchema = z.object({
  video_id: z.string().uuid(),
  summary_type: z.enum(['brief', 'detailed', 'bullet_points']),
  language: z.string().length(2).default('en'),
  custom_prompt: z.string().max(500).optional(),
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
      headers: corsHeaders,
    });
  }

  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'Only POST method allowed',
        },
      }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }

  // Authenticate user
  const authService = new AuthService();
  const { user, authType } = await authService.authenticateRequest(request);

  if (!user) {
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      }),
      {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }

  // Parse and validate request
  const body = await request.json();
  const validation = requestSchema.safeParse({
    ...body,
    user_id: user.id,
  });

  if (!validation.success) {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: validation.error.errors,
        },
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }

  const { video_id, summary_type, language, custom_prompt } = validation.data;

  // Apply rate limiting based on user tier
  const isPremium = user.subscription_tier === 'premium' ||
    user.subscription_tier === 'pro';
  const rateLimiter = isPremium ? rateLimiterPremium : rateLimiterFree;

  try {
    await rateLimiter(request);
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: isPremium
            ? `Premium rate limit exceeded: ${
              Deno.env.get('SUMMARY_RATE_LIMIT_PREMIUM')
            } summaries per day`
            : `Free rate limit exceeded: ${
              Deno.env.get('SUMMARY_RATE_LIMIT_FREE')
            } summaries per day. Upgrade to premium for more.`,
        },
      }),
      {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }

  const supabase = createClient();

  try {
    // Check cache first
    const cachedSummary = await aiCacheManager.getCachedSummary(
      video_id,
      summary_type,
      language,
    );

    if (cachedSummary) {
      const response: SummarizeResponse = {
        video_id: cachedSummary.video_id,
        summary_type: cachedSummary.summary_type as any,
        language: cachedSummary.language,
        content: cachedSummary.content,
        tokens_used: cachedSummary.tokens_used || 0,
        cached: true,
        model: cachedSummary.model,
      };

      logger.info('Returning cached summary', {
        video_id,
        summary_type,
        language,
      });

      return new Response(
        JSON.stringify({ success: true, data: response }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // Fetch video data and transcript
    const { data: video, error: videoError } = await supabase
      .from('youtube_videos')
      .select('*')
      .eq('id', video_id)
      .single();

    if (videoError || !video) {
      throw createAppError(
        ErrorType.NOT_FOUND,
        'Video not found',
        { video_id },
      );
    }

    // Check if user has access to this video
    const { data: userHistory } = await supabase
      .from('user_video_history')
      .select('id')
      .eq('video_id', video_id)
      .eq('user_id', user.id)
      .single();

    if (!userHistory) {
      throw createAppError(
        ErrorType.AUTHORIZATION_ERROR,
        'You do not have access to this video. Please analyze the video first.',
        { video_id },
      );
    }

    // Fetch transcript
    const { data: transcript, error: transcriptError } = await supabase
      .from('video_transcripts')
      .select('*')
      .eq('video_id', video_id)
      .eq('language', language)
      .single();

    if (transcriptError || !transcript) {
      // Try to fetch English transcript as fallback
      const { data: englishTranscript } = await supabase
        .from('video_transcripts')
        .select('*')
        .eq('video_id', video_id)
        .eq('language', 'en')
        .single();

      if (!englishTranscript) {
        throw createAppError(
          ErrorType.NOT_FOUND,
          'No transcript available for this video',
          { video_id, language },
        );
      }

      // Use English transcript but note that summary will be in requested language
      transcript.segments = englishTranscript.segments;
    }

    // Extract text from transcript segments
    const transcriptText = transcript.segments
      .map((segment: any) => segment.text)
      .join(' ');

    // Generate summary using OpenAI
    logger.info('Generating summary with OpenAI', {
      video_id,
      summary_type,
      language,
      transcript_length: transcriptText.length,
    });

    const { summary, tokensUsed } = await openAIClient.summarizeVideo(
      video.title,
      transcriptText,
      summary_type,
      language,
    );

    // Cache the summary
    await aiCacheManager.cacheSummary(
      video_id,
      user.id,
      summary_type,
      language,
      summary,
      Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini',
      tokensUsed,
    );

    // Log cost estimation
    const estimatedCost = openAIClient.estimateCost(tokensUsed);
    logger.info('Summary generated', {
      video_id,
      summary_type,
      language,
      tokensUsed,
      estimatedCost,
    });

    const response: SummarizeResponse = {
      video_id,
      summary_type,
      language,
      content: summary,
      tokens_used: tokensUsed,
      cached: false,
      model: Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini',
    };

    return new Response(
      JSON.stringify({ success: true, data: response }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: any) {
    logger.error('Summarization error:', error);

    // Determine error code and status based on error type
    let errorCode = 'SUMMARIZATION_FAILED';
    let statusCode = 500;
    let message = error.message || 'Failed to generate summary';

    if (error.type === ErrorType.NOT_FOUND) {
      errorCode = error.message.includes('transcript')
        ? 'TRANSCRIPT_NOT_FOUND'
        : 'VIDEO_NOT_FOUND';
      statusCode = 404;
    } else if (error.type === ErrorType.AUTHORIZATION_ERROR) {
      errorCode = 'UNAUTHORIZED';
      statusCode = 403;
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
          details: error.details,
        },
      }),
      {
        status: statusCode,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
}, {
  name: 'summarize',
  version: 'v1',
  schema: requestSchema,
  middleware: [],
  rateLimit: {
    enabled: false, // We handle rate limiting internally based on user tier
  },
});
