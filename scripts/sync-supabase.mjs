#!/usr/bin/env node

/**
 * Script to synchronize modules from src/modules to supabase/_internal
 * This script follows the CORE_IDEA.md specification:
 * 1. Reads all modules from src/modules
 * 2. Copies migrations to supabase/_internal/migrations with naming: {module}_{filename}.sql
 * 3. Copies functions to supabase/_internal/functions with naming: {module}_{functionname}
 * 4. Handles _shared directories correctly
 * 5. Provides comprehensive error handling and logging
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const modulesDir = path.join(rootDir, 'src', 'modules');
const internalDir = path.join(rootDir, 'supabase', '_internal');

// ANSI color codes for pretty logging
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

const log = {
  info: msg => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: msg => console.log(`${colors.green}✅${colors.reset} ${msg}`),
  warning: msg => console.log(`${colors.yellow}⚠️${colors.reset} ${msg}`),
  error: msg => console.log(`${colors.red}❌${colors.reset} ${msg}`),
  step: msg => console.log(`${colors.cyan}🔄${colors.reset} ${msg}`),
  header: msg => console.log(`${colors.bright}${colors.magenta}📦 ${msg}${colors.reset}`),
};

/**
 * Ensures a directory exists, creating it if necessary
 */
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    log.success(`Created directory: ${path.relative(rootDir, dirPath)}`);
  }
}

/**
 * Recursively copies a directory
 */
function copyDirectory(src, dest) {
  ensureDirectoryExists(dest);

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Validates that a module has the correct structure
 */
function validateModuleStructure(modulePath, moduleName) {
  const hasValidStructure = {
    migrations: false,
    functions: false,
    tests: false,
  };

  // Check for migrations directory
  const migrationsPath = path.join(modulePath, 'migrations');
  if (fs.existsSync(migrationsPath)) {
    hasValidStructure.migrations = true;
    log.info(`  📄 Found migrations directory`);
  }

  // Check for functions directory
  const functionsPath = path.join(modulePath, 'functions');
  if (fs.existsSync(functionsPath)) {
    hasValidStructure.functions = true;
    log.info(`  🔧 Found functions directory`);
  }

  // Check for tests directory
  const testsPath = path.join(modulePath, 'tests');
  if (fs.existsSync(testsPath)) {
    hasValidStructure.tests = true;
    log.info(`  🧪 Found tests directory`);
  }

  // Check for OpenAPI spec
  const openapiPath = path.join(modulePath, 'openapi.yaml');
  if (fs.existsSync(openapiPath)) {
    log.info(`  📚 Found OpenAPI specification`);
  }

  if (!hasValidStructure.migrations && !hasValidStructure.functions) {
    log.warning(`  Module ${moduleName} has no migrations or functions`);
  }

  return hasValidStructure;
}

/**
 * Processes migrations for a module
 */
function processMigrations(moduleName, migrationsPath, targetDir) {
  log.step(`Processing migrations for module: ${moduleName}`);

  if (!fs.existsSync(migrationsPath)) {
    log.info(`  No migrations directory found for ${moduleName}`);
    return 0;
  }

  const migrationFiles = fs
    .readdirSync(migrationsPath)
    .filter(file => file.endsWith('.sql'))
    .sort(); // Ensure migrations are processed in order

  let processedCount = 0;

  for (const file of migrationFiles) {
    const srcFile = path.join(migrationsPath, file);
    const destFile = path.join(targetDir, `${moduleName}_${file}`);

    try {
      fs.copyFileSync(srcFile, destFile);
      log.success(`  ✅ ${file} → ${moduleName}_${file}`);
      processedCount++;
    } catch (error) {
      log.error(`  Failed to copy ${file}: ${error.message}`);
    }
  }

  return processedCount;
}

/**
 * Processes functions for a module with corrected _shared handling
 */
function processFunctions(moduleName, functionsPath, targetDir) {
  log.step(`Processing functions for module: ${moduleName}`);

  if (!fs.existsSync(functionsPath)) {
    log.info(`  No functions directory found for ${moduleName}`);
    return 0;
  }

  const functionDirs = fs
    .readdirSync(functionsPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  let processedCount = 0;

  for (const funcDir of functionDirs) {
    // Skip _shared directories - they will be handled separately
    if (funcDir.startsWith('_shared')) {
      log.info(`  Skipping _shared directory: ${funcDir} (will be handled globally)`);
      continue;
    }

    const srcDir = path.join(functionsPath, funcDir);
    const destDir = path.join(targetDir, `${moduleName}_${funcDir}`);

    try {
      copyDirectory(srcDir, destDir);
      log.success(`  ✅ ${funcDir}/ → ${moduleName}_${funcDir}/`);
      processedCount++;
    } catch (error) {
      log.error(`  Failed to copy ${funcDir}: ${error.message}`);
    }
  }

  return processedCount;
}

/**
 * Process all _shared directories globally after all modules
 */
function processSharedDirectories(modules, targetDir) {
  log.header('Processing Global _shared Directories');

  const globalSharedDir = path.join(targetDir, '_shared');

  // Create global _shared directory
  ensureDirectoryExists(globalSharedDir);

  // Track processed shared files to avoid duplicates
  const processedFiles = new Set();
  let totalSharedFiles = 0;

  for (const module of modules) {
    const moduleDir = path.join(modulesDir, module);
    const functionsPath = path.join(moduleDir, 'functions');
    const sharedPath = path.join(functionsPath, '_shared');

    if (!fs.existsSync(sharedPath)) {
      continue;
    }

    log.step(`Processing _shared from module: ${module}`);

    // Read all files in _shared directory
    const sharedFiles = fs.readdirSync(sharedPath, { withFileTypes: true });

    for (const file of sharedFiles) {
      if (file.isFile()) {
        const fileName = file.name;
        const srcFile = path.join(sharedPath, fileName);
        const destFile = path.join(globalSharedDir, fileName);

        // Check if file already processed
        if (processedFiles.has(fileName)) {
          log.warning(
            `  ⚠️  File ${fileName} already exists in global _shared (from another module)`
          );
          continue;
        }

        try {
          fs.copyFileSync(srcFile, destFile);
          processedFiles.add(fileName);
          log.success(`  ✅ ${fileName} → _shared/${fileName}`);
          totalSharedFiles++;
        } catch (error) {
          log.error(`  Failed to copy ${fileName}: ${error.message}`);
        }
      }
    }
  }

  if (totalSharedFiles > 0) {
    log.success(`✅ Created global _shared directory with ${totalSharedFiles} files`);
  } else {
    log.info('No _shared files found to process');
  }

  return totalSharedFiles;
}

/**
 * Cleans up the internal directory before sync
 */
function cleanupInternalDirectory() {
  log.step('Cleaning up existing _internal directory...');

  const migrationsDir = path.join(internalDir, 'migrations');
  const functionsDir = path.join(internalDir, 'functions');

  if (fs.existsSync(migrationsDir)) {
    fs.rmSync(migrationsDir, { recursive: true, force: true });
    log.success('Cleaned migrations directory');
  }

  if (fs.existsSync(functionsDir)) {
    fs.rmSync(functionsDir, { recursive: true, force: true });
    log.success('Cleaned functions directory');
  }
}

/**
 * Creates necessary internal directories
 */
function setupInternalDirectories() {
  log.step('Setting up _internal directories...');

  const migrationsDir = path.join(internalDir, 'migrations');
  const functionsDir = path.join(internalDir, 'functions');

  ensureDirectoryExists(migrationsDir);
  ensureDirectoryExists(functionsDir);
}

/**
 * Discovers and validates all modules
 */
function discoverModules() {
  log.step('Discovering modules...');

  if (!fs.existsSync(modulesDir)) {
    log.error(`Modules directory not found: ${modulesDir}`);
    process.exit(1);
  }

  const modules = fs
    .readdirSync(modulesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  if (modules.length === 0) {
    log.warning('No modules found in src/modules/');
    return [];
  }

  log.success(`Found ${modules.length} modules: ${modules.join(', ')}`);
  return modules;
}

/**
 * Main synchronization function with global _shared processing
 */
function syncModules() {
  log.header('Starting Supabase Module Synchronization');
  log.info(`Root directory: ${rootDir}`);
  log.info(`Modules directory: ${modulesDir}`);
  log.info(`Target directory: ${internalDir}`);
  console.log(''); // Empty line for readability

  try {
    // Step 1: Discover modules
    const modules = discoverModules();

    if (modules.length === 0) {
      log.warning('No modules to sync. Exiting.');
      return;
    }

    // Step 2: Clean up and setup directories
    cleanupInternalDirectory();
    setupInternalDirectories();

    // Step 3: Process each module (excluding _shared)
    const migrationsDir = path.join(internalDir, 'migrations');
    const functionsDir = path.join(internalDir, 'functions');

    let totalMigrations = 0;
    let totalFunctions = 0;

    for (const module of modules) {
      log.header(`Processing module: ${module}`);
      const moduleDir = path.join(modulesDir, module);

      // Validate module structure
      const structure = validateModuleStructure(moduleDir, module);

      // Process migrations
      const migrationsPath = path.join(moduleDir, 'migrations');
      const migrationCount = processMigrations(module, migrationsPath, migrationsDir);
      totalMigrations += migrationCount;

      // Process functions (excluding _shared)
      const functionsPath = path.join(moduleDir, 'functions');
      const functionCount = processFunctions(module, functionsPath, functionsDir);
      totalFunctions += functionCount;

      console.log(''); // Empty line between modules
    }

    // Step 4: Process global _shared directories
    const sharedCount = processSharedDirectories(modules, functionsDir);

    // Step 5: Summary
    log.header('Synchronization Summary');
    log.success(`✅ Processed ${modules.length} modules`);
    log.success(`✅ Synced ${totalMigrations} migration files`);
    log.success(`✅ Synced ${totalFunctions} function directories`);
    log.success(`✅ Created global _shared with ${sharedCount} files`);
    log.info('📁 Files synced to supabase/_internal/');
    log.info('🚀 Ready for Supabase CLI commands!');
  } catch (error) {
    log.error(`Synchronization failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * Validates environment and dependencies
 */
function validateEnvironment() {
  // Check if we're in the right directory
  const packageJsonPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    log.error("package.json not found. Make sure you're running this from the project root.");
    process.exit(1);
  }

  // Check if supabase directory exists
  const supabaseDir = path.join(rootDir, 'supabase');
  if (!fs.existsSync(supabaseDir)) {
    log.error('supabase/ directory not found. Make sure this is a Supabase project.');
    process.exit(1);
  }

  log.success('Environment validation passed');
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(''); // Start with empty line
  validateEnvironment();
  syncModules();
  console.log(''); // End with empty line
}
