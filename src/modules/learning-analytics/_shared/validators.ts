import { z } from 'zod';

/**
 * Input validators for Learning Analytics module
 * Using Zod for runtime validation
 */

// ============================================
// Vocabulary Validators
// ============================================

export const CreateVocabularySchema = z.object({
  word: z.string().min(1).max(100).trim(),
  definition: z.string().min(1).max(500).trim(),
  context: z.string().max(500).optional(),
  video_id: z.string().uuid().optional(),
  timestamp: z.number().min(0).optional(),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  part_of_speech: z.string().max(50).optional()
});

export const UpdateVocabularySchema = z.object({
  definition: z.string().min(1).max(500).trim().optional(),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  review_success: z.boolean().optional()
});

export const VocabularyListSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  filter: z.object({
    difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    video_id: z.string().uuid().optional(),
    due_for_review: z.boolean().optional(),
    search: z.string().max(100).optional()
  }).optional(),
  sort_by: z.enum(['learned_at', 'next_review_at', 'word', 'success_rate']).optional(),
  order: z.enum(['asc', 'desc']).default('desc')
});

// ============================================
// Session Validators
// ============================================

export const CreateSessionSchema = z.object({
  video_id: z.string().uuid().optional(),
  session_type: z.enum(['video_learning', 'vocabulary_review', 'note_review']),
  session_data: z.any().optional()
});

export const UpdateSessionSchema = z.object({
  ended_at: z.string().datetime().optional(),
  words_learned: z.number().int().min(0).optional(),
  notes_taken: z.number().int().min(0).optional(),
  translations_requested: z.number().int().min(0).optional(),
  session_data: z.any().optional()
});

export const SessionListSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  filter: z.object({
    video_id: z.string().uuid().optional(),
    session_type: z.enum(['video_learning', 'vocabulary_review', 'note_review']).optional(),
    date_from: z.string().datetime().optional(),
    date_to: z.string().datetime().optional()
  }).optional(),
  sort_by: z.enum(['started_at', 'duration_seconds', 'words_learned']).optional(),
  order: z.enum(['asc', 'desc']).default('desc')
});

// ============================================
// Note Validators
// ============================================

export const CreateNoteSchema = z.object({
  video_id: z.string().uuid(),
  content: z.string().min(1).max(5000).trim(),
  timestamp: z.number().min(0),
  tags: z.array(z.string().max(50)).max(10).optional(),
  is_private: z.boolean().default(true),
  formatting: z.object({
    type: z.enum(['markdown', 'plain']),
    highlights: z.array(z.string()).optional()
  }).optional()
});

export const UpdateNoteSchema = z.object({
  content: z.string().min(1).max(5000).trim().optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  is_private: z.boolean().optional(),
  formatting: z.object({
    type: z.enum(['markdown', 'plain']),
    highlights: z.array(z.string()).optional()
  }).optional()
});

export const NoteListSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  filter: z.object({
    video_id: z.string().uuid().optional(),
    tags: z.array(z.string()).optional(),
    search: z.string().max(100).optional(),
    is_private: z.boolean().optional()
  }).optional(),
  sort_by: z.enum(['created_at', 'updated_at', 'timestamp']).optional(),
  order: z.enum(['asc', 'desc']).default('desc')
});

// ============================================
// Analytics Validators
// ============================================

export const AnalyticsDateRangeSchema = z.object({
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  timezone: z.string().default('UTC')
});

// ============================================
// Common Validators
// ============================================

export const UUIDParamSchema = z.object({
  id: z.string().uuid()
});

export const PaginationSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0)
});

// ============================================
// Validation Helpers
// ============================================

export function validateRequest<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { isValid: boolean; data?: T; errors?: z.ZodError } {
  try {
    const validated = schema.parse(data);
    return { isValid: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { isValid: false, errors: error };
    }
    throw error;
  }
}

export function sanitizeString(str: string): string {
  return str
    .trim()
    .replace(/[<>\"']/g, '') // Remove potential XSS characters
    .slice(0, 1000); // Limit length
}

export function sanitizeTags(tags: string[]): string[] {
  return tags
    .map(tag => sanitizeString(tag.toLowerCase()))
    .filter(tag => tag.length > 0)
    .slice(0, 10); // Maximum 10 tags
}

export function validateDateRange(from?: string, to?: string): boolean {
  if (!from || !to) return true;
  
  const fromDate = new Date(from);
  const toDate = new Date(to);
  
  // Check valid dates
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return false;
  }
  
  // From must be before to
  if (fromDate >= toDate) {
    return false;
  }
  
  // Maximum range of 1 year
  const maxRange = 365 * 24 * 60 * 60 * 1000; // 1 year in milliseconds
  if (toDate.getTime() - fromDate.getTime() > maxRange) {
    return false;
  }
  
  return true;
}