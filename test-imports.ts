// Test imports with Deno
console.log('Testing imports with Deno...');

// Test standard library import
import { serve } from 'std/http/server.ts';
console.log('✅ Standard library import successful');

// Test external dependency import
import { createClient } from '@supabase/supabase-js';
console.log('✅ External dependency import successful');

// Test shared utility imports
import { corsHeaders } from '@/cors';
import { securityHeaders } from '@/shared-security';
import { validateRequestBody } from '@/shared-validation';
import { createAppError, ErrorType } from '@/shared-errors';

console.log('✅ Shared utility imports successful');
console.log('CORS Headers:', corsHeaders);
console.log('Security Headers:', securityHeaders);

console.log('All imports working correctly!');
