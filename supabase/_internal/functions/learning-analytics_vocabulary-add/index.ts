import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { CreateVocabularySchema, validateRequest } from '_shared/validators.ts';
import {
  getInitialState,
  getNextReviewDate,
} from '_shared/spaced-repetition.ts';
import type {
  CreateVocabularyRequest,
  ErrorResponse,
  SuccessResponse,
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
async function extractUser(
  request: Request,
): Promise<{ id: string; email: string } | null> {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring(7);
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_ANON_KEY') || '',
    );

    const { data: { user }, error } = await supabase.auth.getUser(token);
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

// Check if vocabulary already exists
async function checkDuplicate(
  supabase: any,
  userId: string,
  word: string,
  context?: string,
): Promise<boolean> {
  const query = supabase
    .from('vocabulary_entries')
    .select('id')
    .eq('user_id', userId)
    .eq('word', word);

  if (context) {
    query.eq('context', context);
  } else {
    query.is('context', null);
  }

  const { data, error } = await query.single();

  return !error && data !== null;
}

// Main handler
serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (req.method !== 'POST') {
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only POST method allowed',
      },
    };

    return new Response(
      JSON.stringify(errorResponse),
      {
        status: 405,
        headers: { ...corsHeaders, ...securityHeaders },
      },
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
          message: 'Authentication required',
        },
      };

      return new Response(
        JSON.stringify(errorResponse),
        {
          status: 401,
          headers: { ...corsHeaders, ...securityHeaders },
        },
      );
    }

    // Parse and validate request
    const body = await req.json();
    const validation = validateRequest(CreateVocabularySchema, body);

    if (!validation.isValid) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: validation.errors?.errors,
        },
      };

      return new Response(
        JSON.stringify(errorResponse),
        {
          status: 400,
          headers: { ...corsHeaders, ...securityHeaders },
        },
      );
    }

    const data = validation.data as CreateVocabularyRequest;

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );

    // Check for duplicate
    const isDuplicate = await checkDuplicate(
      supabase,
      user.id,
      data.word,
      data.context,
    );

    if (isDuplicate) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'DUPLICATE_ENTRY',
          message: 'This vocabulary entry already exists',
          details: { word: data.word, context: data.context },
        },
      };

      return new Response(
        JSON.stringify(errorResponse),
        {
          status: 409,
          headers: { ...corsHeaders, ...securityHeaders },
        },
      );
    }

    // Initialize spaced repetition data
    const initialState = getInitialState(data.difficulty);
    const nextReviewDate = getNextReviewDate(initialState.interval);

    // Create vocabulary entry
    const { data: vocabulary, error } = await supabase
      .from('vocabulary_entries')
      .insert({
        user_id: user.id,
        word: data.word,
        definition: data.definition,
        context: data.context,
        video_id: data.video_id,
        timestamp: data.timestamp,
        difficulty: data.difficulty || 'intermediate',
        part_of_speech: data.part_of_speech,
        next_review_at: nextReviewDate,
        review_count: 0,
        success_rate: 0,
        learned_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);

      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to create vocabulary entry',
          details: error,
        },
      };

      return new Response(
        JSON.stringify(errorResponse),
        {
          status: 500,
          headers: { ...corsHeaders, ...securityHeaders },
        },
      );
    }

    // Update learning session if active
    const { data: activeSession } = await supabase
      .from('learning_sessions')
      .select('id, words_learned')
      .eq('user_id', user.id)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (activeSession) {
      await supabase
        .from('learning_sessions')
        .update({
          words_learned: activeSession.words_learned + 1,
        })
        .eq('id', activeSession.id);
    }

    // Return success response
    const successResponse: SuccessResponse = {
      success: true,
      data: vocabulary,
    };

    return new Response(
      JSON.stringify(successResponse),
      {
        status: 201,
        headers: { ...corsHeaders, ...securityHeaders },
      },
    );
  } catch (error: any) {
    console.error('Unexpected error:', error);

    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    };

    return new Response(
      JSON.stringify(errorResponse),
      {
        status: 500,
        headers: { ...corsHeaders, ...securityHeaders },
      },
    );
  }
});
