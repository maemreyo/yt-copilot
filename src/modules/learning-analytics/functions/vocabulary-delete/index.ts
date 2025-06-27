import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import type { SuccessResponse, ErrorResponse } from '../../_shared/types.ts';

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

serve(async (request: Request) => {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Only allow DELETE
  if (request.method !== 'DELETE') {
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only DELETE method is allowed'
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
    // Extract vocabulary ID from URL
    const vocabularyId = extractIdFromPath(request.url);
    if (!vocabularyId) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'INVALID_ID',
          message: 'Invalid vocabulary ID format'
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

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
      { auth: { persistSession: false } }
    );

    // Check if vocabulary entry exists
    const { data: existing, error: fetchError } = await supabase
      .from('vocabulary_entries')
      .select('id')
      .eq('id', vocabularyId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !existing) {
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Vocabulary entry not found'
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

    // Soft delete to preserve analytics
    const { error: deleteError } = await supabase
      .from('vocabulary_entries')
      .update({
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', vocabularyId)
      .eq('user_id', user.id);

    if (deleteError) {
      console.error('Database error:', deleteError);
      
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to delete vocabulary entry',
          details: deleteError
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

    // Update learning session if active
    const { data: activeSession } = await supabase
      .from('learning_sessions')
      .select('id, words_learned')
      .eq('user_id', user.id)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (activeSession && activeSession.words_learned > 0) {
      await supabase
        .from('learning_sessions')
        .update({
          words_learned: activeSession.words_learned - 1
        })
        .eq('id', activeSession.id);
    }

    // Return success response
    const successResponse: SuccessResponse = {
      success: true,
      data: {
        id: vocabularyId,
        deleted: true
      }
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