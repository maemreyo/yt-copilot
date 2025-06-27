import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import type { 
  LearningAnalyticsOverview,
  SuccessResponse, 
  ErrorResponse 
} from '_shared/types.ts';

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
async function extractUser(request: Request): Promise<{ id: string; email: string } | null> {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
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

    return {
      id: user.id,
      email: user.email || ''
    };
  } catch (error) {
    console.error('Auth error:', error);
    return null;
  }
}

// Main handler
serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  if (req.method !== 'GET') {
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only GET method allowed'
      }
    };
    
    return new Response(
      JSON.stringify(errorResponse),
      { 
        status: 405, 
        headers: { ...corsHeaders, ...securityHeaders } 
      }
    );
  }

  try {
    // Authenticate user
    const user = await extractUser(req);
    if (!user) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        }
      };
      
      return new Response(
        JSON.stringify(errorResponse),
        { 
          status: 401, 
          headers: { ...corsHeaders, ...securityHeaders } 
        }
      );
    }

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );

    // Get total videos watched (unique videos)
    const { count: totalVideosWatched } = await supabase
      .from('user_video_history')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    // Get total words learned
    const { count: totalWordsLearned } = await supabase
      .from('vocabulary_entries')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    // Get total notes taken
    const { count: totalNotesTaken } = await supabase
      .from('video_notes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    // Get total learning time from sessions
    const { data: sessions } = await supabase
      .from('learning_sessions')
      .select('duration_seconds')
      .eq('user_id', user.id)
      .not('duration_seconds', 'is', null);

    const totalLearningTime = sessions?.reduce(
      (sum, session) => sum + (session.duration_seconds || 0), 
      0
    ) || 0;

    // Calculate learning streak using the database function
    const { data: streakData } = await supabase
      .rpc('get_learning_streak', { p_user_id: user.id });
    
    const learningStreak = streakData || 0;

    // Get average session time
    const averageSessionTime = sessions && sessions.length > 0
      ? Math.round(totalLearningTime / sessions.length)
      : 0;

    // Get last activity
    const { data: lastActivity } = await supabase
      .from('learning_sessions')
      .select('started_at')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    // Prepare overview data
    const overview: LearningAnalyticsOverview = {
      total_videos_watched: totalVideosWatched || 0,
      total_words_learned: totalWordsLearned || 0,
      total_notes_taken: totalNotesTaken || 0,
      total_learning_time: totalLearningTime,
      learning_streak: learningStreak,
      average_session_time: averageSessionTime,
      last_activity_at: lastActivity?.started_at
    };

    const successResponse: SuccessResponse<LearningAnalyticsOverview> = {
      success: true,
      data: overview
    };

    return new Response(
      JSON.stringify(successResponse),
      { 
        status: 200, 
        headers: { ...corsHeaders, ...securityHeaders } 
      }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    };
    
    return new Response(
      JSON.stringify(errorResponse),
      { 
        status: 500, 
        headers: { ...corsHeaders, ...securityHeaders } 
      }
    );
  }
});