// Global test environment setup and teardown

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { TestDatabaseManager } from '../utils/testing';

/**
 * Global setup function - runs once before all tests
 */
export async function setup() {
  console.log('🔧 Setting up test environment...');

  try {
    // Check if Supabase CLI is available
    await checkSupabaseCLI();

    // Start Supabase if not already running
    await startSupabase();

    // Wait for Supabase to be ready
    await waitForSupabase();

    // Run migrations and setup test database
    await setupTestDatabase();

    console.log('✅ Test environment setup complete');
  } catch (error: any) {
    console.error('❌ Test environment setup failed:', error);
    throw error;
  }
}

/**
 * Global teardown function - runs once after all tests
 */
export async function teardown() {
  console.log('🧹 Cleaning up test environment...');

  try {
    // Clean up test data
    const dbManager = new TestDatabaseManager();
    await dbManager.cleanup();

    // Note: We don't stop Supabase here as it might be used by other processes
    // In CI/CD environments, the container will be destroyed anyway

    console.log('✅ Test environment cleanup complete');
  } catch (error: any) {
    console.error('❌ Test environment cleanup failed:', error);
    // Don't throw here to avoid masking test failures
  }
}

/**
 * Check if Supabase CLI is available
 */
async function checkSupabaseCLI(): Promise<void> {
  try {
    execSync('supabase --version', { stdio: 'pipe' });
  } catch (error: any) {
    throw new Error('Supabase CLI not found. Please install it with: npm install -g supabase');
  }
}

/**
 * Start Supabase local development environment
 */
async function startSupabase(): Promise<void> {
  try {
    // Check if Supabase is already running
    const isRunning = await checkSupabaseStatus();

    if (isRunning) {
      console.log('📡 Supabase is already running');
      return;
    }

    console.log('🚀 Starting Supabase...');

    // Change to project root directory
    const projectRoot = findProjectRoot();
    process.chdir(projectRoot);

    // Start Supabase
    execSync('supabase start', {
      stdio: 'inherit',
      timeout: 120000, // 2 minutes timeout
    });

    console.log('✅ Supabase started successfully');
  } catch (error: any) {
    throw new Error(`Failed to start Supabase: ${error}`);
  }
}

/**
 * Check if Supabase is running
 */
async function checkSupabaseStatus(): Promise<boolean> {
  try {
    execSync('supabase status', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for Supabase to be ready to accept connections
 */
async function waitForSupabase(): Promise<void> {
  const maxAttempts = 30;
  const delayMs = 2000;

  console.log('⏳ Waiting for Supabase to be ready...');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Try to connect to Supabase
      const response = await fetch('http://localhost:54321/health');

      if (response.ok) {
        console.log('✅ Supabase is ready');
        return;
      }
    } catch {
      // Connection failed, continue waiting
    }

    if (attempt === maxAttempts) {
      throw new Error('Timeout waiting for Supabase to be ready');
    }

    console.log(`⏳ Attempt ${attempt}/${maxAttempts}, retrying in ${delayMs}ms...`);
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
}

/**
 * Setup test database with migrations and seed data
 */
async function setupTestDatabase(): Promise<void> {
  try {
    console.log('📊 Setting up test database...');

    // Reset database to clean state
    execSync('supabase db reset --no-seed', {
      stdio: 'inherit',
      timeout: 60000, // 1 minute timeout
    });

    // Run custom seed data for tests
    await seedTestData();

    console.log('✅ Test database setup complete');
  } catch (error: any) {
    throw new Error(`Failed to setup test database: ${error}`);
  }
}

/**
 * Seed test data
 */
async function seedTestData(): Promise<void> {
  try {
    const dbManager = new TestDatabaseManager();

    // Create a few standard test users for shared use
    await dbManager.createTestUser({
      email: 'test-admin@example.com',
      role: 'admin',
    });

    await dbManager.createTestUser({
      email: 'test-user@example.com',
      role: 'user',
    });

    console.log('✅ Test data seeded');
  } catch (error: any) {
    console.warn('⚠️ Failed to seed test data:', error);
    // Don't throw here as this is not critical for all tests
  }
}

/**
 * Find project root directory
 */
function findProjectRoot(): string {
  let currentDir = process.cwd();

  while (currentDir !== path.dirname(currentDir)) {
    if (existsSync(path.join(currentDir, 'supabase', 'config.toml'))) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }

  throw new Error('Could not find project root (supabase/config.toml not found)');
}

/**
 * Validate test environment variables
 */
function validateTestEnvironment(): void {
  const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables for testing: ${missingVars.join(', ')}`
    );
  }
}

// Validate environment on module load
validateTestEnvironment();
