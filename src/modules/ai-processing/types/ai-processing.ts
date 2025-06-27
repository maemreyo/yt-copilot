import { z } from 'zod';

// ============================================
// Translation Types
// ============================================

export const TranslateRequestSchema = z.object({
  text: z.string().min(1).max(5000),
  source_lang: z.string().length(2).optional(), // ISO 639-1 code, auto-detect if not provided
  target_lang: z.string().length(2),
  context: z.string().max(500).optional(), // Video context for better translation
  user_id: z.string().uuid()
});

export type TranslateRequest = z.infer<typeof TranslateRequestSchema>;

export interface Definition {
  partOfSpeech: string;
  definition: string;
  example?: string;
  synonyms?: string[];
}

export interface TranslateResponse {
  original_text: string;
  translated_text: string;
  source_lang: string;
  target_lang: string;
  definitions?: Definition[];
  pronunciation?: string;
  cached: boolean;
  provider: 'google' | 'libretranslate' | 'deepl';
}

// ============================================
// Summarization Types
// ============================================

export const SummarizeRequestSchema = z.object({
  video_id: z.string().uuid(),
  summary_type: z.enum(['brief', 'detailed', 'bullet_points']),
  language: z.string().length(2).default('en'),
  user_id: z.string().uuid(),
  custom_prompt: z.string().max(500).optional()
});

export type SummarizeRequest = z.infer<typeof SummarizeRequestSchema>;

export interface VideoSummaryContent {
  summary: string;
  key_points?: string[];
  topics?: string[];
  duration_estimate?: number; // Reading time in minutes
  generated_at: string;
}

export interface SummarizeResponse {
  video_id: string;
  summary_type: 'brief' | 'detailed' | 'bullet_points';
  language: string;
  content: VideoSummaryContent;
  tokens_used: number;
  cached: boolean;
  model: string;
}

// ============================================
// Content Analysis Types
// ============================================

export const AnalyzeContentRequestSchema = z.object({
  video_id: z.string().uuid(),
  analysis_type: z.enum(['fact_opinion', 'sentiment', 'bias']),
  segments: z.array(z.number()).optional(), // Specific transcript segment indices
  user_id: z.string().uuid()
});

export type AnalyzeContentRequest = z.infer<typeof AnalyzeContentRequestSchema>;

export interface Fact {
  text: string;
  confidence: number;
  source_segments: number[];
  verifiable: boolean;
}

export interface Opinion {
  text: string;
  confidence: number;
  source_segments: number[];
  sentiment: 'positive' | 'negative' | 'neutral';
}

export interface SentimentScore {
  overall: 'positive' | 'negative' | 'neutral' | 'mixed';
  positive: number;
  negative: number;
  neutral: number;
}

export interface BiasIndicator {
  type: string;
  description: string;
  examples: string[];
  severity: 'low' | 'medium' | 'high';
}

export interface ContentAnalysis {
  facts: Fact[];
  opinions: Opinion[];
  sentiment: SentimentScore;
  bias_indicators?: BiasIndicator[];
  confidence_score: number;
}

export interface AnalyzeContentResponse {
  video_id: string;
  analysis_type: 'fact_opinion' | 'sentiment' | 'bias';
  analysis: ContentAnalysis;
  suggestions?: string[]; // Counter-perspective suggestions
  tokens_used: number;
  cached: boolean;
  model: string;
}

// ============================================
// Counter-Perspective Types
// ============================================

export const FindCounterpointsRequestSchema = z.object({
  video_id: z.string().uuid(),
  main_topics: z.array(z.string()).optional(),
  original_perspective: z.string().optional(),
  user_id: z.string().uuid()
});

export type FindCounterpointsRequest = z.infer<typeof FindCounterpointsRequestSchema>;

export interface CounterPerspectiveSource {
  source: string;
  title: string;
  url: string;
  relevance_score: number;
  credibility_score: number;
  reasoning: string;
}

export interface FindCounterpointsResponse {
  video_id: string;
  counter_perspectives: CounterPerspectiveSource[];
  search_keywords: string[];
  tokens_used: number;
  cached: boolean;
  model: string;
}

export interface CounterPerspectiveRecord {
  id: string;
  video_id: string;
  user_id: string;
  main_topics: string[];
  original_perspective: string;
  counter_perspectives: CounterPerspectiveSource[];
  search_keywords: string[];
  model: string;
  tokens_used?: number;
  created_at: string;
}

// ============================================
// Database Types
// ============================================

export interface AITranslationRecord {
  id: string;
  user_id: string;
  original_text: string;
  translated_text: string;
  source_lang: string;
  target_lang: string;
  context?: string;
  provider: string;
  created_at: string;
  updated_at: string;
}

export interface VideoSummaryRecord {
  id: string;
  video_id: string;
  user_id: string;
  summary_type: 'brief' | 'detailed' | 'bullet_points';
  language: string;
  content: VideoSummaryContent;
  model: string;
  tokens_used?: number;
  created_at: string;
  updated_at: string;
}

export interface ContentAnalysisRecord {
  id: string;
  video_id: string;
  user_id: string;
  analysis_type: 'fact_opinion' | 'sentiment' | 'bias';
  segments?: number[];
  analysis_data: ContentAnalysis;
  confidence_score: number;
  model: string;
  tokens_used?: number;
  created_at: string;
}

// ============================================
// Error Types
// ============================================

export interface AIProcessingError {
  code: 'TRANSLATION_FAILED' | 'SUMMARIZATION_FAILED' | 'ANALYSIS_FAILED' | 
        'COUNTERPOINTS_FAILED' | 'QUOTA_EXCEEDED' | 'INVALID_LANGUAGE' | 
        'VIDEO_NOT_FOUND' | 'TRANSCRIPT_NOT_FOUND' | 'MODEL_ERROR';
  message: string;
  details?: any;
}