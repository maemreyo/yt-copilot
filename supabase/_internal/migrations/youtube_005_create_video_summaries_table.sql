/**
 * Video Summaries Table
 * 
 * Stores AI-generated summaries of YouTube videos in multiple formats and languages.
 * Helps users quickly understand video content before watching.
 * 
 * @description: Create video_summaries table for AI-generated video summaries
 * @depends: youtube_001_create_youtube_videos_table
 * @module: youtube
 * @version: 1.0.0
 */

-- Create video_summaries table
CREATE TABLE IF NOT EXISTS public.video_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Video reference
  video_id UUID NOT NULL REFERENCES public.youtube_videos(id) ON DELETE CASCADE,
  
  -- Summary configuration
  summary_type TEXT NOT NULL DEFAULT 'brief',  -- Type of summary
  summary_language TEXT NOT NULL DEFAULT 'vi', -- Language of summary
  
  -- Summary content
  summary_content JSONB NOT NULL,              -- Main summary content
  /*
  Example summary_content structure:
  {
    "brief": "Tóm tắt ngắn gọn về nội dung video...",
    "detailed": "Tóm tắt chi tiết với các điểm chính...",
    "bullet_points": [
      "Điểm chính 1",
      "Điểm chính 2", 
      "Điểm chính 3"
    ],
    "key_timestamps": [
      {
        "time": "00:30",
        "title": "Giới thiệu chủ đề",
        "description": "Mô tả ngắn về phần này"
      },
      {
        "time": "02:15", 
        "title": "Điểm chính đầu tiên",
        "description": "Chi tiết về điểm này"
      }
    ],
    "learning_objectives": [
      "Học được cách...",
      "Hiểu về khái niệm...",
      "Nắm vững kỹ năng..."
    ],
    "difficulty_level": "intermediate",
    "estimated_reading_time": 2
  }
  */
  
  -- Content analysis
  main_topics TEXT[],                          -- Array of main topics covered
  keywords TEXT[],                            -- Important keywords/phrases
  sentiment_score DECIMAL(3,2),              -- Overall sentiment (-1.00 to 1.00)
  
  -- AI processing metadata
  ai_model TEXT DEFAULT 'gpt-4o-mini',       -- AI model used for summarization
  ai_provider TEXT DEFAULT 'openai',         -- AI service provider
  processing_time_ms INTEGER,                -- Time taken to generate summary
  tokens_used INTEGER,                       -- Number of tokens consumed
  api_cost_cents INTEGER DEFAULT 0,          -- Cost in cents
  
  -- Quality metrics
  confidence_score DECIMAL(4,3),             -- AI confidence in summary (0.000-1.000)
  summary_quality TEXT DEFAULT 'unknown',    -- Quality assessment
  coherence_score DECIMAL(3,2),             -- Coherence rating (0.00-1.00)
  completeness_score DECIMAL(3,2),          -- Completeness rating (0.00-1.00)
  
  -- User feedback
  user_ratings JSONB DEFAULT '[]',           -- User feedback on summary quality
  average_rating DECIMAL(3,2),              -- Average user rating (1.00-5.00)
  helpful_votes INTEGER DEFAULT 0,          -- Number of "helpful" votes
  total_votes INTEGER DEFAULT 0,            -- Total votes received
  
  -- Usage statistics
  view_count INTEGER DEFAULT 0,             -- How many times summary was viewed
  share_count INTEGER DEFAULT 0,            -- How many times summary was shared
  last_accessed_at TIMESTAMPTZ,             -- Last time summary was accessed
  
  -- Cache and optimization
  is_cached BOOLEAN DEFAULT TRUE,           -- Whether this is a cached result
  cache_expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  regeneration_requested BOOLEAN DEFAULT FALSE, -- Whether regeneration was requested
  
  -- Content versioning
  version INTEGER DEFAULT 1,               -- Summary version number
  previous_version_id UUID REFERENCES public.video_summaries(id),
  
  -- System metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT video_summaries_unique_video_type_lang UNIQUE(video_id, summary_type, summary_language),
  CONSTRAINT video_summaries_type_valid CHECK (
    summary_type IN ('brief', 'detailed', 'bullet_points', 'academic', 'casual', 'technical')
  ),
  CONSTRAINT video_summaries_language_valid CHECK (
    summary_language ~ '^[a-z]{2}(-[A-Z]{2})?$'
  ),
  CONSTRAINT video_summaries_sentiment_valid CHECK (
    sentiment_score IS NULL OR (sentiment_score >= -1.00 AND sentiment_score <= 1.00)
  ),
  CONSTRAINT video_summaries_confidence_valid CHECK (
    confidence_score IS NULL OR (confidence_score >= 0.000 AND confidence_score <= 1.000)
  ),
  CONSTRAINT video_summaries_scores_valid CHECK (
    (coherence_score IS NULL OR (coherence_score >= 0.00 AND coherence_score <= 1.00)) AND
    (completeness_score IS NULL OR (completeness_score >= 0.00 AND completeness_score <= 1.00))
  ),
  CONSTRAINT video_summaries_rating_valid CHECK (
    average_rating IS NULL OR (average_rating >= 1.00 AND average_rating <= 5.00)
  ),
  CONSTRAINT video_summaries_votes_valid CHECK (
    helpful_votes >= 0 AND total_votes >= helpful_votes
  ),
  CONSTRAINT video_summaries_counts_positive CHECK (
    view_count >= 0 AND share_count >= 0
  ),
  CONSTRAINT video_summaries_quality_valid CHECK (
    summary_quality IN ('excellent', 'good', 'fair', 'poor', 'unknown')
  ),
  CONSTRAINT video_summaries_version_positive CHECK (
    version > 0
  )
);

-- Create indexes for performance
CREATE INDEX video_summaries_video_id_idx ON public.video_summaries(video_id);
CREATE INDEX video_summaries_type_lang_idx ON public.video_summaries(summary_type, summary_language);
CREATE INDEX video_summaries_created_at_idx ON public.video_summaries(created_at DESC);
CREATE INDEX video_summaries_view_count_idx ON public.video_summaries(view_count DESC);
CREATE INDEX video_summaries_rating_idx ON public.video_summaries(average_rating DESC) WHERE average_rating IS NOT NULL;
CREATE INDEX video_summaries_quality_idx ON public.video_summaries(summary_quality) WHERE summary_quality IN ('excellent', 'good');
CREATE INDEX video_summaries_cache_expires_idx ON public.video_summaries(cache_expires_at) WHERE cache_expires_at < NOW() + INTERVAL '7 days';
CREATE INDEX video_summaries_last_accessed_idx ON public.video_summaries(last_accessed_at DESC);

-- GIN indexes for array and JSONB columns
CREATE INDEX video_summaries_topics_gin_idx ON public.video_summaries USING gin(main_topics);
CREATE INDEX video_summaries_keywords_gin_idx ON public.video_summaries USING gin(keywords);
CREATE INDEX video_summaries_content_gin_idx ON public.video_summaries USING gin(summary_content);

-- Full-text search index
CREATE INDEX video_summaries_search_idx ON public.video_summaries 
  USING gin(to_tsvector('english', summary_content::text));

-- Enable Row Level Security
ALTER TABLE public.video_summaries ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Allow all authenticated users to read summaries (they're based on public videos)
CREATE POLICY "Authenticated users can view video summaries"
  ON public.video_summaries
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow service role to manage summaries
CREATE POLICY "Service role can manage video summaries"
  ON public.video_summaries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow users to update ratings and feedback
CREATE POLICY "Users can update summary ratings"
  ON public.video_summaries
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Prevent direct insertion/deletion by users
CREATE POLICY "Users cannot insert/delete summaries directly"
  ON public.video_summaries
  FOR INSERT, DELETE
  TO authenticated
  USING (false);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION public.handle_video_summaries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  
  -- Update last_accessed_at if view_count increased
  IF OLD.view_count < NEW.view_count THEN
    NEW.last_accessed_at = NOW();
  END IF;
  
  -- Recalculate average rating if user_ratings changed
  IF OLD.user_ratings IS DISTINCT FROM NEW.user_ratings THEN
    NEW.average_rating = (
      SELECT AVG((value->>'rating')::DECIMAL)
      FROM jsonb_array_elements(NEW.user_ratings)
      WHERE value->>'rating' IS NOT NULL
    );
  END IF;
  
  -- Update helpful vote ratio
  IF OLD.total_votes != NEW.total_votes OR OLD.helpful_votes != NEW.helpful_votes THEN
    -- Additional logic for vote validation can be added here
    IF NEW.total_votes < NEW.helpful_votes THEN
      RAISE EXCEPTION 'Total votes cannot be less than helpful votes';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER video_summaries_updated_at
  BEFORE UPDATE ON public.video_summaries
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_video_summaries_updated_at();

-- Create function to get or generate summary
CREATE OR REPLACE FUNCTION public.get_or_create_video_summary(
  p_video_id UUID,
  p_summary_type TEXT DEFAULT 'brief',
  p_language TEXT DEFAULT 'vi',
  p_regenerate BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(
  summary_id UUID,
  content JSONB,
  created_at TIMESTAMPTZ,
  is_cached BOOLEAN
) AS $$
DECLARE
  existing_summary RECORD;
BEGIN
  -- Check for existing summary
  SELECT * INTO existing_summary
  FROM public.video_summaries
  WHERE video_id = p_video_id
    AND summary_type = p_summary_type
    AND summary_language = p_language
    AND (cache_expires_at IS NULL OR cache_expires_at > NOW())
    AND regeneration_requested = FALSE;
  
  IF existing_summary.id IS NOT NULL AND NOT p_regenerate THEN
    -- Update view count and return existing summary
    UPDATE public.video_summaries
    SET view_count = view_count + 1,
        last_accessed_at = NOW()
    WHERE id = existing_summary.id;
    
    RETURN QUERY SELECT
      existing_summary.id::UUID,
      existing_summary.summary_content,
      existing_summary.created_at,
      true as is_cached;
  ELSE
    -- Mark for regeneration if forcing regeneration
    IF p_regenerate AND existing_summary.id IS NOT NULL THEN
      UPDATE public.video_summaries
      SET regeneration_requested = TRUE
      WHERE id = existing_summary.id;
    END IF;
    
    -- Return indication that new summary needs to be generated
    RETURN QUERY SELECT
      NULL::UUID,
      NULL::JSONB,
      NULL::TIMESTAMPTZ,
      false as is_cached;
  END IF;
  
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to store generated summary
CREATE OR REPLACE FUNCTION public.store_video_summary(
  p_video_id UUID,
  p_summary_type TEXT,
  p_language TEXT,
  p_content JSONB,
  p_ai_metadata JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  summary_id UUID;
BEGIN
  INSERT INTO public.video_summaries (
    video_id,
    summary_type,
    summary_language,
    summary_content,
    main_topics,
    keywords,
    sentiment_score,
    ai_model,
    ai_provider,
    processing_time_ms,
    tokens_used,
    api_cost_cents,
    confidence_score,
    coherence_score,
    completeness_score
  )
  VALUES (
    p_video_id,
    p_summary_type,
    p_language,
    p_content,
    CASE WHEN p_ai_metadata ? 'main_topics' THEN 
      (SELECT array_agg(value::text) FROM jsonb_array_elements_text(p_ai_metadata->'main_topics'))
    END,
    CASE WHEN p_ai_metadata ? 'keywords' THEN
      (SELECT array_agg(value::text) FROM jsonb_array_elements_text(p_ai_metadata->'keywords'))
    END,
    (p_ai_metadata->>'sentiment_score')::DECIMAL,
    COALESCE(p_ai_metadata->>'ai_model', 'gpt-4o-mini'),
    COALESCE(p_ai_metadata->>'ai_provider', 'openai'),
    (p_ai_metadata->>'processing_time_ms')::INTEGER,
    (p_ai_metadata->>'tokens_used')::INTEGER,
    (p_ai_metadata->>'api_cost_cents')::INTEGER,
    (p_ai_metadata->>'confidence_score')::DECIMAL,
    (p_ai_metadata->>'coherence_score')::DECIMAL,
    (p_ai_metadata->>'completeness_score')::DECIMAL
  )
  ON CONFLICT (video_id, summary_type, summary_language) DO UPDATE SET
    summary_content = EXCLUDED.summary_content,
    main_topics = EXCLUDED.main_topics,
    keywords = EXCLUDED.keywords,
    sentiment_score = EXCLUDED.sentiment_score,
    ai_model = EXCLUDED.ai_model,
    processing_time_ms = EXCLUDED.processing_time_ms,
    tokens_used = EXCLUDED.tokens_used,
    api_cost_cents = EXCLUDED.api_cost_cents,
    confidence_score = EXCLUDED.confidence_score,
    coherence_score = EXCLUDED.coherence_score,
    completeness_score = EXCLUDED.completeness_score,
    cache_expires_at = NOW() + INTERVAL '30 days',
    regeneration_requested = FALSE,
    version = public.video_summaries.version + 1,
    updated_at = NOW()
  RETURNING id INTO summary_id;
  
  RETURN summary_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to search summaries
CREATE OR REPLACE FUNCTION public.search_video_summaries(
  search_query TEXT,
  p_language TEXT DEFAULT 'vi',
  p_summary_type TEXT DEFAULT NULL,
  limit_count INTEGER DEFAULT 20
)
RETURNS TABLE(
  summary_id UUID,
  video_id UUID,
  video_title TEXT,
  summary_type TEXT,
  content JSONB,
  main_topics TEXT[],
  rank REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    vs.id,
    vs.video_id,
    yv.title,
    vs.summary_type,
    vs.summary_content,
    vs.main_topics,
    ts_rank(
      to_tsvector('english', vs.summary_content::text),
      plainto_tsquery('english', search_query)
    ) as rank
  FROM public.video_summaries vs
  JOIN public.youtube_videos yv ON vs.video_id = yv.id
  WHERE vs.summary_language = p_language
    AND (p_summary_type IS NULL OR vs.summary_type = p_summary_type)
    AND to_tsvector('english', vs.summary_content::text) @@ plainto_tsquery('english', search_query)
  ORDER BY rank DESC, vs.view_count DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to cleanup expired summaries
CREATE OR REPLACE FUNCTION public.cleanup_expired_summaries()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.video_summaries
  WHERE cache_expires_at < NOW()
    AND view_count < 10  -- Keep popular summaries longer
    AND last_accessed_at < NOW() - INTERVAL '60 days';
    
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add table and column comments
COMMENT ON TABLE public.video_summaries IS 'AI-generated summaries of YouTube videos in multiple formats and languages';
COMMENT ON COLUMN public.video_summaries.summary_content IS 'JSONB containing the summary with timestamps, bullet points, and learning objectives';
COMMENT ON COLUMN public.video_summaries.tokens_used IS 'Number of AI tokens consumed to generate this summary';
COMMENT ON COLUMN public.video_summaries.cache_expires_at IS 'When this cached summary expires (default 30 days)';
COMMENT ON COLUMN public.video_summaries.regeneration_requested IS 'Whether users have requested this summary to be regenerated';

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_or_create_video_summary(UUID, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_video_summaries(TEXT, TEXT, TEXT, INTEGER) TO authenticated;