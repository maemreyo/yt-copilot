/**
 * AI Translations Table
 * 
 * Caches translations from Google Translate API and other translation services
 * to reduce API costs and improve response times. Includes context-aware translations
 * and pronunciation data.
 * 
 * @description: Create ai_translations table for caching translation results
 * @module: youtube
 * @version: 1.0.0
 */

-- Create ai_translations table
CREATE TABLE IF NOT EXISTS public.ai_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Translation identification (for caching)
  content_hash TEXT NOT NULL,               -- Hash of original_text + context for caching
  
  -- Source content
  original_text TEXT NOT NULL,              -- Original text to translate
  source_language TEXT NOT NULL DEFAULT 'en', -- Source language code
  context_text TEXT,                        -- Context for better translation
  
  -- Translation result
  translated_text TEXT NOT NULL,            -- Translated result
  target_language TEXT NOT NULL DEFAULT 'vi', -- Target language code
  
  -- Enhanced translation data
  pronunciation TEXT,                       -- Phonetic pronunciation (IPA format)
  part_of_speech TEXT,                     -- Word type (noun, verb, adjective, etc.)
  contextual_meaning TEXT,                 -- Context-specific meaning
  
  -- Alternative translations
  alternatives JSONB,                      -- Array of alternative translations
  /*
  Example alternatives structure:
  {
    "translations": [
      {"text": "từ bỏ", "confidence": 0.95, "frequency": "common"},
      {"text": "bỏ cuộc", "confidence": 0.87, "frequency": "common"},
      {"text": "đầu hàng", "confidence": 0.73, "frequency": "less_common"}
    ],
    "examples": [
      {
        "source": "Never give up on your dreams",
        "target": "Đừng bao giờ từ bỏ ước mơ của bạn"
      }
    ]
  }
  */
  
  -- Quality metrics
  confidence_score DECIMAL(4,3),           -- Translation confidence (0.000-1.000)
  translation_quality TEXT DEFAULT 'unknown', -- Quality assessment
  is_phrase BOOLEAN DEFAULT FALSE,         -- Whether this is a phrase vs single word
  word_count INTEGER DEFAULT 1,            -- Number of words in original
  
  -- Usage and popularity
  usage_count INTEGER DEFAULT 1,          -- How many times this translation was requested
  user_ratings JSONB DEFAULT '[]',        -- User feedback on translation quality
  average_rating DECIMAL(3,2),            -- Average user rating (1.00-5.00)
  
  -- API and service information
  translation_service TEXT DEFAULT 'google_translate', -- Service used
  api_cost_cents INTEGER DEFAULT 0,       -- Cost in cents for this translation
  api_quota_used INTEGER DEFAULT 1,       -- API quota units consumed
  
  -- Context association (optional)
  video_id UUID REFERENCES public.youtube_videos(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Cache management
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'), -- Cache expiration
  is_verified BOOLEAN DEFAULT FALSE,      -- Whether translation was verified by human
  last_used_at TIMESTAMPTZ DEFAULT NOW(), -- Last time this translation was served
  
  -- System metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT ai_translations_content_hash_unique UNIQUE(content_hash, target_language),
  CONSTRAINT ai_translations_confidence_valid CHECK (
    confidence_score IS NULL OR (confidence_score >= 0.000 AND confidence_score <= 1.000)
  ),
  CONSTRAINT ai_translations_rating_valid CHECK (
    average_rating IS NULL OR (average_rating >= 1.00 AND average_rating <= 5.00)
  ),
  CONSTRAINT ai_translations_usage_positive CHECK (
    usage_count > 0
  ),
  CONSTRAINT ai_translations_word_count_positive CHECK (
    word_count > 0
  ),
  CONSTRAINT ai_translations_language_codes_valid CHECK (
    source_language ~ '^[a-z]{2}(-[A-Z]{2})?$' AND
    target_language ~ '^[a-z]{2}(-[A-Z]{2})?$'
  ),
  CONSTRAINT ai_translations_quality_valid CHECK (
    translation_quality IN ('excellent', 'good', 'fair', 'poor', 'unknown')
  ),
  CONSTRAINT ai_translations_service_valid CHECK (
    translation_service IN ('google_translate', 'deepl', 'words_api', 'manual', 'other')
  )
);

-- Create indexes for performance
CREATE INDEX ai_translations_content_hash_idx ON public.ai_translations(content_hash);
CREATE INDEX ai_translations_original_text_idx ON public.ai_translations(original_text);
CREATE INDEX ai_translations_languages_idx ON public.ai_translations(source_language, target_language);
CREATE INDEX ai_translations_last_used_idx ON public.ai_translations(last_used_at DESC);
CREATE INDEX ai_translations_expires_at_idx ON public.ai_translations(expires_at) WHERE expires_at < NOW() + INTERVAL '1 day';
CREATE INDEX ai_translations_video_id_idx ON public.ai_translations(video_id) WHERE video_id IS NOT NULL;
CREATE INDEX ai_translations_user_id_idx ON public.ai_translations(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX ai_translations_usage_count_idx ON public.ai_translations(usage_count DESC);
CREATE INDEX ai_translations_confidence_idx ON public.ai_translations(confidence_score DESC) WHERE confidence_score IS NOT NULL;

-- Partial indexes for common queries
CREATE INDEX ai_translations_popular_idx 
  ON public.ai_translations(usage_count DESC, average_rating DESC) 
  WHERE usage_count > 10;

CREATE INDEX ai_translations_recent_quality_idx
  ON public.ai_translations(created_at DESC)
  WHERE translation_quality IN ('excellent', 'good');

-- Full-text search index
CREATE INDEX ai_translations_search_idx ON public.ai_translations 
  USING gin(to_tsvector('english', original_text || ' ' || translated_text));

-- Enable Row Level Security
ALTER TABLE public.ai_translations ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Allow all authenticated users to read cached translations (they're public knowledge)
CREATE POLICY "Authenticated users can view translations"
  ON public.ai_translations
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow service role to manage translations
CREATE POLICY "Service role can manage translations"
  ON public.ai_translations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow users to rate translations they've used
CREATE POLICY "Users can update ratings on translations they've used"
  ON public.ai_translations
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL)
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- Prevent direct insertion by users (translations are created by API)
CREATE POLICY "Users cannot insert translations directly"
  ON public.ai_translations
  FOR INSERT
  TO authenticated
  USING (false);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION public.handle_ai_translations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  
  -- Update last_used_at if usage_count increased
  IF OLD.usage_count < NEW.usage_count THEN
    NEW.last_used_at = NOW();
  END IF;
  
  -- Recalculate average rating if user_ratings changed
  IF OLD.user_ratings IS DISTINCT FROM NEW.user_ratings THEN
    NEW.average_rating = (
      SELECT AVG((value->>'rating')::DECIMAL)
      FROM jsonb_array_elements(NEW.user_ratings)
      WHERE value->>'rating' IS NOT NULL
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_translations_updated_at
  BEFORE UPDATE ON public.ai_translations
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_ai_translations_updated_at();

-- Create function to generate content hash
CREATE OR REPLACE FUNCTION public.generate_translation_hash(
  p_original_text TEXT,
  p_context TEXT DEFAULT NULL,
  p_source_lang TEXT DEFAULT 'en'
)
RETURNS TEXT AS $$
BEGIN
  RETURN encode(
    digest(
      lower(trim(p_original_text)) || 
      COALESCE('|' || lower(trim(p_context)), '') || 
      '|' || p_source_lang,
      'sha256'
    ),
    'hex'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create function to cache or retrieve translation
CREATE OR REPLACE FUNCTION public.get_or_cache_translation(
  p_original_text TEXT,
  p_target_language TEXT DEFAULT 'vi',
  p_source_language TEXT DEFAULT 'en',
  p_context TEXT DEFAULT NULL,
  p_translation_data JSONB DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_video_id UUID DEFAULT NULL
)
RETURNS TABLE(
  translation_id UUID,
  translated_text TEXT,  
  pronunciation TEXT,
  alternatives JSONB,
  confidence_score DECIMAL,
  is_cached BOOLEAN
) AS $$
DECLARE
  content_hash TEXT;
  existing_translation RECORD;
  new_translation_id UUID;
BEGIN
  -- Generate content hash
  content_hash := public.generate_translation_hash(p_original_text, p_context, p_source_language);
  
  -- Try to find existing translation
  SELECT * INTO existing_translation
  FROM public.ai_translations
  WHERE ai_translations.content_hash = content_hash
    AND target_language = p_target_language
    AND (expires_at IS NULL OR expires_at > NOW());
  
  IF existing_translation.id IS NOT NULL THEN
    -- Update usage count for existing translation
    UPDATE public.ai_translations
    SET usage_count = usage_count + 1,
        last_used_at = NOW()
    WHERE id = existing_translation.id;
    
    -- Return existing translation
    RETURN QUERY SELECT
      existing_translation.id::UUID,
      existing_translation.translated_text,
      existing_translation.pronunciation,
      existing_translation.alternatives,
      existing_translation.confidence_score,
      true as is_cached;
  ELSE
    -- Create new translation if data provided
    IF p_translation_data IS NOT NULL THEN
      INSERT INTO public.ai_translations (
        content_hash,
        original_text,
        source_language,
        target_language,
        context_text,
        translated_text,
        pronunciation,
        alternatives,
        confidence_score,
        part_of_speech,
        contextual_meaning,
        translation_service,
        user_id,
        video_id,
        is_phrase,
        word_count
      )
      VALUES (
        content_hash,
        p_original_text,
        p_source_language,
        p_target_language,
        p_context,
        p_translation_data->>'translated_text',
        p_translation_data->>'pronunciation',
        p_translation_data->'alternatives',
        (p_translation_data->>'confidence_score')::DECIMAL,
        p_translation_data->>'part_of_speech',
        p_translation_data->>'contextual_meaning',
        COALESCE(p_translation_data->>'service', 'google_translate'),
        p_user_id,
        p_video_id,
        (array_length(string_to_array(trim(p_original_text), ' '), 1) > 1),
        array_length(string_to_array(trim(p_original_text), ' '), 1)
      )
      RETURNING id INTO new_translation_id;
      
      -- Return new translation
      RETURN QUERY SELECT
        new_translation_id,
        (p_translation_data->>'translated_text')::TEXT,
        (p_translation_data->>'pronunciation')::TEXT,
        p_translation_data->'alternatives',
        (p_translation_data->>'confidence_score')::DECIMAL,
        false as is_cached;
    END IF;
  END IF;
  
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to clean up expired translations
CREATE OR REPLACE FUNCTION public.cleanup_expired_translations()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.ai_translations
  WHERE expires_at < NOW()
    AND usage_count < 5  -- Keep frequently used translations longer
    AND last_used_at < NOW() - INTERVAL '30 days';
    
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get popular translations
CREATE OR REPLACE FUNCTION public.get_popular_translations(
  p_source_lang TEXT DEFAULT 'en',
  p_target_lang TEXT DEFAULT 'vi',
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE(
  original_text TEXT,
  translated_text TEXT,
  usage_count INTEGER,
  average_rating DECIMAL,
  confidence_score DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.original_text,
    t.translated_text,
    t.usage_count,
    t.average_rating,
    t.confidence_score
  FROM public.ai_translations t
  WHERE t.source_language = p_source_lang
    AND t.target_language = p_target_lang
    AND t.usage_count > 1
  ORDER BY t.usage_count DESC, t.average_rating DESC NULLS LAST
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add table and column comments
COMMENT ON TABLE public.ai_translations IS 'Cache for AI translation results to reduce API costs and improve performance';
COMMENT ON COLUMN public.ai_translations.content_hash IS 'SHA256 hash of original text + context for efficient caching';
COMMENT ON COLUMN public.ai_translations.alternatives IS 'JSONB array of alternative translations with confidence scores';
COMMENT ON COLUMN public.ai_translations.expires_at IS 'Cache expiration time (default 7 days)';
COMMENT ON COLUMN public.ai_translations.usage_count IS 'Number of times this translation was served from cache';
COMMENT ON COLUMN public.ai_translations.api_cost_cents IS 'Cost in cents for obtaining this translation';

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.generate_translation_hash(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_cache_translation(TEXT, TEXT, TEXT, TEXT, JSONB, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_popular_translations(TEXT, TEXT, INTEGER) TO authenticated;