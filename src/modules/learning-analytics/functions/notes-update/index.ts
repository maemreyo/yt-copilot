import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { UpdateNoteSchema } from '../../_shared/validators.ts';
import type { 
  UpdateNoteRequest,
  VideoNote,
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

// Extract ID from URL path
function extractIdFromPath(url: string): string | null {
  const pathMatch = url.match(/\/notes\/([a-f0-9-]{36})$/);
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
        message: 'Only PUT method is allowed'
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
    // Extract note ID from URL
    const noteId = extractIdFromPath(request.url);
    if (!noteId) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Invalid note ID format'
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

    // Parse and validate request body
    const body = await request.json();
    const validation = UpdateNoteSchema.safeParse(body);
    
    if (!validation.success) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
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
    
    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
      { auth: { persistSession: false } }
    );

    // Get existing note
    const { data: existing, error: fetchError } = await supabase
      .from('video_notes')
      .select('*')
      .eq('id', noteId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .single();

    if (fetchError || !existing) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Note not found'
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

    // Prepare update object
    const updates: any = {
      updated_at: new Date().toISOString()
    };

    // Update fields if provided
    if (updateData.content !== undefined) {
      updates.content = updateData.content;
    }
    
    if (updateData.tags !== undefined) {
      updates.tags = updateData.tags;
    }
    
    if (updateData.is_private !== undefined) {
      updates.is_private = updateData.is_private;
    }
    
    if (updateData.formatting !== undefined) {
      updates.formatting = updateData.formatting;
    }

    // Update note
    const { data: updated, error: updateError } = await supabase
      .from('video_notes')
      .update(updates)
      .eq('id', noteId)
      .eq('user_id', user.id)
      .select(`
        *,
        youtube_videos!video_id(
          id,
          title,
          channel_name,
          thumbnail_url,
          duration
        )
      `)
      .single();

    if (updateError) {
      console.error('Database error:', updateError);
      
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to update note',
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