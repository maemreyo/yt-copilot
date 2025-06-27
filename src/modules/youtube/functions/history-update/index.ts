// Update video history (progress, bookmark, notes)

import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '@/cors';

/**
 * Request interface
 */
interface UpdateHistoryRequest {
  progressSeconds?: number;
  completed?: boolean;
  playbackRate?: number;
  isBookmarked?: boolean;
  notes?: string;
  tags?: string[];
}

/**
 * Response interface
 */
interface UpdateHistoryResponse {
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
 * Extract video ID from URL path
 */
function extractVideoIdFromPath(url: string): string | null {
  // Expected format: /v1/youtube/history/{videoId}
  const pathMatch = url.match(/\/history\/([a-zA-Z0-9_-]{11})$/);
  return pathMatch ? pathMatch[1] : null;
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

  // All fields are optional, but validate if present
  if (data.progressSeconds !== undefined) {
    if (typeof data.progressSeconds !== 'number' || data.progressSeconds < 0) {
      errors.push('progressSeconds must be a non-negative number');
    }
  }

  if (data.completed !== undefined) {
    if (typeof data.completed !== 'boolean') {
      errors.push('completed must be a boolean');
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

  if (data.isBookmarked !== undefined) {
    if (typeof data.isBookmarked !== 'boolean') {
      errors.push('isBookmarked must be a boolean');
    }
  }

  if (data.notes !== undefined) {
    if (typeof data.notes !== 'string') {
      errors.push('notes must be a string');
    } else if (data.notes.length > 5000) {
      errors.push('notes must not exceed 5000 characters');
    }
  }

  if (data.tags !== undefined) {
    if (!Array.isArray(data.tags)) {
      errors.push('tags must be an array');
    } else if (data.tags.some((tag: any) => typeof tag !== 'string')) {
      errors.push('all tags must be strings');
    } else if (data.tags.length > 20) {
      errors.push('maximum 20 tags allowed');
    }
  }

  // Check if at least one field is being updated
  const updateFields = [
    'progressSeconds',
    'completed',
    'playbackRate',
    'isBookmarked',
    'notes',
    'tags',
  ];
  const hasUpdate = updateFields.some((field) => data[field] !== undefined);

  if (!hasUpdate) {
    errors.push('At least one field must be provided for update');
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

  // Only allow PUT requests
  if (req.method !== 'PUT') {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'Only PUT method is allowed',
        },
      }),
      {
        status: 405,
        headers: {
          ...securityHeaders,
          ...corsHeaders,
          'Allow': 'PUT, OPTIONS',
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

    // Extract video ID from path
    const videoId = extractVideoIdFromPath(req.url);
    if (!videoId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'INVALID_PATH',
            message: 'Invalid video ID in path',
          },
        }),
        {
          status: 400,
          headers: { ...securityHeaders, ...corsHeaders },
        },
      );
    }

    // Parse request body
    let requestData: UpdateHistoryRequest;
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

    // First, get the video ID from youtube_videos table
    const { data: video, error: videoError } = await supabase
      .from('youtube_videos')
      .select('id, duration_seconds')
      .eq('video_id', videoId)
      .single();

    if (videoError || !video) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'VIDEO_NOT_FOUND',
            message: 'Video not found',
            details: { videoId },
          },
        }),
        {
          status: 404,
          headers: { ...securityHeaders, ...corsHeaders },
        },
      );
    }

    // Check if history record exists
    const { data: existingHistory, error: checkError } = await supabase
      .from('user_video_history')
      .select('id')
      .eq('user_id', userId)
      .eq('video_id', video.id)
      .single();

    if (checkError || !existingHistory) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'HISTORY_NOT_FOUND',
            message: 'Video not in user history',
            details: { videoId },
          },
        }),
        {
          status: 404,
          headers: { ...securityHeaders, ...corsHeaders },
        },
      );
    }

    // Build update object
    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (requestData.progressSeconds !== undefined) {
      updateData.progress_seconds = requestData.progressSeconds;

      // Auto-calculate completed if not explicitly set
      if (requestData.completed === undefined && video.duration_seconds) {
        updateData.completed =
          requestData.progressSeconds >= (video.duration_seconds * 0.95);
      }
    }

    if (requestData.completed !== undefined) {
      updateData.completed = requestData.completed;
    }

    if (requestData.playbackRate !== undefined) {
      updateData.playback_rate = requestData.playbackRate;
    }

    if (requestData.isBookmarked !== undefined) {
      updateData.is_bookmarked = requestData.isBookmarked;
    }

    if (requestData.notes !== undefined) {
      updateData.notes = requestData.notes || null;
    }

    if (requestData.tags !== undefined) {
      updateData.tags = requestData.tags;
    }

    // Update history record
    const { data: updated, error: updateError } = await supabase
      .from('user_video_history')
      .update(updateData)
      .eq('id', existingHistory.id)
      .select('id')
      .single();

    if (updateError) {
      console.error('Failed to update history:', updateError);
      throw updateError;
    }

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          message: 'History updated successfully',
          historyId: updated.id,
          videoId,
        },
      } as UpdateHistoryResponse),
      {
        status: 200,
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
      } as UpdateHistoryResponse),
      {
        status: 500,
        headers: { ...securityHeaders, ...corsHeaders },
      },
    );
  }
});
