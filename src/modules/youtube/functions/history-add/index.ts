// Add video to user's watch history

import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '@/cors';

/**
 * Request interface
 */
interface AddToHistoryRequest {
  videoId: string;
  progressSeconds?: number;
  playbackRate?: number;
}

/**
 * Response interface
 */
interface AddToHistoryResponse {
  success: boolean;
  data?: {
    message: string;
    historyId: string;
    videoId: string;
  };
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

/**
 * Security headers
 */
const securityHeaders = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
};

/**
 * Extract user from JWT token
 */
async function extractUserFromRequest(
  request: Request,
): Promise<string | null> {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring(7);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_ANON_KEY') || '',
    );

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return null;
    }

    return user.id;
  } catch (error: any) {
    console.error('Error extracting user from request:', error);
    return null;
  }
}

/**
 * Request validation
 */
function validateRequest(data: any): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    errors.push('Request body must be an object');
    return { isValid: false, errors };
  }

  if (!data.videoId || typeof data.videoId !== 'string') {
    errors.push('videoId is required and must be a string');
  } else if (!/^[a-zA-Z0-9_-]{11}$/.test(data.videoId)) {
    errors.push('Invalid video ID format');
  }

  if (data.progressSeconds !== undefined) {
    if (typeof data.progressSeconds !== 'number' || data.progressSeconds < 0) {
      errors.push('progressSeconds must be a non-negative number');
    }
  }

  if (data.playbackRate !== undefined) {
    if (
      typeof data.playbackRate !== 'number' ||
      data.playbackRate < 0.25 ||
      data.playbackRate > 2.0
    ) {
      errors.push('playbackRate must be between 0.25 and 2.0');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

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
        ...corsHeaders,
      },
    });
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'Only POST method is allowed',
        },
      }),
      {
        status: 405,
        headers: {
          ...securityHeaders,
          ...corsHeaders,
          'Allow': 'POST, OPTIONS',
        },
      },
    );
  }

  try {
    // Extract user ID from JWT
    const userId = await extractUserFromRequest(req);
    if (!userId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'AUTHENTICATION_ERROR',
            message: 'Authentication required',
          },
        }),
        {
          status: 401,
          headers: { ...securityHeaders, ...corsHeaders },
        },
      );
    }

    // Parse request body
    let requestData: AddToHistoryRequest;
    try {
      requestData = await req.json();
    } catch (error: any) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Invalid JSON in request body',
          },
        }),
        {
          status: 400,
          headers: { ...securityHeaders, ...corsHeaders },
        },
      );
    }

    // Validate request
    const validation = validateRequest(requestData);
    if (!validation.isValid) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request parameters',
            details: validation.errors,
          },
        }),
        {
          status: 400,
          headers: { ...securityHeaders, ...corsHeaders },
        },
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // First, ensure the video exists in our database
    const { data: video, error: videoError } = await supabase
      .from('youtube_videos')
      .select('id, duration_seconds')
      .eq('video_id', requestData.videoId)
      .single();

    if (videoError || !video) {
      // Video doesn't exist, we need to analyze it first
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'VIDEO_NOT_FOUND',
            message: 'Video not found. Please analyze the video first.',
            details: { videoId: requestData.videoId },
          },
        }),
        {
          status: 404,
          headers: { ...securityHeaders, ...corsHeaders },
        },
      );
    }

    // Check if video is completed
    let completed = false;
    if (requestData.progressSeconds && video.duration_seconds) {
      completed =
        requestData.progressSeconds >= (video.duration_seconds * 0.95);
    }

    // Upsert history record
    const { data: history, error: historyError } = await supabase
      .from('user_video_history')
      .upsert({
        user_id: userId,
        video_id: video.id,
        progress_seconds: requestData.progressSeconds || 0,
        playback_rate: requestData.playbackRate || 1.0,
        completed,
        last_watched_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,video_id',
        ignoreDuplicates: false,
      })
      .select('id')
      .single();

    if (historyError) {
      console.error('Failed to add to history:', historyError);

      // Check for specific errors
      if (historyError.code === '23505') { // Unique violation
        // Update existing record
        const { data: updateData, error: updateError } = await supabase
          .from('user_video_history')
          .update({
            progress_seconds: requestData.progressSeconds || 0,
            playback_rate: requestData.playbackRate || 1.0,
            completed,
            last_watched_at: new Date().toISOString(),
            watch_count: supabase.sql`watch_count + 1`,
          })
          .eq('user_id', userId)
          .eq('video_id', video.id)
          .select('id')
          .single();

        if (updateError) {
          throw updateError;
        }

        return new Response(
          JSON.stringify({
            success: true,
            data: {
              message: 'Video history updated successfully',
              historyId: updateData.id,
              videoId: requestData.videoId,
            },
          } as AddToHistoryResponse),
          {
            status: 200,
            headers: { ...securityHeaders, ...corsHeaders },
          },
        );
      }

      throw historyError;
    }

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          message: 'Video added to history successfully',
          historyId: history.id,
          videoId: requestData.videoId,
        },
      } as AddToHistoryResponse),
      {
        status: 201,
        headers: { ...securityHeaders, ...corsHeaders },
      },
    );
  } catch (error: any) {
    console.error('Request failed:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          details: error instanceof Error ? error.message : undefined,
        },
      } as AddToHistoryResponse),
      {
        status: 500,
        headers: { ...securityHeaders, ...corsHeaders },
      },
    );
  }
});
