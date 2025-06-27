import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import {
  CreateNoteSchema,
  sanitizeTags,
  validateRequest,
} from '_shared/validators.ts';
import type {
  CreateNoteRequest,
  ErrorResponse,
  SuccessResponse,
  VideoNote,
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

// Verify video exists and user has access
async function verifyVideoAccess(
  supabase: any,
  userId: string,
  videoId: string,
): Promise<boolean> {
  // Check if video exists
  const { data: video, error: videoError } = await supabase
    .from('youtube_videos')
    .select('id')
    .eq('id', videoId)
    .single();

  if (videoError || !video) {
    return false;
  }

  // Check if user has access (through video history)
  const { data: history, error: historyError } = await supabase
    .from('user_video_history')
    .select('id')
    .eq('user_id', userId)
    .eq('video_id', videoId)
    .single();

  return !historyError && history !== null;
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
    const validation = validateRequest(CreateNoteSchema, body);

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

    const data = validation.data as CreateNoteRequest;

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );

    // Verify video access
    const hasAccess = await verifyVideoAccess(supabase, user.id, data.video_id);

    if (!hasAccess) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have access to this video',
          details: { video_id: data.video_id },
        },
      };

      return new Response(
        JSON.stringify(errorResponse),
        {
          status: 403,
          headers: { ...corsHeaders, ...securityHeaders },
        },
      );
    }

    // Sanitize tags if provided
    const sanitizedTags = data.tags ? sanitizeTags(data.tags) : [];

    // Create note
    const { data: note, error } = await supabase
      .from('video_notes')
      .insert({
        user_id: user.id,
        video_id: data.video_id,
        content: data.content,
        timestamp: data.timestamp,
        tags: sanitizedTags,
        is_private: data.is_private ?? true,
        formatting: data.formatting || { type: 'plain' },
      })
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);

      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to create note',
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
      .select('id, notes_taken')
      .eq('user_id', user.id)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (activeSession) {
      await supabase
        .from('learning_sessions')
        .update({
          notes_taken: activeSession.notes_taken + 1,
        })
        .eq('id', activeSession.id);
    }

    // Return success response
    const successResponse: SuccessResponse<VideoNote> = {
      success: true,
      data: note,
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
