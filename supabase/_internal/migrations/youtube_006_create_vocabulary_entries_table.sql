/**
 * Vocabulary Entries Table
 * 
 * Stores words and phrases that users learn from YouTube videos.
 * Implements spaced repetition algorithm for effective learning.
 * 
 * @description: Create vocabulary_entries table for user vocabulary management
 * @depends: youtube_001_create_youtube_videos_table
 * @module: youtube
 * @version: 1.0.0
 */

-- Create vocabulary_entries table
CREATE TABLE IF NOT EXISTS public.vocabulary_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- User and source references
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id UUID REFERENCES public.youtube_videos(id) ON DELETE SET NULL,
  
  -- Word/phrase information
  word_text TEXT NOT NULL,                    -- The word or phrase
  definition TEXT NOT NULL,                   -- Primary definition
  translation TEXT,                           -- Translation to user's native language
  pronunciation TEXT,                         -- Phonetic pronunciation (IPA)
  part_of_speech TEXT,                       -- Grammar category
  
  -- Context information
  context_sentence TEXT,                      -- Sentence where word was found
  context_translation TEXT,                   -- Translation of the context
  video_timestamp DECIMAL(10,3),             -- Timestamp in video where word appeared
  
  -- Language information
  source_language TEXT NOT NULL DEFAULT 'en', -- Language of the word
  target_language TEXT NOT NULL DEFAULT 'vi', -- User's target language
  
  -- Learning metadata
  difficulty_level TEXT DEFAULT 'unknown',    -- Difficulty assessment
  frequency_rank INTEGER,                     -- Word frequency ranking
  cefr_level TEXT,                           -- CEFR level (A1, A2, B1, B2, C1, C2)
  
  -- Alternative data
  synonyms TEXT[],                           -- Array of synonyms
  antonyms TEXT[],                           -- Array of antonyms
  related_words TEXT[],                      -- Related vocabulary
  example_sentences JSONB DEFAULT '[]',      -- Array of example sentences
  /*
  Example sentences structure:
  [
    {
      "sentence": "Never give up on your dreams",
      "translation": "Đừng bao giờ từ bỏ ước mơ của bạn",
      "audio_url": "https://...",
      "difficulty": "intermediate"
    }
  ]
  */
  
  -- Spaced repetition system (SRS)
  srs_level INTEGER DEFAULT 1,              -- Current SRS level (1-10)
  ease_factor DECIMAL(4,2) DEFAULT 2.50,    -- Ease factor for interval calculation
  interval_days INTEGER DEFAULT 1,          -- Days until next review
  next_review_date DATE DEFAULT CURRENT_DATE + 1,
  last_reviewed_at TIMESTAMPTZ,             -- Last review timestamp
  
  -- Learning progress
  correct_answers INTEGER DEFAULT 0,        -- Number of correct answers
  incorrect_answers INTEGER DEFAULT 0,      -- Number of incorrect answers
  total_reviews INTEGER DEFAULT 0,          -- Total review attempts
  mastery_level DECIMAL(3,2) DEFAULT 0.00, -- Mastery percentage (0.00-1.00)
  
  -- User interaction
  is_starred BOOLEAN DEFAULT FALSE,         -- User marked as important
  is_archived BOOLEAN DEFAULT FALSE,       -- User archived this word
  personal_notes TEXT,                      -- User's personal notes
  memory_technique TEXT,                    -- User's memory technique
  
  -- Categorization
  tags TEXT[] DEFAULT '{}',                 -- User-defined tags
  category TEXT,                            -- Category (work, hobby, academic, etc.)
  topic TEXT,                              -- Topic area (business, technology, etc.)
  
  -- Learning source tracking
  learning_source TEXT DEFAULT 'youtube',   -- How the word was learned
  source_quality INTEGER DEFAULT 3,        -- Quality of source (1-5)
  
  -- System metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  learned_at TIMESTAMPTZ DEFAULT NOW(),    -- When word was first learned
  
  -- Constraints
  CONSTRAINT vocabulary_entries_unique_user_word UNIQUE(user_id, word_text, source_language),
  CONSTRAINT vocabulary_entries_srs_level_valid CHECK (
    srs_level >= 1 AND srs_level <= 10
  ),
  CONSTRAINT vocabulary_entries_ease_factor_valid CHECK (
    ease_factor >= 1.30 AND ease_factor <= 4.00
  ),
  CONSTRAINT vocabulary_entries_interval_positive CHECK (
    interval_days > 0
  ),
  CONSTRAINT vocabulary_entries_mastery_valid CHECK (
    mastery_level >= 0.00 AND mastery_level <= 1.00
  ),
  CONSTRAINT vocabulary_entries_answers_positive CHECK (
    correct_answers >= 0 AND incorrect_answers >= 0 AND 
    total_reviews = correct_answers + incorrect_answers
  ),
  CONSTRAINT vocabulary_entries_difficulty_valid CHECK (
    difficulty_level IN ('very_easy', 'easy', 'medium', 'hard', 'very_hard', 'unknown')
  ),
  CONSTRAINT vocabulary_entries_cefr_valid CHECK (
    cefr_level IS NULL OR cefr_level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')
  ),
  CONSTRAINT vocabulary_entries_source_quality_valid CHECK (
    source_quality >= 1 AND source_quality <= 5
  ),
  CONSTRAINT vocabulary_entries_languages_valid CHECK (
    source_language ~ '^[a-z]{2}(-[A-Z]{2})?$' AND
    target_language ~ '^[a-z]{2}(-[A-Z]{2})?$'
  )
);

-- Create indexes for performance
CREATE INDEX vocabulary_entries_user_id_idx ON public.vocabulary_entries(user_id);
CREATE INDEX vocabulary_entries_video_id_idx ON public.vocabulary_entries(video_id) WHERE video_id IS NOT NULL;
CREATE INDEX vocabulary_entries_next_review_idx ON public.vocabulary_entries(user_id, next_review_date) WHERE NOT is_archived;
CREATE INDEX vocabulary_entries_word_text_idx ON public.vocabulary_entries(word_text);
CREATE INDEX vocabulary_entries_srs_level_idx ON public.vocabulary_entries(user_id, srs_level);
CREATE INDEX vocabulary_entries_mastery_idx ON public.vocabulary_entries(user_id, mastery_level DESC);
CREATE INDEX vocabulary_entries_starred_idx ON public.vocabulary_entries(user_id, is_starred) WHERE is_starred = TRUE;
CREATE INDEX vocabulary_entries_category_idx ON public.vocabulary_entries(user_id, category) WHERE category IS NOT NULL;
CREATE INDEX vocabulary_entries_learned_at_idx ON public.vocabulary_entries(user_id, learned_at DESC);

-- GIN indexes for array columns
CREATE INDEX vocabulary_entries_tags_gin_idx ON public.vocabulary_entries USING gin(tags);
CREATE INDEX vocabulary_entries_synonyms_gin_idx ON public.vocabulary_entries USING gin(synonyms);
CREATE INDEX vocabulary_entries_examples_gin_idx ON public.vocabulary_entries USING gin(example_sentences);

-- Full-text search index
CREATE INDEX vocabulary_entries_search_idx ON public.vocabulary_entries 
  USING gin(to_tsvector('english', 
    word_text || ' ' || 
    coalesce(definition, '') || ' ' || 
    coalesce(context_sentence, '') || ' ' ||
    coalesce(personal_notes, '')
  ));

-- Partial indexes for common queries
CREATE INDEX vocabulary_entries_due_review_idx
  ON public.vocabulary_entries(user_id, next_review_date)
  WHERE next_review_date <= CURRENT_DATE AND NOT is_archived;

CREATE INDEX vocabulary_entries_recent_learned_idx
  ON public.vocabulary_entries(user_id, learned_at DESC)
  WHERE learned_at >= NOW() - INTERVAL '30 days';

-- Enable Row Level Security
ALTER TABLE public.vocabulary_entries ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can only access their own vocabulary
CREATE POLICY "Users can view their own vocabulary"
  ON public.vocabulary_entries
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own vocabulary"
  ON public.vocabulary_entries
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own vocabulary"
  ON public.vocabulary_entries
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own vocabulary"
  ON public.vocabulary_entries
  FOR DELETE
  USING (auth.uid() = user_id);

-- Allow service role full access
CREATE POLICY "Service role can manage all vocabulary"
  ON public.vocabulary_entries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION public.handle_vocabulary_entries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  
  -- Recalculate mastery level based on performance
  IF OLD.correct_answers != NEW.correct_answers OR OLD.incorrect_answers != NEW.incorrect_answers THEN
    NEW.total_reviews = NEW.correct_answers + NEW.incorrect_answers;
    
    IF NEW.total_reviews > 0 THEN
      NEW.mastery_level = NEW.correct_answers::DECIMAL / NEW.total_reviews;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vocabulary_entries_updated_at
  BEFORE UPDATE ON public.vocabulary_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_vocabulary_entries_updated_at();

-- Create function for spaced repetition algorithm
CREATE OR REPLACE FUNCTION public.update_srs_schedule(
  p_vocabulary_id UUID,
  p_quality INTEGER -- Quality of recall (0-5): 0=total blackout, 3=correct with effort, 5=perfect
)
RETURNS JSONB AS $$
DECLARE
  vocab_record RECORD;
  new_ease_factor DECIMAL(4,2);
  new_interval INTEGER;
  new_srs_level INTEGER;
  next_review DATE;
BEGIN
  -- Get current vocabulary data
  SELECT * INTO vocab_record
  FROM public.vocabulary_entries
  WHERE id = p_vocabulary_id;
  
  IF vocab_record.id IS NULL THEN
    RAISE EXCEPTION 'Vocabulary entry not found';
  END IF;
  
  -- Update review statistics
  IF p_quality >= 3 THEN
    -- Correct answer
    UPDATE public.vocabulary_entries
    SET correct_answers = correct_answers + 1,
        last_reviewed_at = NOW()
    WHERE id = p_vocabulary_id;
  ELSE
    -- Incorrect answer
    UPDATE public.vocabulary_entries
    SET incorrect_answers = incorrect_answers + 1,
        last_reviewed_at = NOW()
    WHERE id = p_vocabulary_id;
  END IF;
  
  -- Calculate new ease factor
  new_ease_factor = vocab_record.ease_factor + (0.1 - (5 - p_quality) * (0.08 + (5 - p_quality) * 0.02));
  new_ease_factor = GREATEST(1.30, new_ease_factor); -- Minimum ease factor
  
  -- Calculate new interval based on SRS algorithm
  IF p_quality < 3 THEN
    -- Reset if recalled incorrectly
    new_srs_level = 1;
    new_interval = 1;
  ELSE
    -- Increase level and interval
    new_srs_level = LEAST(10, vocab_record.srs_level + 1);
    
    CASE 
      WHEN new_srs_level = 1 THEN new_interval = 1;
      WHEN new_srs_level = 2 THEN new_interval = 6;
      ELSE new_interval = ROUND(vocab_record.interval_days * new_ease_factor);
    END CASE;
  END IF;
  
  -- Calculate next review date
  next_review = CURRENT_DATE + new_interval;
  
  -- Update vocabulary entry
  UPDATE public.vocabulary_entries
  SET 
    srs_level = new_srs_level,
    ease_factor = new_ease_factor,
    interval_days = new_interval,
    next_review_date = next_review
  WHERE id = p_vocabulary_id;
  
  -- Return updated schedule info
  RETURN jsonb_build_object(
    'srs_level', new_srs_level,
    'ease_factor', new_ease_factor,
    'interval_days', new_interval,
    'next_review_date', next_review,
    'quality_rating', p_quality
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get due vocabulary for review
CREATE OR REPLACE FUNCTION public.get_due_vocabulary(
  p_user_id UUID,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE(
  id UUID,
  word_text TEXT,
  definition TEXT,
  context_sentence TEXT,
  srs_level INTEGER,
  days_overdue INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ve.id,
    ve.word_text,
    ve.definition,
    ve.context_sentence,
    ve.srs_level,
    (CURRENT_DATE - ve.next_review_date)::INTEGER as days_overdue
  FROM public.vocabulary_entries ve
  WHERE ve.user_id = p_user_id
    AND ve.next_review_date <= CURRENT_DATE
    AND NOT ve.is_archived
  ORDER BY ve.next_review_date ASC, ve.srs_level ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get vocabulary statistics
CREATE OR REPLACE FUNCTION public.get_vocabulary_stats(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  stats JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_words', COUNT(*),
    'words_due_today', COUNT(*) FILTER (WHERE next_review_date <= CURRENT_DATE AND NOT is_archived),
    'words_overdue', COUNT(*) FILTER (WHERE next_review_date < CURRENT_DATE AND NOT is_archived),
    'mastered_words', COUNT(*) FILTER (WHERE mastery_level >= 0.80),
    'starred_words', COUNT(*) FILTER (WHERE is_starred),
    'words_by_level', jsonb_object_agg(
      srs_level, 
      COUNT(*) FILTER (WHERE srs_level IS NOT NULL)
    ),
    'average_mastery', ROUND(AVG(mastery_level)::NUMERIC, 3),
    'learning_streak_days', EXTRACT(days FROM (MAX(learned_at) - MIN(learned_at))),
    'words_learned_this_week', COUNT(*) FILTER (WHERE learned_at >= NOW() - INTERVAL '7 days'),
    'words_learned_this_month', COUNT(*) FILTER (WHERE learned_at >= NOW() - INTERVAL '30 days')
  ) INTO stats
  FROM public.vocabulary_entries
  WHERE user_id = p_user_id;
  
  RETURN stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to search vocabulary
CREATE OR REPLACE FUNCTION public.search_vocabulary(
  p_user_id UUID,
  search_query TEXT,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE(
  id UUID,
  word_text TEXT,
  definition TEXT,
  translation TEXT,
  context_sentence TEXT,
  mastery_level DECIMAL,
  rank REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ve.id,
    ve.word_text,
    ve.definition,
    ve.translation,
    ve.context_sentence,
    ve.mastery_level,
    ts_rank(
      to_tsvector('english', 
        ve.word_text || ' ' || 
        coalesce(ve.definition, '') || ' ' || 
        coalesce(ve.context_sentence, '')
      ),
      plainto_tsquery('english', search_query)
    ) as rank
  FROM public.vocabulary_entries ve
  WHERE ve.user_id = p_user_id
    AND to_tsvector('english', 
        ve.word_text || ' ' || 
        coalesce(ve.definition, '') || ' ' || 
        coalesce(ve.context_sentence, '')
      ) @@ plainto_tsquery('english', search_query)
  ORDER BY rank DESC, ve.mastery_level DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create view for vocabulary dashboard
CREATE OR REPLACE VIEW public.vocabulary_dashboard AS
SELECT 
  ve.user_id,
  ve.id,
  ve.word_text,
  ve.definition,
  ve.translation,
  ve.context_sentence,
  ve.srs_level,
  ve.mastery_level,
  ve.next_review_date,
  ve.is_starred,
  ve.category,
  ve.learned_at,
  yv.title as video_title,
  yv.channel_name,
  CASE 
    WHEN ve.next_review_date <= CURRENT_DATE THEN 'due'
    WHEN ve.next_review_date <= CURRENT_DATE + 1 THEN 'upcoming'
    ELSE 'scheduled'
  END as review_status,
  CASE
    WHEN ve.mastery_level >= 0.90 THEN 'mastered'
    WHEN ve.mastery_level >= 0.70 THEN 'learning'
    WHEN ve.mastery_level >= 0.40 THEN 'practicing'
    ELSE 'new'
  END as learning_stage
FROM public.vocabulary_entries ve
LEFT JOIN public.youtube_videos yv ON ve.video_id = yv.id
WHERE NOT ve.is_archived;

-- Add table and column comments
COMMENT ON TABLE public.vocabulary_entries IS 'User vocabulary entries with spaced repetition system for effective learning';
COMMENT ON COLUMN public.vocabulary_entries.srs_level IS 'Spaced repetition system level (1-10)';
COMMENT ON COLUMN public.vocabulary_entries.ease_factor IS 'Ease factor for calculating review intervals (1.30-4.00)';
COMMENT ON COLUMN public.vocabulary_entries.next_review_date IS 'Date when this word should be reviewed next';
COMMENT ON COLUMN public.vocabulary_entries.mastery_level IS 'Learning mastery percentage (0.00-1.00)';
COMMENT ON COLUMN public.vocabulary_entries.example_sentences IS 'JSONB array of example sentences with translations';

-- Grant permissions
GRANT SELECT ON public.vocabulary_dashboard TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_srs_schedule(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_due_vocabulary(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_vocabulary_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_vocabulary(UUID, TEXT, INTEGER) TO authenticated;