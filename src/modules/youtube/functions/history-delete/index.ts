// Delete video from user's watch history

import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '_shared/cors.ts';

/**
 * Response interface
 */
interface DeleteHistoryResponse {
  success: boolean;
  data?: {
    message: string;
    videoId: string;
  };
  error?: {
    code: string;
    message: string;
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
async function extractUserFromRequest(request: Request): Promise<string | null> {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring(7);
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_ANON_KEY') || ''
    );

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return null;
    }

    return user.id;
  } catch (error) {
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

  // Only allow DELETE requests
  if (req.method !== 'DELETE') {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'Only DELETE method is allowed',
        },
      }),
      {
        status: 405,
        headers: {
          ...securityHeaders,
          ...corsHeaders,
          'Allow': 'DELETE, OPTIONS',
        },
      }
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
        }
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
        }
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
      .select('id')
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
        }
      );
    }

    // Delete history record
    const { error: deleteError } = await supabase
      .from('user_video_history')
      .delete()
      .eq('user_id', userId)
      .eq('video_id', video.id);

    if (deleteError) {
      // Check if record exists
      if (deleteError.code === 'PGRST116') {
        return new Response(
          JSON.stringify({
            success: false,
            error: {
              code: 'HISTORY_NOT_FOUND',
              message: 'Video not found in user history',
              details: { videoId },
            },
          }),
          {
            status: 404,
            headers: { ...securityHeaders, ...corsHeaders },
          }
        );
      }

      console.error('Failed to delete history:', deleteError);
      throw deleteError;
    }

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          message: 'Video removed from history successfully',
          videoId,
        },
      } as DeleteHistoryResponse),
      {
        status: 200,
        headers: { ...securityHeaders, ...corsHeaders },
      }
    );

  } catch (error) {
    console.error('Request failed:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      } as DeleteHistoryResponse),
      {
        status: 500,
        headers: { ...securityHeaders, ...corsHeaders },
      }
    );
  }
});