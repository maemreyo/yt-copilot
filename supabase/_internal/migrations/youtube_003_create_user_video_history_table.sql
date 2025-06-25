/**
 * User Video History Table
 * 
 * Tracks user interactions with YouTube videos including watch progress,
 * bookmarks, and learning session data.
 * 
 * @description: Create user_video_history table for tracking user video interactions
 * @depends: youtube_001_create_youtube_videos_table
 * @module: youtube
 * @version: 1.0.0
 */

-- Create user_video_history table
CREATE TABLE IF NOT EXISTS public.user_video_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- User and video references
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES public.youtube_videos(id) ON DELETE CASCADE,
  
  -- Watch progress tracking
  progress_seconds DECIMAL(10,3) DEFAULT 0,  -- Current playback position in seconds
  total_watch_time DECIMAL(10,3) DEFAULT 0,  -- Total time spent watching this video
  completion_percentage DECIMAL(5,2) DEFAULT 0, -- Percentage of video completed (0-100)
  
  -- Watch session tracking
  first_watched_at TIMESTAMPTZ,              -- When user first started watching
  last_watched_at TIMESTAMPTZ DEFAULT NOW(), -- Last time user watched this video
  watch_session_count INTEGER DEFAULT 1,     -- Number of separate watch sessions
  
  -- User actions and preferences
  is_bookmarked BOOLEAN DEFAULT FALSE,       -- User bookmarked this video
  is_favorite BOOLEAN DEFAULT FALSE,         -- User marked as favorite
  user_rating INTEGER,                       -- User's rating (1-5 stars)
  
  -- Learning-specific tracking
  learning_focus TEXT,                       -- What user is learning from this video
  learning_goals TEXT[],                     -- Array of learning objectives
  difficulty_rating TEXT,                    -- User's perceived difficulty (easy, medium, hard)
  
  -- Interaction statistics
  pause_count INTEGER DEFAULT 0,            -- Number of times user paused
  replay_count INTEGER DEFAULT 0,           -- Number of times user replayed sections
  speed_changes INTEGER DEFAULT 0,          -- Number of playback speed changes
  
  -- Learning activities
  words_learned_count INTEGER DEFAULT 0,    -- Words learned from this video
  notes_taken_count INTEGER DEFAULT 0,      -- Notes taken during this video
  translations_requested INTEGER DEFAULT 0,  -- Translation requests made
  
  -- Video context when user interacted
  video_duration_at_time INTEGER,           -- Video duration when user first watched
  
  -- Privacy and cleanup
  is_private BOOLEAN DEFAULT TRUE,          -- Whether history is private to user
  auto_delete_after TIMESTAMPTZ,           -- Optional auto-deletion date
  
  -- System metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT user_video_history_unique_user_video UNIQUE(user_id, video_id),
  CONSTRAINT user_video_history_progress_positive CHECK (
    progress_seconds >= 0
  ),
  CONSTRAINT user_video_history_total_watch_positive CHECK (
    total_watch_time >= 0
  ),
  CONSTRAINT user_video_history_completion_valid CHECK (
    completion_percentage >= 0 AND completion_percentage <= 100
  ),
  CONSTRAINT user_video_history_rating_valid CHECK (
    user_rating IS NULL OR (user_rating >= 1 AND user_rating <= 5)
  ),
  CONSTRAINT user_video_history_session_count_positive CHECK (
    watch_session_count > 0
  ),
  CONSTRAINT user_video_history_difficulty_valid CHECK (
    difficulty_rating IS NULL OR difficulty_rating IN ('easy', 'medium', 'hard')
  )
);

-- Create indexes for performance
CREATE INDEX user_video_history_user_id_idx ON public.user_video_history(user_id);
CREATE INDEX user_video_history_video_id_idx ON public.user_video_history(video_id);
CREATE INDEX user_video_history_last_watched_idx ON public.user_video_history(user_id, last_watched_at DESC);
CREATE INDEX user_video_history_bookmarked_idx ON public.user_video_history(user_id, is_bookmarked) WHERE is_bookmarked = TRUE;
CREATE INDEX user_video_history_favorites_idx ON public.user_video_history(user_id, is_favorite) WHERE is_favorite = TRUE;
CREATE INDEX user_video_history_completion_idx ON public.user_video_history(user_id, completion_percentage DESC);
CREATE INDEX user_video_history_learning_focus_idx ON public.user_video_history(learning_focus) WHERE learning_focus IS NOT NULL;

-- Partial indexes for common queries
CREATE INDEX user_video_history_recent_progress_idx 
  ON public.user_video_history(user_id, last_watched_at DESC) 
  WHERE completion_percentage < 100;

CREATE INDEX user_video_history_completed_videos_idx
  ON public.user_video_history(user_id, last_watched_at DESC)
  WHERE completion_percentage >= 90;

-- Enable Row Level Security
ALTER TABLE public.user_video_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can only access their own video history
CREATE POLICY "Users can view their own video history"
  ON public.user_video_history
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own video history"
  ON public.user_video_history
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own video history"
  ON public.user_video_history
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own video history"
  ON public.user_video_history
  FOR DELETE
  USING (auth.uid() = user_id);

-- Allow service role full access for system operations
CREATE POLICY "Service role can manage all video history"
  ON public.user_video_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION public.handle_user_video_history_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  
  -- Auto-calculate completion percentage if progress changed
  IF OLD.progress_seconds IS DISTINCT FROM NEW.progress_seconds AND NEW.video_duration_at_time IS NOT NULL AND NEW.video_duration_at_time > 0 THEN
    NEW.completion_percentage = LEAST(100, (NEW.progress_seconds / NEW.video_duration_at_time) * 100);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_video_history_updated_at
  BEFORE UPDATE ON public.user_video_history
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_user_video_history_updated_at();

-- Create function to update watch progress
CREATE OR REPLACE FUNCTION public.update_watch_progress(
  p_user_id UUID,
  p_video_id UUID,
  p_current_time DECIMAL,
  p_video_duration INTEGER DEFAULT NULL,
  p_session_actions JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  history_id UUID;
  total_watch DECIMAL;
BEGIN
  -- Insert or update user video history
  INSERT INTO public.user_video_history (
    user_id,
    video_id,
    progress_seconds,
    video_duration_at_time,
    last_watched_at,
    watch_session_count
  )
  VALUES (
    p_user_id,
    p_video_id,
    p_current_time,
    COALESCE(p_video_duration, 0),
    NOW(),
    1
  )
  ON CONFLICT (user_id, video_id) DO UPDATE SET
    progress_seconds = GREATEST(user_video_history.progress_seconds, p_current_time),
    last_watched_at = NOW(),
    watch_session_count = user_video_history.watch_session_count + 1,
    video_duration_at_time = COALESCE(p_video_duration, user_video_history.video_duration_at_time),
    -- Update activity counters if provided
    pause_count = CASE 
      WHEN jsonb_extract_path_text(p_session_actions, 'pause_count')::INTEGER IS NOT NULL 
      THEN user_video_history.pause_count + (jsonb_extract_path_text(p_session_actions, 'pause_count')::INTEGER)
      ELSE user_video_history.pause_count
    END,
    replay_count = CASE 
      WHEN jsonb_extract_path_text(p_session_actions, 'replay_count')::INTEGER IS NOT NULL 
      THEN user_video_history.replay_count + (jsonb_extract_path_text(p_session_actions, 'replay_count')::INTEGER)
      ELSE user_video_history.replay_count
    END,
    speed_changes = CASE 
      WHEN jsonb_extract_path_text(p_session_actions, 'speed_changes')::INTEGER IS NOT NULL 
      THEN user_video_history.speed_changes + (jsonb_extract_path_text(p_session_actions, 'speed_changes')::INTEGER)
      ELSE user_video_history.speed_changes
    END
  RETURNING id INTO history_id;
  
  RETURN history_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get user's learning analytics
CREATE OR REPLACE FUNCTION public.get_user_learning_analytics(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_videos_watched', COUNT(*),
    'total_watch_time_hours', ROUND((SUM(total_watch_time) / 3600)::NUMERIC, 2),
    'average_completion_rate', ROUND(AVG(completion_percentage)::NUMERIC, 2),
    'bookmarked_videos', COUNT(*) FILTER (WHERE is_bookmarked = TRUE),
    'favorite_videos', COUNT(*) FILTER (WHERE is_favorite = TRUE),
    'videos_completed', COUNT(*) FILTER (WHERE completion_percentage >= 90),
    'total_words_learned', SUM(words_learned_count),
    'total_notes_taken', SUM(notes_taken_count),
    'total_translations', SUM(translations_requested),
    'learning_streak_days', EXTRACT(days FROM (MAX(last_watched_at) - MIN(first_watched_at))),
    'most_common_difficulty', mode() WITHIN GROUP (ORDER BY difficulty_rating),
    'average_rating', ROUND(AVG(user_rating)::NUMERIC, 2)
  ) INTO result
  FROM public.user_video_history
  WHERE user_id = p_user_id;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create view for user video dashboard
CREATE OR REPLACE VIEW public.user_video_dashboard AS
SELECT 
  uvh.user_id,
  uvh.id as history_id,
  yv.video_id as youtube_video_id,
  yv.title,
  yv.channel_name,
  yv.duration as video_duration,
  yv.thumbnail_url,
  uvh.progress_seconds,
  uvh.completion_percentage,
  uvh.last_watched_at,
  uvh.is_bookmarked,
  uvh.is_favorite,
  uvh.user_rating,
  uvh.learning_focus,
  uvh.words_learned_count,
  uvh.notes_taken_count,
  CASE 
    WHEN uvh.completion_percentage >= 90 THEN 'completed'
    WHEN uvh.completion_percentage >= 10 THEN 'in_progress'
    ELSE 'started'
  END as watch_status
FROM public.user_video_history uvh
JOIN public.youtube_videos yv ON uvh.video_id = yv.id
WHERE uvh.is_private = TRUE OR uvh.is_private = FALSE; -- Include all for now, RLS will filter

-- Add table and column comments
COMMENT ON TABLE public.user_video_history IS 'Tracks user interactions and learning progress with YouTube videos';
COMMENT ON COLUMN public.user_video_history.completion_percentage IS 'Percentage of video completed (0-100)';
COMMENT ON COLUMN public.user_video_history.learning_focus IS 'What the user is trying to learn from this video';
COMMENT ON COLUMN public.user_video_history.difficulty_rating IS 'User-perceived difficulty: easy, medium, hard';
COMMENT ON COLUMN public.user_video_history.auto_delete_after IS 'Optional automatic deletion date for privacy';

-- Grant permissions
GRANT SELECT ON public.user_video_dashboard TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_watch_progress(UUID, UUID, DECIMAL, INTEGER, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_learning_analytics(UUID) TO authenticated;