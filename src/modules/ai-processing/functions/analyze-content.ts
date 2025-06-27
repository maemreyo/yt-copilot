import { serve } from 'std/http/server.ts';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { createRateLimiter } from '@/rate-limiting';
import { createAppError, ErrorType } from '@/errors';
import { AuthService } from '@/auth';
import { Logger } from '@/logging';
import { AnalyzeContentRequestSchema, type AnalyzeContentResponse } from '../types';
import { openAIClient } from '../utils/openai-client.ts';
import { aiCacheManager } from '../utils/cache-manager.ts';

const logger = new Logger({ service: 'analyze-content-function' });

// Rate limiting configuration - more restrictive for analysis
const rateLimiterFree = createRateLimiter({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  maxRequests: parseInt(Deno.env.get('ANALYSIS_RATE_LIMIT_FREE') || '3'),
  keyGenerator: (request) => {
    const auth = request.headers.get('authorization');
    return auth ? `analyze:${auth}` : `analyze:${request.headers.get('x-real-ip')}`;
  }
});

const rateLimiterPremium = createRateLimiter({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  maxRequests: parseInt(Deno.env.get('ANALYSIS_RATE_LIMIT_PREMIUM') || '20'),
  keyGenerator: (request) => {
    const auth = request.headers.get('authorization');
    return auth ? `analyze:${auth}` : `analyze:${request.headers.get('x-real-ip')}`;
  }
});

const requestSchema = z.object({
  video_id: z.string().uuid(),
  analysis_type: z.enum(['fact_opinion', 'sentiment', 'bias']),
  segments: z.array(z.number()).optional()
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

  const { video_id, analysis_type, segments } = validation.data;

  // Check if user has premium features for advanced analysis
  const isPremium = user.subscription_tier === 'premium' || user.subscription_tier === 'pro';
  
  // Some analysis types might be premium-only
  if (analysis_type === 'bias' && !isPremium) {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'PREMIUM_REQUIRED',
          message: 'Bias analysis is a premium feature. Please upgrade your subscription.'
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
            ? `Premium rate limit exceeded: ${Deno.env.get('ANALYSIS_RATE_LIMIT_PREMIUM')} analyses per day`
            : `Free rate limit exceeded: ${Deno.env.get('ANALYSIS_RATE_LIMIT_FREE')} analyses per day. Upgrade to premium for more.`
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
    const cachedAnalysis = await aiCacheManager.getCachedAnalysis(
      video_id,
      analysis_type
    );

    if (cachedAnalysis && (!segments || segments.length === 0)) {
      const response: AnalyzeContentResponse = {
        video_id: cachedAnalysis.video_id,
        analysis_type: cachedAnalysis.analysis_type as any,
        analysis: cachedAnalysis.analysis_data,
        suggestions: [], // Generate fresh suggestions if needed
        tokens_used: cachedAnalysis.tokens_used || 0,
        cached: true,
        model: cachedAnalysis.model
      };

      logger.info('Returning cached analysis', { 
        video_id, 
        analysis_type 
      });

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
      .eq('user_id', user.id)
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
    let transcriptText: string;
    let selectedSegments = transcript.segments;

    if (segments && segments.length > 0) {
      // Filter to only requested segments
      selectedSegments = transcript.segments.filter((_: any, index: number) => 
        segments.includes(index)
      );
      
      if (selectedSegments.length === 0) {
        throw createAppError(
          ErrorType.VALIDATION_ERROR,
          'Invalid segment indices provided',
          { segments, totalSegments: transcript.segments.length }
        );
      }
    }

    transcriptText = selectedSegments
      .map((segment: any) => segment.text)
      .join(' ');

    // Perform content analysis using OpenAI
    logger.info('Analyzing content with OpenAI', {
      video_id,
      analysis_type,
      transcript_length: transcriptText.length,
      segment_count: selectedSegments.length
    });

    const { analysis, tokensUsed } = await openAIClient.analyzeContent(
      transcriptText,
      analysis_type,
      segments
    );

    // Generate counter-perspective suggestions for fact/opinion analysis
    let suggestions: string[] = [];
    if (analysis_type === 'fact_opinion' && isPremium) {
      // Extract main topic from video title and opinions
      const mainTopic = video.title;
      const mainOpinions = analysis.opinions
        .slice(0, 3)
        .map(op => op.text)
        .join('; ');

      if (mainOpinions) {
        const { suggestions: counterSuggestions } = await openAIClient.generateCounterPerspectives(
          mainTopic,
          mainOpinions
        );
        suggestions = counterSuggestions;
      }
    }

    // Cache the analysis (only if no specific segments were requested)
    if (!segments || segments.length === 0) {
      await aiCacheManager.cacheAnalysis(
        video_id,
        user.id,
        analysis_type,
        analysis,
        analysis.confidence_score,
        Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini',
        segments,
        tokensUsed
      );
    }

    // Log cost estimation
    const estimatedCost = openAIClient.estimateCost(tokensUsed);
    logger.info('Analysis completed', {
      video_id,
      analysis_type,
      tokensUsed,
      estimatedCost,
      facts_found: analysis.facts.length,
      opinions_found: analysis.opinions.length
    });

    const response: AnalyzeContentResponse = {
      video_id,
      analysis_type,
      analysis,
      suggestions,
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
    logger.error('Content analysis error:', error);
    
    // Determine error code and status based on error type
    let errorCode = 'ANALYSIS_FAILED';
    let statusCode = 500;
    let message = error.message || 'Failed to analyze content';
    
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
}, {
  name: 'analyze-content',
  version: 'v1',
  schema: requestSchema,
  middleware: [],
  rateLimit: {
    enabled: false // We handle rate limiting internally based on user tier
  }
});