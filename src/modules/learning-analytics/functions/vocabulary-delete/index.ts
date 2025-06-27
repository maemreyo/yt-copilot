import { serve } from 'std/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { UUIDParamSchema, validateRequest } from '_shared/validators.ts';
import type { SuccessResponse, ErrorResponse } from '_shared/types.ts';

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

  if (req.method !== 'DELETE') {
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only DELETE method allowed'
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

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );

    // Check if vocabulary entry exists and belongs to user
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

    // Delete vocabulary entry
    const { error: deleteError } = await supabase
      .from('vocabulary_entries')
      .delete()
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

    // Return success response
    const successResponse: SuccessResponse<{ deleted: boolean; id: string }> = {
      success: true,
      data: {
        deleted: true,
        id: vocabularyId
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