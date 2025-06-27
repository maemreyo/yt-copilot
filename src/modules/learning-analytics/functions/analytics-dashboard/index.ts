import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { getDueItems } from '_shared/spaced-repetition.ts';
import type { 
  LearningAnalyticsDashboard,
  VocabularyEntry,
  VideoNote,
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

// Get date range for trends (last 30 days)
function getDateRange(days: number = 30): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return { start, end };
}

// Group data by date
function groupByDate<T extends { created_at?: string; learned_at?: string; started_at?: string }>(
  items: T[],
  dateField: keyof T
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  
  items.forEach(item => {
    const dateValue = item[dateField] as string | undefined;
    if (!dateValue) return;
    
    const date = new Date(dateValue).toISOString().split('T')[0];
    const existing = grouped.get(date) || [];
    grouped.set(date, [...existing, item]);
  });
  
  return grouped;
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

    // Get date range for trends
    const { start: startDate } = getDateRange(30);

    // Fetch all necessary data in parallel
    const [
      overviewResult,
      vocabularyResult,
      sessionsResult,
      recentVideosResult,
      recentWordsResult,
      recentNotesResult,
      vocabularyStatsResult
    ] = await Promise.all([
      // Overview stats
      Promise.all([
        supabase.from('user_video_history').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('vocabulary_entries').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('video_notes').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('learning_sessions').select('duration_seconds').eq('user_id', user.id).not('duration_seconds', 'is', null),
        supabase.rpc('get_learning_streak', { p_user_id: user.id })
      ]),
      
      // Vocabulary for trends
      supabase
        .from('vocabulary_entries')
        .select('learned_at, next_review_at')
        .eq('user_id', user.id)
        .gte('learned_at', startDate.toISOString())
        .order('learned_at', { ascending: true }),
      
      // Sessions for trends
      supabase
        .from('learning_sessions')
        .select('started_at, duration_seconds')
        .eq('user_id', user.id)
        .gte('started_at', startDate.toISOString())
        .order('started_at', { ascending: true }),
      
      // Recent videos
      supabase
        .from('user_video_history')
        .select(`
          video_id,
          last_watched_at,
          youtube_videos!inner(title)
        `)
        .eq('user_id', user.id)
        .order('last_watched_at', { ascending: false })
        .limit(5),
      
      // Recent words
      supabase
        .from('vocabulary_entries')
        .select('*')
        .eq('user_id', user.id)
        .order('learned_at', { ascending: false })
        .limit(10),
      
      // Recent notes
      supabase
        .from('video_notes')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10),
      
      // Vocabulary stats
      supabase.rpc('get_vocabulary_stats', { p_user_id: user.id })
    ]);

    // Process overview data
    const [videosCount, wordsCount, notesCount, sessionsData, streakData] = overviewResult;
    const sessions = sessionsData.data || [];
    const totalLearningTime = sessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0);
    const averageSessionTime = sessions.length > 0 ? Math.round(totalLearningTime / sessions.length) : 0;

    // Process vocabulary stats
    const vocabStats = vocabularyStatsResult.data?.[0] || {
      total_words: 0,
      words_due_for_review: 0,
      average_success_rate: 0,
      words_by_difficulty: { beginner: 0, intermediate: 0, advanced: 0 }
    };

    // Generate vocabulary growth trend
    const vocabularyGrowth: Array<{ date: string; count: number }> = [];
    if (vocabularyResult.data) {
      const grouped = groupByDate(vocabularyResult.data, 'learned_at');
      let cumulativeCount = 0;
      
      // Fill in all days in the range
      const current = new Date(startDate);
      while (current <= new Date()) {
        const dateStr = current.toISOString().split('T')[0];
        const dayItems = grouped.get(dateStr) || [];
        cumulativeCount += dayItems.length;
        
        vocabularyGrowth.push({
          date: dateStr,
          count: cumulativeCount
        });
        
        current.setDate(current.getDate() + 1);
      }
    }

    // Generate session frequency trend
    const sessionFrequency: Array<{ date: string; sessions: number }> = [];
    if (sessionsResult.data) {
      const grouped = groupByDate(sessionsResult.data, 'started_at');
      
      // Group by week
      const weeklyData = new Map<string, number>();
      grouped.forEach((sessions, date) => {
        const weekStart = new Date(date);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const weekKey = weekStart.toISOString().split('T')[0];
        
        const existing = weeklyData.get(weekKey) || 0;
        weeklyData.set(weekKey, existing + sessions.length);
      });
      
      weeklyData.forEach((count, week) => {
        sessionFrequency.push({ date: week, sessions: count });
      });
    }

    // Generate learning time trend
    const learningTime: Array<{ date: string; minutes: number }> = [];
    if (sessionsResult.data) {
      const grouped = groupByDate(sessionsResult.data, 'started_at');
      
      grouped.forEach((sessions, date) => {
        const totalMinutes = sessions.reduce(
          (sum, s) => sum + Math.round((s.duration_seconds || 0) / 60),
          0
        );
        learningTime.push({ date, minutes: totalMinutes });
      });
    }

    // Generate recommendations
    const recommendations: any[] = [];
    
    // Due vocabulary review recommendation
    if (vocabStats.words_due_for_review > 0) {
      recommendations.push({
        type: 'vocabulary_review',
        message: `You have ${vocabStats.words_due_for_review} words due for review`,
        action: 'review_vocabulary'
      });
    }
    
    // Learning streak recommendation
    const streak = streakData.data || 0;
    if (streak === 0) {
      recommendations.push({
        type: 'learning_pattern',
        message: 'Start a learning session today to build your streak!',
        action: 'start_session'
      });
    } else if (streak > 7) {
      recommendations.push({
        type: 'learning_pattern',
        message: `Great job! You're on a ${streak} day learning streak!`,
        action: 'continue_streak'
      });
    }
    
    // Vocabulary difficulty recommendation
    if (vocabStats.words_by_difficulty.beginner > vocabStats.words_by_difficulty.advanced * 3) {
      recommendations.push({
        type: 'content_suggestion',
        message: 'Try learning more advanced vocabulary to challenge yourself',
        action: 'explore_advanced'
      });
    }

    // Format recent activity
    const recentVideos = recentVideosResult.data?.map(item => ({
      video_id: item.video_id,
      title: item.youtube_videos?.title,
      last_watched: item.last_watched_at
    })) || [];

    // Build dashboard response
    const dashboard: LearningAnalyticsDashboard = {
      overview: {
        total_videos_watched: videosCount.count || 0,
        total_words_learned: wordsCount.count || 0,
        total_notes_taken: notesCount.count || 0,
        total_learning_time: totalLearningTime,
        learning_streak: streak,
        average_session_time: averageSessionTime,
        last_activity_at: sessions[0]?.started_at
      },
      vocabulary_stats: {
        total: vocabStats.total_words,
        by_difficulty: vocabStats.words_by_difficulty,
        due_for_review: vocabStats.words_due_for_review,
        average_success_rate: Number(vocabStats.average_success_rate) || 0
      },
      progress_trends: {
        vocabulary_growth: vocabularyGrowth.slice(-30), // Last 30 days
        session_frequency: sessionFrequency.slice(-4), // Last 4 weeks
        learning_time: learningTime.slice(-30) // Last 30 days
      },
      recommendations,
      recent_activity: {
        recent_videos: recentVideos,
        recent_words: recentWordsResult.data || [],
        recent_notes: recentNotesResult.data || []
      }
    };

    const successResponse: SuccessResponse<LearningAnalyticsDashboard> = {
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