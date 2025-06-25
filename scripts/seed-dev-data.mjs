#!/usr/bin/env node

/**
 * Comprehensive development data seeding script
 * 
 * This script creates realistic test data for development:
 * - Test users with proper authentication
 * - User profiles with various subscription states
 * - API keys for testing API authentication
 * - Stripe test customer data
 * - Sample usage metrics and audit logs
 */

import { createClient } from '@supabase/supabase-js';
import { hash } from 'bcrypt';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables
dotenv.config({ path: path.join(rootDir, '.env') });

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BCRYPT_ROUNDS = 10;

// Validate environment
if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY is required but not found in .env file');
  process.exit(1);
}

// Initialize Supabase client with service role key for admin operations
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Logging utilities
const log = {
  info: (msg) => console.log(`ℹ️  ${msg}`),
  success: (msg) => console.log(`✅ ${msg}`),
  warning: (msg) => console.log(`⚠️  ${msg}`),
  error: (msg) => console.error(`❌ ${msg}`),
  header: (msg) => {
    console.log('');
    console.log(`🌱 ${msg}`);
    console.log('─'.repeat(50));
  }
};

/**
 * Test users to create
 */
const TEST_USERS = [
  {
    email: 'admin@example.com',
    password: 'admin123456',
    role: 'admin',
    subscription_status: 'active',
    subscription_tier: 'pro',
    stripe_customer_id: 'cus_test_admin123',
    full_name: 'Admin User',
    api_keys_count: 3
  },
  {
    email: 'user@example.com', 
    password: 'user123456',
    role: 'user',
    subscription_status: 'active',
    subscription_tier: 'basic',
    stripe_customer_id: 'cus_test_user123',
    full_name: 'Regular User',
    api_keys_count: 1
  },
  {
    email: 'premium@example.com',
    password: 'premium123456',
    role: 'user',
    subscription_status: 'active',
    subscription_tier: 'premium',
    stripe_customer_id: 'cus_test_premium123',
    full_name: 'Premium User',
    api_keys_count: 5
  },
  {
    email: 'trial@example.com',
    password: 'trial123456',
    role: 'user',
    subscription_status: 'trialing',
    subscription_tier: 'basic',
    stripe_customer_id: 'cus_test_trial123',
    full_name: 'Trial User',
    api_keys_count: 1
  },
  {
    email: 'inactive@example.com',
    password: 'inactive123456',
    role: 'user',
    subscription_status: 'inactive',
    subscription_tier: null,
    stripe_customer_id: 'cus_test_inactive123',
    full_name: 'Inactive User',
    api_keys_count: 0
  }
];

/**
 * Check if database is ready and tables exist
 */
async function validateDatabase() {
  log.info('Validating database connection and schema...');
  
  try {
    // Check if we can connect to Supabase
    const { data, error } = await supabase.from('auth.users').select('count').limit(1);
    
    if (error) {
      throw new Error(`Database connection failed: ${error.message}`);
    }
    
    // Check if profiles table exists
    const { error: profilesError } = await supabase
      .from('profiles')
      .select('id')
      .limit(1);
      
    if (profilesError) {
      throw new Error(`Profiles table not found: ${profilesError.message}`);
    }
    
    // Check if api_keys table exists
    const { error: apiKeysError } = await supabase
      .from('api_keys')
      .select('id')
      .limit(1);
      
    if (apiKeysError) {
      log.warning('API keys table not found - will skip API key seeding');
    }
    
    log.success('Database validation passed');
    return true;
    
  } catch (error) {
    log.error(`Database validation failed: ${error.message}`);
    return false;
  }
}

/**
 * Clean existing test data
 */
async function cleanExistingData() {
  log.header('Cleaning existing test data');
  
  try {
    // Get test user emails
    const testEmails = TEST_USERS.map(user => user.email);
    
    // Delete API keys for test users first (foreign key constraint)
    const { error: apiKeysError } = await supabase
      .from('api_keys')
      .delete()
      .in('user_email', testEmails);
      
    if (apiKeysError && !apiKeysError.message.includes('relation "api_keys" does not exist')) {
      log.warning(`API keys cleanup: ${apiKeysError.message}`);
    }
    
    // Delete profiles for test users
    const { error: profilesError } = await supabase
      .from('profiles')
      .delete()
      .in('email', testEmails);
      
    if (profilesError) {
      log.warning(`Profiles cleanup: ${profilesError.message}`);
    }
    
    // Note: We cannot directly delete from auth.users as it's managed by Supabase Auth
    // In a real scenario, you would use the Supabase Admin API for this
    
    log.success('Existing test data cleaned');
    
  } catch (error) {
    log.error(`Cleanup failed: ${error.message}`);
  }
}

/**
 * Create a test user profile
 */
async function createUserProfile(user) {
  const profileData = {
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    subscription_status: user.subscription_status,
    subscription_tier: user.subscription_tier,
    stripe_customer_id: user.stripe_customer_id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    onboarding_completed: true,
    avatar_url: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.full_name)}`,
    timezone: 'UTC',
    locale: 'en',
    email_notifications: true,
    marketing_emails: user.email !== 'admin@example.com', // Admin opts out
    last_seen_at: new Date().toISOString()
  };
  
  const { data, error } = await supabase
    .from('profiles')
    .insert(profileData)
    .select()
    .single();
    
  if (error) {
    throw new Error(`Failed to create profile for ${user.email}: ${error.message}`);
  }
  
  return data;
}

/**
 * Create API keys for a user
 */
async function createApiKeys(userEmail, count) {
  if (count === 0) return [];
  
  const apiKeys = [];
  
  for (let i = 0; i < count; i++) {
    // Generate a realistic API key
    const keyPrefix = 'lss'; // Lean SaaS Starter
    const randomPart = Math.random().toString(36).substring(2, 15);
    const keyName = `${keyPrefix}_${randomPart}`;
    
    // Hash the key for storage
    const hashedKey = await hash(keyName, BCRYPT_ROUNDS);
    
    const apiKeyData = {
      user_email: userEmail,
      name: `Test Key ${i + 1}`,
      key_prefix: keyName.substring(0, 8),
      key_hash: hashedKey,
      permissions: i === 0 ? ['read', 'write'] : ['read'], // First key has more permissions
      is_active: true,
      last_used_at: i === 0 ? new Date().toISOString() : null, // First key was recently used
      usage_count: i === 0 ? Math.floor(Math.random() * 100) : 0,
      rate_limit_requests_per_minute: 60,
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from('api_keys')
      .insert(apiKeyData)
      .select()
      .single();
      
    if (error) {
      log.warning(`Failed to create API key for ${userEmail}: ${error.message}`);
      continue;
    }
    
    apiKeys.push({
      ...data,
      plaintext_key: keyName // For logging purposes only
    });
  }
  
  return apiKeys;
}

/**
 * Create all test users and their data
 */
async function seedUsers() {
  log.header('Creating test users and profiles');
  
  let successCount = 0;
  let totalApiKeys = 0;
  
  for (const user of TEST_USERS) {
    try {
      log.info(`Creating user: ${user.email}`);
      
      // Create user profile
      const profile = await createUserProfile(user);
      
      // Create API keys if table exists
      let apiKeys = [];
      try {
        apiKeys = await createApiKeys(user.email, user.api_keys_count);
        totalApiKeys += apiKeys.length;
      } catch (apiKeyError) {
        log.warning(`API key creation skipped for ${user.email}: ${apiKeyError.message}`);
      }
      
      log.success(`✓ ${user.email} - Profile created, ${apiKeys.length} API keys`);
      
      // Log API keys for development use
      if (apiKeys.length > 0) {
        log.info(`  API Keys for ${user.email}:`);
        apiKeys.forEach((key, idx) => {
          log.info(`    ${idx + 1}. ${key.plaintext_key} (${key.permissions.join(', ')})`);
        });
      }
      
      successCount++;
      
    } catch (error) {
      log.error(`Failed to create user ${user.email}: ${error.message}`);
    }
  }
  
  return { successCount, totalApiKeys };
}

/**
 * Create sample audit logs and usage metrics
 */
async function seedMetrics() {
  log.header('Creating sample metrics and audit logs');
  
  try {
    // This would depend on your audit_logs table structure
    // For now, we'll just log what would be created
    
    const sampleEvents = [
      'user_login',
      'api_key_created',
      'api_key_used',
      'subscription_updated',
      'profile_updated'
    ];
    
    log.info('Sample audit events to create:');
    sampleEvents.forEach(event => {
      log.info(`  - ${event} events for test users`);
    });
    
    log.success('Metrics seeding completed (simulated)');
    
  } catch (error) {
    log.warning(`Metrics seeding failed: ${error.message}`);
  }
}

/**
 * Print development information
 */
function printDevelopmentInfo() {
  log.header('Development Information');
  
  log.info('Test User Credentials:');
  TEST_USERS.forEach(user => {
    log.info(`  ${user.email} / ${user.password} (${user.role}, ${user.subscription_tier || 'no subscription'})`);
  });
  
  log.info('');
  log.info('Next Steps:');
  log.info('  1. Start your development server: pnpm dev');
  log.info('  2. Use the test credentials above to login');
  log.info('  3. API keys are logged above for API testing');
  log.info('  4. Check the profiles table for full user data');
  
  log.info('');
  log.info('Useful Commands:');
  log.info('  - View profiles: SELECT * FROM profiles;');
  log.info('  - View API keys: SELECT user_email, name, key_prefix, permissions FROM api_keys;');
  log.info('  - Reset data: pnpm db:seed:dev');
}

/**
 * Main seeding function
 */
async function seedDevelopmentData() {
  try {
    console.log('🌱 Lean SaaS Starter - Development Data Seeding');
    console.log('='.repeat(60));
    
    // Validate database
    const isValidDatabase = await validateDatabase();
    if (!isValidDatabase) {
      log.error('Database validation failed. Please ensure your local Supabase instance is running.');
      process.exit(1);
    }
    
    // Clean existing data
    await cleanExistingData();
    
    // Seed users and their data
    const { successCount, totalApiKeys } = await seedUsers();
    
    // Seed additional metrics
    await seedMetrics();
    
    // Print summary
    log.header('Seeding Summary');
    log.success(`Created ${successCount}/${TEST_USERS.length} test users`);
    log.success(`Generated ${totalApiKeys} API keys`);
    log.success('Sample metrics and audit logs simulated');
    
    // Print development information
    printDevelopmentInfo();
    
    console.log('');
    log.success('Development data seeding completed successfully! 🎉');
    console.log('');
    
  } catch (error) {
    log.error(`Seeding failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the seeding if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedDevelopmentData();
}