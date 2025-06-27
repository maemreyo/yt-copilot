import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import type { 
  LearningAnalyticsDashboard,
  LearningAnalyticsOverview,
  SuccessResponse, 
  ErrorResponse 
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

// Get date ranges for trend analysis
function getDateRanges() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  return {
    now: now.toISOString(),
    thirtyDaysAgo: thirtyDaysAgo.toISOString(),
    sevenDaysAgo: sevenDaysAgo.toISOString()
  };
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
        message: 'Only GET method is allowed'
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
    const user = await extractUser(request);
    if (!user) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or missing authentication token'
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
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
      { auth: { persistSession: false } }
    );

    const dates = getDateRanges();

    // 1. Get Overview Statistics
    const { count: totalVideos } = await supabase
      .from('user_video_history')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    const { count: totalWords } = await supabase
      .from('vocabulary_entries')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('deleted_at', null);

    const { count: totalNotes } = await supabase
      .from('video_notes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('deleted_at', null);

    const { data: sessionStats } = await supabase
      .from('learning_sessions')
      .select('duration_seconds, started_at')
      .eq('user_id', user.id);

    const totalLearningTime = sessionStats?.reduce((sum, session) => 
      sum + (session.duration_seconds || 0), 0
    ) || 0;

    const averageSessionTime = sessionStats && sessionStats.length > 0
      ? Math.round(totalLearningTime / sessionStats.length)
      : 0;

    const { data: streakData } = await supabase.rpc('calculate_learning_streak', {
      p_user_id: user.id
    });

    const lastActivity = sessionStats && sessionStats.length > 0
      ? sessionStats.sort((a, b) => 
          new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
        )[0].started_at
      : undefined;

    const overview: LearningAnalyticsOverview = {
      total_videos_watched: totalVideos || 0,
      total_words_learned: totalWords || 0,
      total_notes_taken: totalNotes || 0,
      total_learning_time: totalLearningTime,
      learning_streak: streakData || 0,
      average_session_time: averageSessionTime,
      last_activity_at: lastActivity
    };

    // 2. Get Vocabulary Statistics
    const { data: vocabularyByDifficulty } = await supabase
      .from('vocabulary_entries')
      .select('difficulty')
      .eq('user_id', user.id)
      .is('deleted_at', null);

    const difficultyCount = {
      beginner: 0,
      intermediate: 0,
      advanced: 0
    };

    vocabularyByDifficulty?.forEach(entry => {
      if (entry.difficulty && entry.difficulty in difficultyCount) {
        difficultyCount[entry.difficulty as keyof typeof difficultyCount]++;
      }
    });

    const { count: dueForReview } = await supabase
      .from('vocabulary_entries')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .lte('next_review_at', dates.now);

    const { data: successRates } = await supabase
      .from('vocabulary_entries')
      .select('success_rate')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .gt('review_count', 0);

    const averageSuccessRate = successRates && successRates.length > 0
      ? successRates.reduce((sum, entry) => sum + (entry.success_rate || 0), 0) / successRates.length
      : 0;

    // 3. Get Progress Trends (Last 30 days)
    const { data: vocabularyGrowth } = await supabase
      .from('vocabulary_entries')
      .select('learned_at')
      .eq('user_id', user.id)
      .gte('learned_at', dates.thirtyDaysAgo)
      .order('learned_at');

    // Group by date
    const vocabularyByDate = new Map<string, number>();
    vocabularyGrowth?.forEach(entry => {
      const date = new Date(entry.learned_at).toISOString().split('T')[0];
      vocabularyByDate.set(date, (vocabularyByDate.get(date) || 0) + 1);
    });

    // Create cumulative growth
    let cumulativeCount = totalWords! - (vocabularyGrowth?.length || 0);
    const vocabularyTrend = Array.from(vocabularyByDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => {
        cumulativeCount += count;
        return { date, count: cumulativeCount };
      });

    // Session frequency by week
    const { data: sessionsByWeek } = await supabase
      .from('learning_sessions')
      .select('started_at')
      .eq('user_id', user.id)
      .gte('started_at', dates.thirtyDaysAgo)
      .order('started_at');

    const sessionFrequency = new Map<string, number>();
    sessionsByWeek?.forEach(session => {
      const date = new Date(session.started_at);
      const week = `${date.getFullYear()}-W${Math.ceil((date.getDate() + 6 - date.getDay()) / 7).toString().padStart(2, '0')}`;
      sessionFrequency.set(week, (sessionFrequency.get(week) || 0) + 1);
    });

    const sessionTrend = Array.from(sessionFrequency.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, sessions]) => ({ date, sessions }));

    // Learning time by day
    const learningTimeByDay = new Map<string, number>();
    sessionStats?.forEach(session => {
      if (new Date(session.started_at) >= new Date(dates.thirtyDaysAgo)) {
        const date = new Date(session.started_at).toISOString().split('T')[0];
        const minutes = Math.round((session.duration_seconds || 0) / 60);
        learningTimeByDay.set(date, (learningTimeByDay.get(date) || 0) + minutes);
      }
    });

    const learningTimeTrend = Array.from(learningTimeByDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, minutes]) => ({ date, minutes }));

    // 4. Generate Recommendations
    const recommendations = [];

    if (dueForReview && dueForReview > 0) {
      recommendations.push({
        type: 'vocabulary_review' as const,
        message: `You have ${dueForReview} words due for review`,
        action: 'review_vocabulary'
      });
    }

    if (streakData === 0) {
      recommendations.push({
        type: 'learning_pattern' as const,
        message: 'Start a learning streak by studying every day',
        action: 'start_session'
      });
    } else if (streakData && streakData >= 7) {
      recommendations.push({
        type: 'learning_pattern' as const,
        message: `Great job! You've maintained a ${streakData}-day learning streak`,
        action: 'continue_streak'
      });
    }

    if (averageSuccessRate < 0.7 && successRates && successRates.length > 10) {
      recommendations.push({
        type: 'vocabulary_review' as const,
        message: 'Your vocabulary success rate is low. Consider reviewing more frequently',
        action: 'adjust_difficulty'
      });
    }

    // 5. Get Recent Activity
    const { data: recentVideos } = await supabase
      .from('user_video_history')
      .select(`
        video_id,
        last_watched_at,
        youtube_videos!inner(title, channel_name, duration)
      `)
      .eq('user_id', user.id)
      .order('last_watched_at', { ascending: false })
      .limit(5);

    const { data: recentWords } = await supabase
      .from('vocabulary_entries')
      .select('word, learned_at')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('learned_at', { ascending: false })
      .limit(10);

    // Build dashboard response
    const dashboard: LearningAnalyticsDashboard = {
      overview,
      vocabulary_stats: {
        total: totalWords || 0,
        by_difficulty: difficultyCount,
        due_for_review: dueForReview || 0,
        average_success_rate: Math.round(averageSuccessRate * 100) / 100
      },
      progress_trends: {
        vocabulary_growth: vocabularyTrend,
        session_frequency: sessionTrend,
        learning_time: learningTimeTrend
      },
      recommendations,
      recent_activity: {
        recent_videos: recentVideos?.map(item => ({
          video_id: item.video_id,
          title: item.youtube_videos.title,
          channel_name: item.youtube_videos.channel_name,
          last_watched_at: item.last_watched_at
        })) || [],
        recent_words: recentWords || []
      }
    };

    // Return success response
    const successResponse: SuccessResponse = {
      success: true,
      data: dashboard
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