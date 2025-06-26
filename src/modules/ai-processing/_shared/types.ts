/**
 * Shared type definitions for AI Processing module
 * Compatible with Deno/Edge Functions runtime
 */

// ============================================
// Translation Types
// ============================================

export interface TranslateRequest {
  text: string;
  source_lang?: string;
  target_lang: string;
  context?: string;
}

export interface TranslateResponse {
  original_text: string;
  translated_text: string;
  source_lang: string;
  target_lang: string;
  cached: boolean;
  provider: 'google' | 'libretranslate';
  definitions?: Definition[];
  pronunciation?: string;
}

export interface Definition {
  partOfSpeech: string;
  definition: string;
  example?: string;
  synonyms?: string[];
}

// ============================================
// Summarization Types
// ============================================

export interface SummarizeRequest {
  video_id: string;
  summary_type: 'brief' | 'detailed' | 'bullet_points';
  language?: string;
  custom_prompt?: string;
}

export interface SummarizeResponse {
  video_id: string;
  summary_type: string;
  language: string;
  content: VideoSummaryContent;
  tokens_used: number;
  cached: boolean;
  model: string;
}

export interface VideoSummaryContent {
  summary: string;
  key_points?: string[];
  topics?: string[];
  duration_estimate?: number;
  generated_at: string;
}

// ============================================
// Content Analysis Types
// ============================================

export interface AnalyzeContentRequest {
  video_id: string;
  analysis_type: 'fact_opinion' | 'sentiment' | 'bias';
  segments?: number[];
}

export interface AnalyzeContentResponse {
  video_id: string;
  analysis_type: string;
  analysis: ContentAnalysis;
  suggestions?: string[];
  tokens_used: number;
  cached: boolean;
  model: string;
}

export interface ContentAnalysis {
  facts: Fact[];
  opinions: Opinion[];
  sentiment: SentimentScore;
  bias_indicators?: BiasIndicator[];
  confidence_score: number;
}

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

// ============================================
// Error Types
// ============================================

export interface AIProcessingError {
  code: string;
  message: string;
  details?: any;
}

// ============================================
// Database Record Types
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
  summary_type: string;
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
  analysis_type: string;
  segments?: number[];
  analysis_data: ContentAnalysis;
  confidence_score: number;
  model: string;
  tokens_used?: number;
  created_at: string;
}