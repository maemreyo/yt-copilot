-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- Vocabulary Entries Table
-- ============================================

CREATE TABLE IF NOT EXISTS vocabulary_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  word TEXT NOT NULL,
  definition TEXT NOT NULL,
  context TEXT,
  video_id UUID REFERENCES youtube_videos(id) ON DELETE SET NULL,
  timestamp DECIMAL,
  difficulty TEXT DEFAULT 'intermediate' CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  part_of_speech TEXT,
  learned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  next_review_at TIMESTAMP WITH TIME ZONE,
  review_count INTEGER DEFAULT 0 NOT NULL,
  success_rate DECIMAL DEFAULT 0 CHECK (success_rate >= 0 AND success_rate <= 1),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Indexes for vocabulary_entries
CREATE INDEX idx_vocabulary_user_id ON vocabulary_entries(user_id);
CREATE INDEX idx_vocabulary_next_review ON vocabulary_entries(user_id, next_review_at);
CREATE INDEX idx_vocabulary_video_id ON vocabulary_entries(video_id);
CREATE INDEX idx_vocabulary_word ON vocabulary_entries(word);
CREATE INDEX idx_vocabulary_learned_at ON vocabulary_entries(learned_at DESC);

-- Unique constraint to prevent duplicate entries
ALTER TABLE vocabulary_entries 
  ADD CONSTRAINT unique_vocabulary_user_word_context 
  UNIQUE (user_id, word, context);

-- ============================================
-- Learning Sessions Table
-- ============================================

CREATE TABLE IF NOT EXISTS learning_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  video_id UUID REFERENCES youtube_videos(id) ON DELETE SET NULL,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  ended_at TIMESTAMP WITH TIME ZONE,
  duration_seconds INTEGER GENERATED ALWAYS AS (
    CASE 
      WHEN ended_at IS NOT NULL 
      THEN EXTRACT(EPOCH FROM (ended_at - started_at))::INTEGER
      ELSE NULL
    END
  ) STORED,
  words_learned INTEGER DEFAULT 0 NOT NULL,
  notes_taken INTEGER DEFAULT 0 NOT NULL,
  translations_requested INTEGER DEFAULT 0 NOT NULL,
  session_type TEXT NOT NULL CHECK (session_type IN ('video_learning', 'vocabulary_review', 'note_review')),
  session_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Indexes for learning_sessions
CREATE INDEX idx_sessions_user_id ON learning_sessions(user_id);
CREATE INDEX idx_sessions_started_at ON learning_sessions(user_id, started_at DESC);
CREATE INDEX idx_sessions_video_id ON learning_sessions(video_id);
CREATE INDEX idx_sessions_type ON learning_sessions(session_type);

-- ============================================
-- Video Notes Table
-- ============================================

CREATE TABLE IF NOT EXISTS video_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  video_id UUID REFERENCES youtube_videos(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  timestamp DECIMAL NOT NULL,
  tags TEXT[] DEFAULT '{}',
  is_private BOOLEAN DEFAULT TRUE NOT NULL,
  formatting JSONB DEFAULT '{"type": "plain"}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Indexes for video_notes
CREATE INDEX idx_notes_user_id ON video_notes(user_id);
CREATE INDEX idx_notes_video_id ON video_notes(video_id, timestamp);
CREATE INDEX idx_notes_tags ON video_notes USING GIN (tags);
CREATE INDEX idx_notes_created_at ON video_notes(created_at DESC);
CREATE INDEX idx_notes_updated_at ON video_notes(updated_at DESC);

-- Full-text search index for note content
CREATE INDEX idx_notes_content_search ON video_notes 
  USING GIN (to_tsvector('english', content));

-- ============================================
-- Row Level Security (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE vocabulary_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_notes ENABLE ROW LEVEL SECURITY;

-- RLS Policies for vocabulary_entries
CREATE POLICY "Users can view their own vocabulary"
  ON vocabulary_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own vocabulary"
  ON vocabulary_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own vocabulary"
  ON vocabulary_entries FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own vocabulary"
  ON vocabulary_entries FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for learning_sessions
CREATE POLICY "Users can view their own sessions"
  ON learning_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own sessions"
  ON learning_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sessions"
  ON learning_sessions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for video_notes
CREATE POLICY "Users can view their own notes"
  ON video_notes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own notes"
  ON video_notes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own notes"
  ON video_notes FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own notes"
  ON video_notes FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- Triggers
-- ============================================

-- Update timestamp trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update timestamp triggers
CREATE TRIGGER update_vocabulary_entries_updated_at
  BEFORE UPDATE ON vocabulary_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_video_notes_updated_at
  BEFORE UPDATE ON video_notes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Functions
-- ============================================

-- Function to get learning streak
CREATE OR REPLACE FUNCTION get_learning_streak(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  streak INTEGER := 0;
  current_date DATE := CURRENT_DATE;
  check_date DATE;
BEGIN
  -- Start from yesterday and go backwards
  check_date := current_date - INTERVAL '1 day';
  
  WHILE EXISTS (
    SELECT 1 
    FROM learning_sessions 
    WHERE user_id = p_user_id 
      AND DATE(started_at) = check_date
  ) LOOP
    streak := streak + 1;
    check_date := check_date - INTERVAL '1 day';
  END LOOP;
  
  -- Check if user has learned today
  IF EXISTS (
    SELECT 1 
    FROM learning_sessions 
    WHERE user_id = p_user_id 
      AND DATE(started_at) = current_date
  ) THEN
    streak := streak + 1;
  END IF;
  
  RETURN streak;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate vocabulary statistics
CREATE OR REPLACE FUNCTION get_vocabulary_stats(p_user_id UUID)
RETURNS TABLE (
  total_words INTEGER,
  words_due_for_review INTEGER,
  average_success_rate DECIMAL,
  words_by_difficulty JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::INTEGER AS total_words,
    COUNT(CASE WHEN next_review_at <= NOW() THEN 1 END)::INTEGER AS words_due_for_review,
    AVG(success_rate) AS average_success_rate,
    jsonb_build_object(
      'beginner', COUNT(CASE WHEN difficulty = 'beginner' THEN 1 END)::INTEGER,
      'intermediate', COUNT(CASE WHEN difficulty = 'intermediate' THEN 1 END)::INTEGER,
      'advanced', COUNT(CASE WHEN difficulty = 'advanced' THEN 1 END)::INTEGER
    ) AS words_by_difficulty
  FROM vocabulary_entries
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Seed Data (Optional - for testing)
-- ============================================

-- Insert sample vocabulary difficulties if not exists
DO $$
BEGIN
  -- This is just a comment to document the valid values
  -- The CHECK constraint on the table enforces these values
  -- Valid difficulties: 'beginner', 'intermediate', 'advanced'
  -- Valid session types: 'video_learning', 'vocabulary_review', 'note_review'
END $$;