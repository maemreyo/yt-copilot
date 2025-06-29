// List user's video watch history

import { corsHeaders } from '@/cors';
import { denoEnv } from '@/shared-deno-env';
import { createClient } from '@supabase/supabase-js';
import { serve } from 'std/http/server.ts';

/**
 * Query parameters interface
 */
interface ListHistoryParams {
  limit?: number;
  offset?: number;
  filter?: 'all' | 'bookmarked' | 'completed' | 'in-progress';
  sortBy?: 'recent' | 'alphabetical' | 'duration';
}

/**
 * History entry interface
 */
interface VideoHistoryEntry {
  historyId: string;
  videoId: string;
  videoTitle: string;
  channelName: string;
  thumbnailUrl?: string;
  durationSeconds: number;
  progressSeconds: number;
  completed: boolean;
  isBookmarked: boolean;
  lastWatchedAt: string;
  watchCount: number;
  playbackRate: number;
  notes?: string;
  tags?: string[];
}

/**
 * Response interface
 */
interface ListHistoryResponse {
  success: boolean;
  data?: {
    history: VideoHistoryEntry[];
    total: number;
    hasMore: boolean;
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
      denoEnv.get('SUPABASE_URL') || '',
      denoEnv.get('SUPABASE_ANON_KEY') || ''
    );

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);
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
 * Parse and validate query parameters
 */
function parseQueryParams(url: URL): ListHistoryParams {
  const params: ListHistoryParams = {};

  // Parse limit (default 10, max 100)
  const limitStr = url.searchParams.get('limit');
  if (limitStr) {
    const limit = parseInt(limitStr, 10);
    params.limit = Math.min(Math.max(1, limit || 10), 100);
  } else {
    params.limit = 10;
  }

  // Parse offset (default 0)
  const offsetStr = url.searchParams.get('offset');
  if (offsetStr) {
    const offset = parseInt(offsetStr, 10);
    params.offset = Math.max(0, offset || 0);
  } else {
    params.offset = 0;
  }

  // Parse filter
  const filter = url.searchParams.get('filter');
  if (filter && ['all', 'bookmarked', 'completed', 'in-progress'].includes(filter)) {
    params.filter = filter as any;
  } else {
    params.filter = 'all';
  }

  // Parse sortBy
  const sortBy = url.searchParams.get('sortBy');
  if (sortBy && ['recent', 'alphabetical', 'duration'].includes(sortBy)) {
    params.sortBy = sortBy as any;
  } else {
    params.sortBy = 'recent';
  }

  return params;
}

/**
 * Main serve function
 */
serve(async req => {
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

  // Only allow GET requests
  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'Only GET method is allowed',
        },
      }),
      {
        status: 405,
        headers: {
          ...securityHeaders,
          ...corsHeaders,
          Allow: 'GET, OPTIONS',
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

    // Parse query parameters
    const url = new URL(req.url);
    const params = parseQueryParams(url);

    // Initialize Supabase client
    const supabaseUrl = denoEnv.get('SUPABASE_URL');
    const supabaseServiceKey = denoEnv.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Build query
    let query = supabase
      .from('user_video_history')
      .select(
        `
        id,
        progress_seconds,
        completed,
        is_bookmarked,
        last_watched_at,
        watch_count,
        playback_rate,
        notes,
        tags,
        youtube_videos!inner (
          id,
          video_id,
          title,
          channel_name,
          thumbnail_url,
          duration_seconds
        )
      `,
        { count: 'exact' }
      )
      .eq('user_id', userId);

    // Apply filters
    switch (params.filter) {
      case 'bookmarked':
        query = query.eq('is_bookmarked', true);
        break;
      case 'completed':
        query = query.eq('completed', true);
        break;
      case 'in-progress':
        query = query.eq('completed', false);
        break;
    }

    // Apply sorting
    switch (params.sortBy) {
      case 'alphabetical':
        query = query.order('youtube_videos(title)', { ascending: true });
        break;
      case 'duration':
        query = query.order('youtube_videos(duration_seconds)', {
          ascending: false,
        });
        break;
      case 'recent':
      default:
        query = query.order('last_watched_at', { ascending: false });
        break;
    }

    // Apply pagination
    query = query.range(params.offset!, params.offset! + params.limit! - 1);

    // Execute query
    const { data: history, error, count } = await query;

    if (error) {
      console.error('Failed to fetch history:', error);
      throw error;
    }

    // Transform data
    const transformedHistory: VideoHistoryEntry[] = (history || []).map(item => ({
      historyId: item.id,
      videoId: item.youtube_videos.video_id,
      videoTitle: item.youtube_videos.title,
      channelName: item.youtube_videos.channel_name,
      thumbnailUrl: item.youtube_videos.thumbnail_url,
      durationSeconds: item.youtube_videos.duration_seconds,
      progressSeconds: item.progress_seconds,
      completed: item.completed,
      isBookmarked: item.is_bookmarked,
      lastWatchedAt: item.last_watched_at,
      watchCount: item.watch_count,
      playbackRate: item.playback_rate,
      notes: item.notes,
      tags: item.tags,
    }));

    // Calculate if there are more results
    const total = count || 0;
    const hasMore = params.offset! + params.limit! < total;

    // Return response
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          history: transformedHistory,
          total,
          hasMore,
        },
      } as ListHistoryResponse),
      {
        status: 200,
        headers: { ...securityHeaders, ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error('Request failed:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      } as ListHistoryResponse),
      {
        status: 500,
        headers: { ...securityHeaders, ...corsHeaders },
      }
    );
  }
});
