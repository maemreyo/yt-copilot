import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import type {
  ErrorResponse,
  LearningAnalyticsOverview,
  SuccessResponse,
} from '../../_shared/types.ts';

// Response headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, content-type',
};

const securityHeaders = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
};

// Extract user from JWT
async function extractUser(
  request: Request,
): Promise<{ id: string; email: string } | null> {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
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

    return {
      id: user.id,
      email: user.email || '',
    };
  } catch (error: any) {
    console.error('Auth error:', error);
    return null;
  }
}

serve(async (request: Request) => {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Only allow GET
  if (request.method !== 'GET') {
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only GET method is allowed',
      },
    };

    return new Response(
      JSON.stringify(errorResponse),
      {
        status: 405,
        headers: { ...corsHeaders, ...securityHeaders },
      },
    );
  }

  try {
    // Authenticate user
    const user = await extractUser(request);
    if (!user) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or missing authentication token',
        },
      };

      return new Response(
        JSON.stringify(errorResponse),
        {
          status: 401,
          headers: { ...corsHeaders, ...securityHeaders },
        },
      );
    }

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
      { auth: { persistSession: false } },
    );

    // Get total videos watched
    const { count: totalVideos } = await supabase
      .from('user_video_history')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    // Get vocabulary statistics
    const { count: totalWords } = await supabase
      .from('vocabulary_entries')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('deleted_at', null);

    // Get notes statistics
    const { count: totalNotes } = await supabase
      .from('video_notes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('deleted_at', null);

    // Get session statistics
    const { data: sessionStats } = await supabase
      .from('learning_sessions')
      .select('duration_seconds')
      .eq('user_id', user.id);

    const totalLearningTime = sessionStats?.reduce((sum, session) =>
      sum + (session.duration_seconds || 0), 0) || 0;

    const averageSessionTime = sessionStats && sessionStats.length > 0
      ? Math.round(totalLearningTime / sessionStats.length)
      : 0;

    // Calculate learning streak
    const { data: streakData } = await supabase.rpc(
      'calculate_learning_streak',
      {
        p_user_id: user.id,
      },
    );

    // Get last activity
    const { data: lastActivity } = await supabase
      .from('learning_sessions')
      .select('started_at')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    // Build overview response
    const overview: LearningAnalyticsOverview = {
      total_videos_watched: totalVideos || 0,
      total_words_learned: totalWords || 0,
      total_notes_taken: totalNotes || 0,
      total_learning_time: totalLearningTime,
      learning_streak: streakData || 0,
      average_session_time: averageSessionTime,
      last_activity_at: lastActivity?.started_at || undefined,
    };

    // Return success response
    const successResponse: SuccessResponse = {
      success: true,
      data: overview,
    };

    return new Response(
      JSON.stringify(successResponse),
      {
        status: 200,
        headers: { ...corsHeaders, ...securityHeaders },
      },
    );
  } catch (error: any) {
    console.error('Unexpected error:', error);

    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    };

    return new Response(
      JSON.stringify(errorResponse),
      {
        status: 500,
        headers: { ...corsHeaders, ...securityHeaders },
      },
    );
  }
});
