/**
 * Shared type definitions for Learning Analytics module
 * Compatible with Deno/Edge Functions runtime
 */

// ============================================
// Vocabulary Management Types
// ============================================

export interface VocabularyEntry {
  id: string;
  user_id: string;
  word: string;
  definition: string;
  context?: string;
  video_id?: string;
  timestamp?: number;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  part_of_speech?: string;
  learned_at: string;
  next_review_at?: string;
  review_count: number;
  success_rate: number;
  created_at: string;
  updated_at: string;
}

export interface CreateVocabularyRequest {
  word: string;
  definition: string;
  context?: string;
  video_id?: string;
  timestamp?: number;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  part_of_speech?: string;
}

export interface UpdateVocabularyRequest {
  definition?: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  review_success?: boolean; // For spaced repetition updates
}

export interface VocabularyListRequest {
  limit?: number;
  offset?: number;
  filter?: {
    difficulty?: string;
    video_id?: string;
    due_for_review?: boolean;
    search?: string;
  };
  sort_by?: 'learned_at' | 'next_review_at' | 'word' | 'success_rate';
  order?: 'asc' | 'desc';
}

export interface VocabularyListResponse {
  entries: VocabularyEntry[];
  total: number;
  has_more: boolean;
}

// ============================================
// Learning Session Types
// ============================================

export interface LearningSession {
  id: string;
  user_id: string;
  video_id?: string;
  started_at: string;
  ended_at?: string;
  duration_seconds?: number;
  words_learned: number;
  notes_taken: number;
  translations_requested: number;
  session_type: 'video_learning' | 'vocabulary_review' | 'note_review';
  session_data?: any;
  created_at: string;
}

export interface CreateSessionRequest {
  video_id?: string;
  session_type: 'video_learning' | 'vocabulary_review' | 'note_review';
  session_data?: any;
}

export interface UpdateSessionRequest {
  ended_at?: string;
  words_learned?: number;
  notes_taken?: number;
  translations_requested?: number;
  session_data?: any;
}

export interface SessionListRequest {
  limit?: number;
  offset?: number;
  filter?: {
    video_id?: string;
    session_type?: string;
    date_from?: string;
    date_to?: string;
  };
  sort_by?: 'started_at' | 'duration_seconds' | 'words_learned';
  order?: 'asc' | 'desc';
}

// ============================================
// Note-Taking Types
// ============================================

export interface VideoNote {
  id: string;
  user_id: string;
  video_id: string;
  content: string;
  timestamp: number;
  tags: string[];
  is_private: boolean;
  formatting?: {
    type: 'markdown' | 'plain';
    highlights?: string[];
  };
  created_at: string;
  updated_at: string;
}

export interface CreateNoteRequest {
  video_id: string;
  content: string;
  timestamp: number;
  tags?: string[];
  is_private?: boolean;
  formatting?: {
    type: 'markdown' | 'plain';
    highlights?: string[];
  };
}

export interface UpdateNoteRequest {
  content?: string;
  tags?: string[];
  is_private?: boolean;
  formatting?: {
    type: 'markdown' | 'plain';
    highlights?: string[];
  };
}

export interface NoteListRequest {
  limit?: number;
  offset?: number;
  filter?: {
    video_id?: string;
    tags?: string[];
    search?: string;
    is_private?: boolean;
  };
  sort_by?: 'created_at' | 'updated_at' | 'timestamp';
  order?: 'asc' | 'desc';
}

// ============================================
// Analytics Types
// ============================================

export interface LearningAnalyticsOverview {
  total_videos_watched: number;
  total_words_learned: number;
  total_notes_taken: number;
  total_learning_time: number; // seconds
  learning_streak: number; // days
  average_session_time: number; // seconds
  last_activity_at?: string;
}

export interface LearningAnalyticsDashboard {
  overview: LearningAnalyticsOverview;
  vocabulary_stats: {
    total: number;
    by_difficulty: {
      beginner: number;
      intermediate: number;
      advanced: number;
    };
    due_for_review: number;
    average_success_rate: number;
  };
  progress_trends: {
    vocabulary_growth: Array<{
      date: string;
      count: number;
    }>;
    session_frequency: Array<{
      date: string;
      sessions: number;
    }>;
    learning_time: Array<{
      date: string;
      minutes: number;
    }>;
  };
  recommendations: Array<{
    type: 'vocabulary_review' | 'content_suggestion' | 'learning_pattern';
    message: string;
    action?: string;
    data?: any;
  }>;
  recent_activity: {
    recent_videos: Array<{
      video_id: string;
      title?: string;
      last_watched: string;
    }>;
    recent_words: VocabularyEntry[];
    recent_notes: VideoNote[];
  };
}

// ============================================
// Spaced Repetition Types
// ============================================

export interface SpacedRepetitionItem {
  item_id: string;
  difficulty: number; // 0-1
  interval: number; // days
  repetitions: number;
  ease_factor: number; // SM-2 algorithm
  next_review: string;
}

export interface ReviewResult {
  quality: number; // 0-5 (0=fail, 5=perfect)
  time_taken?: number; // seconds
}

// ============================================
// Error Types
// ============================================

export interface LearningError {
  code: string;
  message: string;
  details?: any;
}

// ============================================
// Common Response Types
// ============================================

export interface SuccessResponse<T = any> {
  success: true;
  data: T;
}

export interface ErrorResponse {
  success: false;
  error: LearningError;
}