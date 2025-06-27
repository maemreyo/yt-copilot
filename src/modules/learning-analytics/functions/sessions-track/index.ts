import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { CreateSessionSchema, UpdateSessionSchema } from '../../_shared/validators.ts';
import type { 
  CreateSessionRequest,
  UpdateSessionRequest,
  LearningSession,
  SuccessResponse, 
  ErrorResponse 
} from '../../_shared/types.ts';

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

serve(async (request: Request) => {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Only allow POST
  if (request.method !== 'POST') {
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only POST method is allowed'
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
    const user = await extractUser(request);
    if (!user) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or missing authentication token'
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
    const body = await request.json();
    
    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
      { auth: { persistSession: false } }
    );

    // Check if this is a session end request (has session_id)
    if (body.session_id) {
      // Validate update request
      const validation = UpdateSessionSchema.safeParse(body);
      
      if (!validation.success) {
        const errorResponse: ErrorResponse = {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid session update data',
            details: validation.error.errors
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

      const updateData = validation.data;

      // Get existing session
      const { data: existingSession, error: fetchError } = await supabase
        .from('learning_sessions')
        .select('*')
        .eq('id', body.session_id)
        .eq('user_id', user.id)
        .is('ended_at', null)
        .single();

      if (fetchError || !existingSession) {
        const errorResponse: ErrorResponse = {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Active session not found'
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

      // Calculate duration if ending session
      const startTime = new Date(existingSession.started_at).getTime();
      const endTime = updateData.ended_at ? new Date(updateData.ended_at).getTime() : Date.now();
      const duration_seconds = Math.floor((endTime - startTime) / 1000);

      // Update session
      const updates: any = {
        ...updateData,
        duration_seconds
      };

      const { data: updatedSession, error: updateError } = await supabase
        .from('learning_sessions')
        .update(updates)
        .eq('id', body.session_id)
        .eq('user_id', user.id)
        .select()
        .single();

      if (updateError) {
        console.error('Database error:', updateError);
        
        const errorResponse: ErrorResponse = {
          success: false,
          error: {
            code: 'DATABASE_ERROR',
            message: 'Failed to update session',
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
      const successResponse: SuccessResponse = {
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

    } else {
      // This is a session start request
      const validation = CreateSessionSchema.safeParse(body);
      
      if (!validation.success) {
        const errorResponse: ErrorResponse = {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid session creation data',
            details: validation.error.errors
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

      const sessionData = validation.data;

      // Check for existing active session
      const { data: activeSession } = await supabase
        .from('learning_sessions')
        .select('id')
        .eq('user_id', user.id)
        .is('ended_at', null)
        .single();

      if (activeSession) {
        // Auto-end previous session
        await supabase
          .from('learning_sessions')
          .update({
            ended_at: new Date().toISOString(),
            duration_seconds: 0 // Will be calculated in a scheduled job
          })
          .eq('id', activeSession.id);
      }

      // Verify video access if video_id provided
      if (sessionData.video_id) {
        const { data: video, error: videoError } = await supabase
          .from('youtube_videos')
          .select('id')
          .eq('id', sessionData.video_id)
          .single();

        if (videoError || !video) {
          const errorResponse: ErrorResponse = {
            success: false,
            error: {
              code: 'INVALID_VIDEO',
              message: 'Video not found or not accessible'
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
      }

      // Create new session
      const { data: newSession, error: createError } = await supabase
        .from('learning_sessions')
        .insert({
          user_id: user.id,
          video_id: sessionData.video_id,
          session_type: sessionData.session_type,
          session_data: sessionData.session_data || {},
          started_at: new Date().toISOString(),
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
            message: 'Failed to create session',
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

      // Return success response
      const successResponse: SuccessResponse = {
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