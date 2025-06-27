import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { UpdateVocabularySchema, UUIDParamSchema, validateRequest } from '_shared/validators.ts';
import { calculateNextReview, getNextReviewDate } from '_shared/spaced-repetition.ts';
import type { 
  UpdateVocabularyRequest, 
  VocabularyEntry,
  SuccessResponse, 
  ErrorResponse 
} from '_shared/types.ts';

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
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_ANON_KEY') || ''
    );

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email || ''
    };
  } catch (error) {
    console.error('Auth error:', error);
    return null;
  }
}

// Extract ID from URL path
function extractIdFromPath(url: string): string | null {
  const pathMatch = url.match(/\/vocabulary\/([a-f0-9-]{36})$/);
  return pathMatch ? pathMatch[1] : null;
}

// Main handler
serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  if (req.method !== 'PUT') {
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only PUT method allowed'
      }
    };
    
    return new Response(
      JSON.stringify(errorResponse),
      { 
        status: 405, 
        headers: { ...corsHeaders, ...securityHeaders } 
      }
    );
  }

  try {
    // Authenticate user
    const user = await extractUser(req);
    if (!user) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        }
      };
      
      return new Response(
        JSON.stringify(errorResponse),
        { 
          status: 401, 
          headers: { ...corsHeaders, ...securityHeaders } 
        }
      );
    }

    // Extract and validate ID
    const vocabularyId = extractIdFromPath(req.url);
    if (!vocabularyId) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid vocabulary ID in URL'
        }
      };
      
      return new Response(
        JSON.stringify(errorResponse),
        { 
          status: 400, 
          headers: { ...corsHeaders, ...securityHeaders } 
        }
      );
    }

    // Validate UUID format
    const idValidation = validateRequest(UUIDParamSchema, { id: vocabularyId });
    if (!idValidation.isValid) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid vocabulary ID format',
          details: idValidation.errors?.errors
        }
      };
      
      return new Response(
        JSON.stringify(errorResponse),
        { 
          status: 400, 
          headers: { ...corsHeaders, ...securityHeaders } 
        }
      );
    }

    // Parse and validate request body
    const body = await req.json();
    const validation = validateRequest(UpdateVocabularySchema, body);

    if (!validation.isValid) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: validation.errors?.errors
        }
      };
      
      return new Response(
        JSON.stringify(errorResponse),
        { 
          status: 400, 
          headers: { ...corsHeaders, ...securityHeaders } 
        }
      );
    }

    const data = validation.data as UpdateVocabularyRequest;

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
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
          details: { id: vocabularyId }
        }
      };
      
      return new Response(
        JSON.stringify(errorResponse),
        { 
          status: 404, 
          headers: { ...corsHeaders, ...securityHeaders } 
        }
      );
    }

    // Prepare update data
    const updateData: any = {};

    // Update basic fields if provided
    if (data.definition !== undefined) {
      updateData.definition = data.definition;
    }
    
    if (data.difficulty !== undefined) {
      updateData.difficulty = data.difficulty;
    }

    // Handle review update (spaced repetition)
    if (data.review_success !== undefined) {
      const quality = data.review_success ? 4 : 2; // 4 = good, 2 = fail
      
      const currentState = {
        interval: 1, // Will be calculated from last review
        repetitions: existing.review_count,
        ease_factor: 2.5 // Default, should store in DB ideally
      };

      // Calculate days since last review
      const lastReview = new Date(existing.next_review_at || existing.learned_at);
      const today = new Date();
      const daysSinceLastReview = Math.floor(
        (today.getTime() - lastReview.getTime()) / (1000 * 60 * 60 * 24)
      );
      currentState.interval = Math.max(1, daysSinceLastReview);

      const newState = calculateNextReview(currentState, { quality });
      
      updateData.review_count = existing.review_count + 1;
      updateData.next_review_at = getNextReviewDate(newState.interval);
      
      // Update success rate
      const totalReviews = existing.review_count + 1;
      const successfulReviews = existing.review_count * existing.success_rate + (data.review_success ? 1 : 0);
      updateData.success_rate = successfulReviews / totalReviews;
    }

    // Update vocabulary entry
    const { data: updated, error: updateError } = await supabase
      .from('vocabulary_entries')
      .update(updateData)
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
          details: updateError
        }
      };
      
      return new Response(
        JSON.stringify(errorResponse),
        { 
          status: 500, 
          headers: { ...corsHeaders, ...securityHeaders } 
        }
      );
    }

    // Return success response
    const successResponse: SuccessResponse<VocabularyEntry> = {
      success: true,
      data: updated
    };

    return new Response(
      JSON.stringify(successResponse),
      { 
        status: 200, 
        headers: { ...corsHeaders, ...securityHeaders } 
      }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    };
    
    return new Response(
      JSON.stringify(errorResponse),
      { 
        status: 500, 
        headers: { ...corsHeaders, ...securityHeaders } 
      }
    );
  }
});