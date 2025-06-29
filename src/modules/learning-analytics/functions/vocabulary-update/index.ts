import { denoEnv } from '@/shared-deno-env';
import { createClient } from '@supabase/supabase-js';
import { serve } from 'std/http/server.ts';
import { calculateNextReview, getNextReviewDate } from '../../_shared/spaced-repetition.ts';
import type { ErrorResponse, SuccessResponse } from '../../_shared/types.ts';
import { UpdateVocabularySchema } from '../../_shared/validators.ts';

// Response headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, content-type',
};

const securityHeaders = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
};

// Extract user from JWT
async function extractUser(request: Request): Promise<{ id: string; email: string } | null> {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring(7);
    const supabase = createClient(
      denoEnv.get('SUPABASE_URL') || '',
      denoEnv.get('SUPABASE_ANON_KEY') || ''
    );

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);
    if (error || !user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email || '',
    };
  } catch (error: any) {
    console.error('Auth error:', error);
    return null;
  }
}

// Extract ID from URL path
function extractIdFromPath(url: string): string | null {
  const pathMatch = url.match(/\/vocabulary\/([a-f0-9-]{36})$/);
  return pathMatch ? pathMatch[1] : null;
}

serve(async (request: Request) => {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Only allow PUT
  if (request.method !== 'PUT') {
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only PUT method is allowed',
      },
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 405,
      headers: { ...corsHeaders, ...securityHeaders },
    });
  }

  try {
    // Extract vocabulary ID from URL
    const vocabularyId = extractIdFromPath(request.url);
    if (!vocabularyId) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Invalid vocabulary ID format',
        },
      };

      return new Response(JSON.stringify(errorResponse), {
        status: 400,
        headers: { ...corsHeaders, ...securityHeaders },
      });
    }

    // Authenticate user
    const user = await extractUser(request);
    if (!user) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or missing authentication token',
        },
      };

      return new Response(JSON.stringify(errorResponse), {
        status: 401,
        headers: { ...corsHeaders, ...securityHeaders },
      });
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = UpdateVocabularySchema.safeParse(body);

    if (!validation.success) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: validation.error.errors,
        },
      };

      return new Response(JSON.stringify(errorResponse), {
        status: 400,
        headers: { ...corsHeaders, ...securityHeaders },
      });
    }

    const updateData = validation.data;

    // Initialize Supabase client
    const supabase = createClient(
      denoEnv.get('SUPABASE_URL') || '',
      denoEnv.get('SUPABASE_SERVICE_ROLE_KEY') || '',
      { auth: { persistSession: false } }
    );

    // Get existing vocabulary entry
    const { data: existing, error: fetchError } = await supabase
      .from('vocabulary_entries')
      .select('*')
      .eq('id', vocabularyId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !existing) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Vocabulary entry not found',
        },
      };

      return new Response(JSON.stringify(errorResponse), {
        status: 404,
        headers: { ...corsHeaders, ...securityHeaders },
      });
    }

    // Prepare update object
    const updates: any = {
      updated_at: new Date().toISOString(),
    };

    // Handle review update (spaced repetition)
    if (updateData.review_success !== undefined) {
      const reviewSuccess = updateData.review_success;
      const currentReviewCount = existing.review_count || 0;
      const currentSuccessRate = existing.success_rate || 0;

      // Calculate new success rate
      const newSuccessRate =
        (currentSuccessRate * currentReviewCount + (reviewSuccess ? 1 : 0)) /
        (currentReviewCount + 1);

      // Calculate next review date using SM-2 algorithm
      const { interval, easeFactor } = calculateNextReview(
        currentReviewCount + 1,
        reviewSuccess ? 4 : 1, // Quality: 4 for success, 1 for failure
        existing.ease_factor || 2.5
      );

      updates.review_count = currentReviewCount + 1;
      updates.success_rate = Math.round(newSuccessRate * 100) / 100; // Round to 2 decimals
      updates.next_review_at = getNextReviewDate(interval).toISOString();
      updates.ease_factor = easeFactor;

      // Reset to beginning if failed
      if (!reviewSuccess && currentReviewCount > 2) {
        updates.review_count = 0;
        updates.next_review_at = getNextReviewDate(1).toISOString();
      }
    }

    // Update other fields if provided
    if (updateData.definition) {
      updates.definition = updateData.definition;
    }

    if (updateData.difficulty) {
      updates.difficulty = updateData.difficulty;
    }

    // Update vocabulary entry
    const { data: updated, error: updateError } = await supabase
      .from('vocabulary_entries')
      .update(updates)
      .eq('id', vocabularyId)
      .eq('user_id', user.id)
      .select()
      .single();

    if (updateError) {
      console.error('Database error:', updateError);

      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to update vocabulary entry',
          details: updateError,
        },
      };

      return new Response(JSON.stringify(errorResponse), {
        status: 500,
        headers: { ...corsHeaders, ...securityHeaders },
      });
    }

    // Return success response
    const successResponse: SuccessResponse = {
      success: true,
      data: updated,
    };

    return new Response(JSON.stringify(successResponse), {
      status: 200,
      headers: { ...corsHeaders, ...securityHeaders },
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);

    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: { ...corsHeaders, ...securityHeaders },
    });
  }
});
