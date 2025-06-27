import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { CreateSessionSchema, UpdateSessionSchema, validateRequest } from '_shared/validators.ts';
import type { 
  CreateSessionRequest,
  UpdateSessionRequest,
  LearningSession,
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

// Check for active session
async function getActiveSession(
  supabase: any,
  userId: string
): Promise<LearningSession | null> {
  const { data, error } = await supabase
    .from('learning_sessions')
    .select('*')
    .eq('user_id', userId)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return data;
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

  if (req.method !== 'POST' && req.method !== 'PUT') {
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only POST and PUT methods allowed'
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

    // Parse request body
    const body = await req.json();

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );

    // Check for active session
    const activeSession = await getActiveSession(supabase, user.id);

    // Handle based on method
    if (req.method === 'POST') {
      // Start new session
      
      // Check if there's already an active session
      if (activeSession) {
        const errorResponse: ErrorResponse = {
          success: false,
          error: {
            code: 'SESSION_ACTIVE',
            message: 'You already have an active learning session',
            details: { session_id: activeSession.id }
          }
        };
        
        return new Response(
          JSON.stringify(errorResponse),
          { 
            status: 409, 
            headers: { ...corsHeaders, ...securityHeaders } 
          }
        );
      }

      // Validate request
      const validation = validateRequest(CreateSessionSchema, body);

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

      const data = validation.data as CreateSessionRequest;

      // Verify video access if video_id provided
      if (data.video_id) {
        const { data: videoAccess } = await supabase
          .from('user_video_history')
          .select('id')
          .eq('user_id', user.id)
          .eq('video_id', data.video_id)
          .single();

        if (!videoAccess) {
          const errorResponse: ErrorResponse = {
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'You do not have access to this video',
              details: { video_id: data.video_id }
            }
          };
          
          return new Response(
            JSON.stringify(errorResponse),
            { 
              status: 403, 
              headers: { ...corsHeaders, ...securityHeaders } 
            }
          );
        }
      }

      // Create new session
      const { data: newSession, error: createError } = await supabase
        .from('learning_sessions')
        .insert({
          user_id: user.id,
          video_id: data.video_id,
          session_type: data.session_type,
          session_data: data.session_data,
          words_learned: 0,
          notes_taken: 0,
          translations_requested: 0
        })
        .select()
        .single();

      if (createError) {
        console.error('Database error:', createError);
        
        const errorResponse: ErrorResponse = {
          success: false,
          error: {
            code: 'DATABASE_ERROR',
            message: 'Failed to create learning session',
            details: createError
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

      const successResponse: SuccessResponse<LearningSession> = {
        success: true,
        data: newSession
      };

      return new Response(
        JSON.stringify(successResponse),
        { 
          status: 201, 
          headers: { ...corsHeaders, ...securityHeaders } 
        }
      );

    } else {
      // PUT - End or update session
      
      if (!activeSession) {
        const errorResponse: ErrorResponse = {
          success: false,
          error: {
            code: 'NO_ACTIVE_SESSION',
            message: 'No active learning session found'
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

      // Validate request
      const validation = validateRequest(UpdateSessionSchema, body);

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

      const data = validation.data as UpdateSessionRequest;

      // Prepare update data
      const updateData: any = {};
      
      if (data.ended_at !== undefined) {
        updateData.ended_at = data.ended_at || new Date().toISOString();
      }
      
      if (data.words_learned !== undefined) {
        updateData.words_learned = activeSession.words_learned + data.words_learned;
      }
      
      if (data.notes_taken !== undefined) {
        updateData.notes_taken = activeSession.notes_taken + data.notes_taken;
      }
      
      if (data.translations_requested !== undefined) {
        updateData.translations_requested = activeSession.translations_requested + data.translations_requested;
      }
      
      if (data.session_data !== undefined) {
        updateData.session_data = {
          ...(activeSession.session_data || {}),
          ...data.session_data
        };
      }

      // Update session
      const { data: updatedSession, error: updateError } = await supabase
        .from('learning_sessions')
        .update(updateData)
        .eq('id', activeSession.id)
        .eq('user_id', user.id)
        .select()
        .single();

      if (updateError) {
        console.error('Database error:', updateError);
        
        const errorResponse: ErrorResponse = {
          success: false,
          error: {
            code: 'DATABASE_ERROR',
            message: 'Failed to update learning session',
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

      const successResponse: SuccessResponse<LearningSession> = {
        success: true,
        data: updatedSession
      };

      return new Response(
        JSON.stringify(successResponse),
        { 
          status: 200, 
          headers: { ...corsHeaders, ...securityHeaders } 
        }
      );
    }

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