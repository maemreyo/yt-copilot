/**
 * Learning Sessions Table
 * 
 * Tracks user learning sessions with YouTube videos including activities,
 * progress metrics, and learning outcomes for analytics.
 * 
 * @description: Create learning_sessions table for tracking learning analytics
 * @depends: youtube_001_create_youtube_videos_table
 * @module: youtube
 * @version: 1.0.0
 */

-- Create learning_sessions table
CREATE TABLE IF NOT EXISTS public.learning_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- User and content references
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id UUID REFERENCES public.youtube_videos(id) ON DELETE SET NULL,
  
  -- Session timing
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,                  -- Total session duration
  active_learning_seconds INTEGER DEFAULT 0, -- Time actively learning (not paused)
  
  -- Session type and mode
  session_type TEXT NOT NULL DEFAULT 'video_learning',
  learning_mode TEXT DEFAULT 'mixed',       -- How user approached learning
  focus_area TEXT,                          -- What user focused on learning
  
  -- Learning activities during session
  activities_completed JSONB DEFAULT '{}',  -- Detailed activity tracking
  /*
  Example activities structure:
  {
    "video_watching": {
      "time_watched": 1800,
      "completion_percentage": 85.5,
      "pauses_count": 12,
      "rewinds_count": 5,
      "speed_changes": 3,
      "playback_speeds_used": ["1.0", "0.75", "1.25"]
    },
    "vocabulary_learning": {
      "words_encountered": 25,
      "words_saved": 15,
      "words_translated": 20,
      "new_words_learned": 12,
      "words_reviewed": 8
    },
    "note_taking": {
      "notes_created": 7,
      "total_note_length": 450,
      "timestamped_notes": 5,
      "note_categories": ["vocabulary", "grammar", "pronunciation"]
    },
    "ai_interactions": {
      "translations_requested": 15,
      "summaries_generated": 2,
      "content_analysis_used": 1,
      "ai_queries_count": 18
    }
  }
  */
  
  -- Learning outcomes
  words_learned_count INTEGER DEFAULT 0,    -- New words added to vocabulary
  notes_taken_count INTEGER DEFAULT 0,      -- Notes created during session
  translations_requested INTEGER DEFAULT 0,  -- Translation requests made
  summaries_generated INTEGER DEFAULT 0,    -- AI summaries generated
  
  -- Engagement metrics
  engagement_score DECIMAL(3,2) DEFAULT 0,  -- Overall engagement (0.00-1.00)
  focus_score DECIMAL(3,2) DEFAULT 0,       -- Focus level (0.00-1.00)
  productivity_score DECIMAL(3,2) DEFAULT 0, -- Learning productivity (0.00-1.00)
  
  -- Learning assessment
  difficulty_experienced TEXT DEFAULT 'medium', -- User's experience of difficulty
  learning_satisfaction INTEGER,             -- User satisfaction (1-5)
  comprehension_level DECIMAL(3,2),         -- Self-assessed comprehension (0.00-1.00)
  
  -- Goals and achievements
  learning_goals TEXT[],                     -- Goals set for this session
  goals_achieved TEXT[],                     -- Which goals were achieved
  achievement_rate DECIMAL(3,2) DEFAULT 0,  -- Percentage of goals achieved
  
  -- Context and environment
  device_type TEXT,                         -- Device used (desktop, mobile, tablet)
  learning_environment TEXT,               -- Where learning took place
  distractions_count INTEGER DEFAULT 0,    -- Self-reported distractions
  
  -- Session quality indicators
  completion_status TEXT DEFAULT 'completed', -- How session ended
  interruption_count INTEGER DEFAULT 0,    -- Number of interruptions
  break_duration_seconds INTEGER DEFAULT 0, -- Time spent on breaks
  
  -- Learning efficiency metrics
  words_per_minute DECIMAL(5,2),           -- Learning velocity
  retention_estimate DECIMAL(3,2),         -- Estimated retention rate
  
  -- Feedback and notes
  session_notes TEXT,                       -- User's notes about the session
  improvement_areas TEXT[],                 -- Areas for improvement
  
  -- System metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT learning_sessions_duration_positive CHECK (
    duration_seconds IS NULL OR duration_seconds > 0
  ),
  CONSTRAINT learning_sessions_active_learning_valid CHECK (
    active_learning_seconds >= 0 AND 
    (duration_seconds IS NULL OR active_learning_seconds <= duration_seconds)
  ),
  CONSTRAINT learning_sessions_counts_positive CHECK (
    words_learned_count >= 0 AND 
    notes_taken_count >= 0 AND 
    translations_requested >= 0 AND
    summaries_generated >= 0
  ),
  CONSTRAINT learning_sessions_scores_valid CHECK (
    (engagement_score IS NULL OR (engagement_score >= 0.00 AND engagement_score <= 1.00)) AND
    (focus_score IS NULL OR (focus_score >= 0.00 AND focus_score <= 1.00)) AND
    (productivity_score IS NULL OR (productivity_score >= 0.00 AND productivity_score <= 1.00)) AND
    (comprehension_level IS NULL OR (comprehension_level >= 0.00 AND comprehension_level <= 1.00)) AND
    (achievement_rate IS NULL OR (achievement_rate >= 0.00 AND achievement_rate <= 1.00)) AND
    (retention_estimate IS NULL OR (retention_estimate >= 0.00 AND retention_estimate <= 1.00))
  ),
  CONSTRAINT learning_sessions_satisfaction_valid CHECK (
    learning_satisfaction IS NULL OR (learning_satisfaction >= 1 AND learning_satisfaction <= 5)
  ),
  CONSTRAINT learning_sessions_session_type_valid CHECK (
    session_type IN ('video_learning', 'vocabulary_review', 'note_review', 'practice_session', 'assessment', 'mixed')
  ),
  CONSTRAINT learning_sessions_learning_mode_valid CHECK (
    learning_mode IN ('active', 'passive', 'mixed', 'focused', 'casual')
  ),
  CONSTRAINT learning_sessions_difficulty_valid CHECK (
    difficulty_experienced IN ('very_easy', 'easy', 'medium', 'hard', 'very_hard')
  ),
  CONSTRAINT learning_sessions_completion_valid CHECK (
    completion_status IN ('completed', 'interrupted', 'abandoned', 'paused')
  ),
  CONSTRAINT learning_sessions_timing_valid CHECK (
    ended_at IS NULL OR ended_at >= started_at
  )
);

-- Create indexes for performance
CREATE INDEX learning_sessions_user_id_idx ON public.learning_sessions(user_id);
CREATE INDEX learning_sessions_video_id_idx ON public.learning_sessions(video_id) WHERE video_id IS NOT NULL;
CREATE INDEX learning_sessions_started_at_idx ON public.learning_sessions(user_id, started_at DESC);
CREATE INDEX learning_sessions_session_type_idx ON public.learning_sessions(user_id, session_type);
CREATE INDEX learning_sessions_completion_idx ON public.learning_sessions(user_id, completion_status);
CREATE INDEX learning_sessions_productivity_idx ON public.learning_sessions(user_id, productivity_score DESC) WHERE productivity_score IS NOT NULL;
CREATE INDEX learning_sessions_duration_idx ON public.learning_sessions(user_id, duration_seconds DESC) WHERE duration_seconds IS NOT NULL;

-- GIN indexes for JSONB and array columns
CREATE INDEX learning_sessions_activities_gin_idx ON public.learning_sessions USING gin(activities_completed);
CREATE INDEX learning_sessions_goals_gin_idx ON public.learning_sessions USING gin(learning_goals);
CREATE INDEX learning_sessions_achieved_gin_idx ON public.learning_sessions USING gin(goals_achieved);

-- Partial indexes for analytics queries
CREATE INDEX learning_sessions_recent_completed_idx
  ON public.learning_sessions(user_id, started_at DESC)
  WHERE completion_status = 'completed' AND started_at >= NOW() - INTERVAL '30 days';

CREATE INDEX learning_sessions_high_productivity_idx
  ON public.learning_sessions(user_id, started_at DESC)
  WHERE productivity_score >= 0.70;

-- Enable Row Level Security
ALTER TABLE public.learning_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can only access their own learning sessions
CREATE POLICY "Users can view their own learning sessions"
  ON public.learning_sessions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own learning sessions"
  ON public.learning_sessions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own learning sessions"
  ON public.learning_sessions
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own learning sessions"
  ON public.learning_sessions
  FOR DELETE
  USING (auth.uid() = user_id);

-- Allow service role full access
CREATE POLICY "Service role can manage all learning sessions"
  ON public.learning_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create trigger for updated_at and calculated fields
CREATE OR REPLACE FUNCTION public.handle_learning_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  
  -- Calculate duration if session ended
  IF NEW.ended_at IS NOT NULL AND OLD.ended_at IS NULL THEN
    NEW.duration_seconds = EXTRACT(EPOCH FROM (NEW.ended_at - NEW.started_at));
  END IF;
  
  -- Calculate achievement rate
  IF NEW.learning_goals IS NOT NULL AND NEW.goals_achieved IS NOT NULL THEN
    IF array_length(NEW.learning_goals, 1) > 0 THEN
      NEW.achievement_rate = (array_length(NEW.goals_achieved, 1)::DECIMAL / array_length(NEW.learning_goals, 1));
    END IF;
  END IF;
  
  -- Calculate words per minute if applicable
  IF NEW.duration_seconds IS NOT NULL AND NEW.duration_seconds > 0 AND NEW.words_learned_count > 0 THEN
    NEW.words_per_minute = (NEW.words_learned_count::DECIMAL / NEW.duration_seconds) * 60;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER learning_sessions_updated_at
  BEFORE UPDATE ON public.learning_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_learning_sessions_updated_at();

-- Create function to start a learning session
CREATE OR REPLACE FUNCTION public.start_learning_session(
  p_user_id UUID,
  p_video_id UUID DEFAULT NULL,
  p_session_type TEXT DEFAULT 'video_learning',
  p_learning_goals TEXT[] DEFAULT NULL,
  p_focus_area TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  session_id UUID;
BEGIN
  INSERT INTO public.learning_sessions (
    user_id,
    video_id,
    session_type,
    learning_goals,
    focus_area,
    started_at
  )
  VALUES (
    p_user_id,
    p_video_id,
    p_session_type,
    p_learning_goals,
    p_focus_area,
    NOW()
  )
  RETURNING id INTO session_id;
  
  RETURN session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to end a learning session
CREATE OR REPLACE FUNCTION public.end_learning_session(
  p_session_id UUID,
  p_completion_status TEXT DEFAULT 'completed',
  p_activities JSONB DEFAULT NULL,
  p_satisfaction INTEGER DEFAULT NULL,
  p_session_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  session_summary JSONB;
BEGIN
  -- Update session end details
  UPDATE public.learning_sessions
  SET 
    ended_at = NOW(),
    completion_status = p_completion_status,
    activities_completed = COALESCE(p_activities, activities_completed),
    learning_satisfaction = p_satisfaction,
    session_notes = p_session_notes,
    -- Extract activity counts from activities_completed
    words_learned_count = COALESCE(
      (p_activities->'vocabulary_learning'->>'words_saved')::INTEGER, 
      words_learned_count
    ),
    notes_taken_count = COALESCE(
      (p_activities->'note_taking'->>'notes_created')::INTEGER,
      notes_taken_count
    ),
    translations_requested = COALESCE(
      (p_activities->'ai_interactions'->>'translations_requested')::INTEGER,
      translations_requested
    ),
    summaries_generated = COALESCE(
      (p_activities->'ai_interactions'->>'summaries_generated')::INTEGER,
      summaries_generated
    )
  WHERE id = p_session_id;
  
  -- Get session summary
  SELECT jsonb_build_object(
    'session_id', id,
    'duration_seconds', duration_seconds,
    'words_learned', words_learned_count,
    'notes_taken', notes_taken_count,
    'translations_requested', translations_requested,
    'achievement_rate', achievement_rate,
    'completion_status', completion_status
  ) INTO session_summary
  FROM public.learning_sessions
  WHERE id = p_session_id;
  
  RETURN session_summary;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get learning analytics
CREATE OR REPLACE FUNCTION public.get_learning_analytics(
  p_user_id UUID,
  p_period TEXT DEFAULT 'month' -- 'week', 'month', 'quarter', 'year', 'all'
)
RETURNS JSONB AS $$
DECLARE
  date_filter TIMESTAMPTZ;
  analytics JSONB;
BEGIN
  -- Set date filter based on period
  CASE p_period
    WHEN 'week' THEN date_filter := NOW() - INTERVAL '7 days';
    WHEN 'month' THEN date_filter := NOW() - INTERVAL '30 days';
    WHEN 'quarter' THEN date_filter := NOW() - INTERVAL '90 days';
    WHEN 'year' THEN date_filter := NOW() - INTERVAL '365 days';
    ELSE date_filter := '1900-01-01'::TIMESTAMPTZ;
  END CASE;
  
  -- Generate analytics
  SELECT jsonb_build_object(
    'period', p_period,
    'total_sessions', COUNT(*),
    'completed_sessions', COUNT(*) FILTER (WHERE completion_status = 'completed'),
    'total_learning_time', SUM(duration_seconds),
    'active_learning_time', SUM(active_learning_seconds),
    'average_session_duration', ROUND(AVG(duration_seconds)),
    'total_words_learned', SUM(words_learned_count),
    'total_notes_taken', SUM(notes_taken_count),
    'total_translations', SUM(translations_requested),
    'total_summaries', SUM(summaries_generated),
    'average_productivity', ROUND(AVG(productivity_score)::NUMERIC, 2),
    'average_engagement', ROUND(AVG(engagement_score)::NUMERIC, 2),
    'average_satisfaction', ROUND(AVG(learning_satisfaction)::NUMERIC, 2),
    'learning_streak_days', (
      SELECT COUNT(DISTINCT DATE(started_at))
      FROM public.learning_sessions
      WHERE user_id = p_user_id 
        AND started_at >= date_filter
        AND completion_status = 'completed'
    ),
    'most_productive_time', (
      SELECT EXTRACT(hour FROM started_at)::INTEGER
      FROM public.learning_sessions
      WHERE user_id = p_user_id 
        AND started_at >= date_filter
        AND productivity_score IS NOT NULL
      GROUP BY EXTRACT(hour FROM started_at)
      ORDER BY AVG(productivity_score) DESC
      LIMIT 1
    ),
    'session_types', (
      SELECT jsonb_object_agg(session_type, session_count)
      FROM (
        SELECT session_type, COUNT(*) as session_count
        FROM public.learning_sessions
        WHERE user_id = p_user_id AND started_at >= date_filter
        GROUP BY session_type
      ) session_type_counts
    ),
    'weekly_trend', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'week', week_start,
          'sessions', session_count,
          'total_time', total_time,
          'words_learned', words_learned
        ) ORDER BY week_start
      )
      FROM (
        SELECT 
          DATE_TRUNC('week', started_at) as week_start,
          COUNT(*) as session_count,
          SUM(duration_seconds) as total_time,
          SUM(words_learned_count) as words_learned
        FROM public.learning_sessions
        WHERE user_id = p_user_id 
          AND started_at >= date_filter
          AND completion_status = 'completed'
        GROUP BY DATE_TRUNC('week', started_at)
      ) weekly_data
    )
  ) INTO analytics
  FROM public.learning_sessions
  WHERE user_id = p_user_id 
    AND started_at >= date_filter;
  
  RETURN analytics;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get learning insights
CREATE OR REPLACE FUNCTION public.get_learning_insights(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  insights JSONB;
BEGIN
  SELECT jsonb_build_object(
    'learning_patterns', jsonb_build_object(
      'most_active_day', (
        SELECT EXTRACT(dow FROM started_at)::INTEGER
        FROM public.learning_sessions
        WHERE user_id = p_user_id AND started_at >= NOW() - INTERVAL '30 days'
        GROUP BY EXTRACT(dow FROM started_at)
        ORDER BY COUNT(*) DESC
        LIMIT 1
      ),
      'preferred_session_length', (
        SELECT CASE 
          WHEN AVG(duration_seconds) < 900 THEN 'short'
          WHEN AVG(duration_seconds) < 1800 THEN 'medium'
          ELSE 'long'
        END
        FROM public.learning_sessions
        WHERE user_id = p_user_id AND duration_seconds IS NOT NULL
      ),
      'learning_consistency', (
        SELECT COUNT(DISTINCT DATE(started_at))::DECIMAL / 30
        FROM public.learning_sessions
        WHERE user_id = p_user_id 
          AND started_at >= NOW() - INTERVAL '30 days'
      )
    ),
    'performance_trends', jsonb_build_object(
      'productivity_trend', (
        SELECT CASE
          WHEN recent_avg > overall_avg * 1.1 THEN 'improving'
          WHEN recent_avg < overall_avg * 0.9 THEN 'declining'
          ELSE 'stable'
        END
        FROM (
          SELECT 
            AVG(productivity_score) FILTER (WHERE started_at >= NOW() - INTERVAL '7 days') as recent_avg,
            AVG(productivity_score) as overall_avg
          FROM public.learning_sessions
          WHERE user_id = p_user_id AND productivity_score IS NOT NULL
        ) trends
      ),
      'learning_velocity', (
        SELECT ROUND(AVG(words_learned_count::DECIMAL / NULLIF(duration_seconds, 0) * 3600), 2)
        FROM public.learning_sessions
        WHERE user_id = p_user_id 
          AND duration_seconds > 0 
          AND words_learned_count > 0
      )
    ),
    'recommendations', jsonb_build_array(
      CASE 
        WHEN (SELECT AVG(productivity_score) FROM public.learning_sessions WHERE user_id = p_user_id) < 0.6 
        THEN 'Consider shorter, more focused learning sessions'
        ELSE NULL
      END,
      CASE
        WHEN (SELECT COUNT(*) FROM public.learning_sessions WHERE user_id = p_user_id AND started_at >= NOW() - INTERVAL '7 days') < 3
        THEN 'Try to maintain a consistent daily learning routine'
        ELSE NULL
      END
    )
  ) INTO insights;
  
  RETURN insights;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create view for learning session dashboard
CREATE OR REPLACE VIEW public.learning_sessions_dashboard AS
SELECT 
  ls.user_id,
  ls.id as session_id,
  ls.started_at,
  ls.ended_at,
  ls.duration_seconds,
  ls.session_type,
  ls.completion_status,
  ls.words_learned_count,
  ls.notes_taken_count,
  ls.productivity_score,
  ls.learning_satisfaction,
  yv.title as video_title,
  yv.channel_name,
  yv.video_id as youtube_video_id,
  CASE 
    WHEN ls.ended_at IS NULL THEN 'active'
    WHEN ls.completion_status = 'completed' THEN 'completed'
    ELSE 'incomplete'
  END as session_status,
  CASE
    WHEN ls.productivity_score >= 0.80 THEN 'excellent'
    WHEN ls.productivity_score >= 0.60 THEN 'good'
    WHEN ls.productivity_score >= 0.40 THEN 'fair'
    ELSE 'needs_improvement'
  END as performance_level
FROM public.learning_sessions ls
LEFT JOIN public.youtube_videos yv ON ls.video_id = yv.id;

-- Add table and column comments
COMMENT ON TABLE public.learning_sessions IS 'Tracks user learning sessions with detailed activity metrics and outcomes';
COMMENT ON COLUMN public.learning_sessions.activities_completed IS 'JSONB object containing detailed activity tracking data';
COMMENT ON COLUMN public.learning_sessions.engagement_score IS 'Overall engagement level during session (0.00-1.00)';
COMMENT ON COLUMN public.learning_sessions.productivity_score IS 'Learning productivity assessment (0.00-1.00)';
COMMENT ON COLUMN public.learning_sessions.achievement_rate IS 'Percentage of learning goals achieved (0.00-1.00)';

-- Grant permissions
GRANT SELECT ON public.learning_sessions_dashboard TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_learning_session(UUID, UUID, TEXT, TEXT[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_learning_session(UUID, TEXT, JSONB, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_learning_analytics(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_learning_insights(UUID) TO authenticated;