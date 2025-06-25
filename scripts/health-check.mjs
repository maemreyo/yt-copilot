#!/usr/bin/env node

/**
 * Script to check the health of all services
 * This script:
 * 1. Checks if Supabase is running
 * 2. Checks if the database is accessible
 * 3. Checks if Edge Functions are working
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables
dotenv.config({ path: path.join(rootDir, '.env') });

const supabaseUrl = process.env.SUPABASE_URL || 'http://localhost:54321';
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_ANON_KEY is required but not found in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkHealth() {
  console.log('🔍 Checking health of services...');
  
  // Check Supabase connection
  try {
    console.log('🔄 Checking Supabase connection...');
    const { data, error } = await supabase.from('_health').select('*').limit(1);
    
    if (error) {
      console.error('❌ Supabase connection failed:', error);
    } else {
      console.log('✅ Supabase connection successful');
    }
  } catch (error) {
    console.error('❌ Supabase connection failed:', error);
  }
  
  // Check Edge Functions
  try {
    console.log('🔄 Checking Edge Functions...');
    const response = await fetch(`${supabaseUrl}/functions/v1/core_health-check`);
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Edge Functions are working:', data);
    } else {
      console.error('❌ Edge Functions check failed:', await response.text());
    }
  } catch (error) {
    console.error('❌ Edge Functions check failed:', error);
  }
  
  console.log('✅ Health check completed');
}

// Run the health check
checkHealth();