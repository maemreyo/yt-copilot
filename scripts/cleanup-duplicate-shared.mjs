#!/usr/bin/env node

/**
 * Script to clean up duplicate _shared directories in modules
 * and ensure centralized _shared is the single source of truth
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

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
  header: msg => console.log(`${colors.bright}${colors.magenta}🧹 ${msg}${colors.reset}`),
};

/**
 * Find all _shared directories in modules
 */
function findModuleSharedDirectories() {
  const modulesDir = path.join(rootDir, 'src', 'modules');
  const sharedDirs = [];

  if (!fs.existsSync(modulesDir)) {
    log.warning('Modules directory not found');
    return sharedDirs;
  }

  const modules = fs
    .readdirSync(modulesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  for (const module of modules) {
    const functionsPath = path.join(modulesDir, module, 'functions');
    const sharedPath = path.join(functionsPath, '_shared');

    if (fs.existsSync(sharedPath)) {
      sharedDirs.push({
        module,
        path: sharedPath,
        relativePath: path.relative(rootDir, sharedPath),
      });
    }
  }

  return sharedDirs;
}

/**
 * Backup _shared directory before removal
 */
function backupSharedDirectory(sharedDir) {
  const backupDir = path.join(rootDir, '.backup_shared', sharedDir.module);

  try {
    // Create backup directory
    fs.mkdirSync(backupDir, { recursive: true });

    // Copy files
    const files = fs.readdirSync(sharedDir.path);
    for (const file of files) {
      const srcFile = path.join(sharedDir.path, file);
      const destFile = path.join(backupDir, file);

      if (fs.statSync(srcFile).isFile()) {
        fs.copyFileSync(srcFile, destFile);
      }
    }

    log.success(`  ✅ Backed up to .backup_shared/${sharedDir.module}/`);
    return true;
  } catch (error) {
    log.error(`  Failed to backup: ${error.message}`);
    return false;
  }
}

/**
 * Remove _shared directory
 */
function removeSharedDirectory(sharedDir) {
  try {
    fs.rmSync(sharedDir.path, { recursive: true, force: true });
    log.success(`  ✅ Removed ${sharedDir.relativePath}`);
    return true;
  } catch (error) {
    log.error(`  Failed to remove: ${error.message}`);
    return false;
  }
}

/**
 * Ensure centralized _shared directory exists
 */
function ensureCentralizedShared() {
  const centralizedSharedDir = path.join(rootDir, 'src', 'shared', 'edge-functions', '_shared');

  if (!fs.existsSync(centralizedSharedDir)) {
    log.warning('Centralized _shared directory not found');
    log.step('Creating centralized _shared directory...');

    try {
      fs.mkdirSync(centralizedSharedDir, { recursive: true });
      log.success('Created centralized _shared directory');

      // Create placeholder file
      const placeholderContent = `// Centralized shared utilities for Edge Functions
// This directory is the single source of truth for all _shared files
// Files here are automatically synced to supabase/_internal/functions/_shared/

export const SHARED_VERSION = '1.0.0';
`;

      fs.writeFileSync(path.join(centralizedSharedDir, 'index.ts'), placeholderContent, 'utf8');

      log.info('Created placeholder index.ts file');
      return true;
    } catch (error) {
      log.error(`Failed to create centralized _shared: ${error.message}`);
      return false;
    }
  }

  log.success('Centralized _shared directory exists');
  return true;
}

/**
 * Check for conflicts between module _shared and centralized _shared
 */
function checkForConflicts(sharedDirs) {
  const centralizedSharedDir = path.join(rootDir, 'src', 'shared', 'edge-functions', '_shared');

  if (!fs.existsSync(centralizedSharedDir)) {
    return { hasConflicts: false, conflicts: [] };
  }

  const centralizedFiles = fs
    .readdirSync(centralizedSharedDir)
    .filter(file => fs.statSync(path.join(centralizedSharedDir, file)).isFile());

  const conflicts = [];

  for (const sharedDir of sharedDirs) {
    const moduleFiles = fs
      .readdirSync(sharedDir.path)
      .filter(file => fs.statSync(path.join(sharedDir.path, file)).isFile());

    for (const file of moduleFiles) {
      if (centralizedFiles.includes(file)) {
        conflicts.push({
          file,
          module: sharedDir.module,
          modulePath: path.join(sharedDir.path, file),
          centralizedPath: path.join(centralizedSharedDir, file),
        });
      }
    }
  }

  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
  };
}

/**
 * Show conflict details
 */
function showConflicts(conflicts) {
  log.header('File Conflicts Detected');

  for (const conflict of conflicts) {
    log.warning(`File: ${conflict.file}`);
    log.info(`  Module: ${conflict.module}`);
    log.info(`  Module path: ${path.relative(rootDir, conflict.modulePath)}`);
    log.info(`  Centralized path: ${path.relative(rootDir, conflict.centralizedPath)}`);

    // Compare file sizes
    try {
      const moduleSize = fs.statSync(conflict.modulePath).size;
      const centralizedSize = fs.statSync(conflict.centralizedPath).size;

      if (moduleSize !== centralizedSize) {
        log.warning(`  Size difference: module(${moduleSize}) vs centralized(${centralizedSize})`);
      } else {
        log.info(`  Same size: ${moduleSize} bytes`);
      }
    } catch (error) {
      log.error(`  Error comparing sizes: ${error.message}`);
    }

    console.log(''); // Empty line between conflicts
  }
}

/**
 * Main cleanup function
 */
function cleanupDuplicateShared() {
  log.header('Cleaning Up Duplicate _shared Directories');

  // Step 1: Ensure centralized _shared exists
  log.step('Checking centralized _shared directory...');
  if (!ensureCentralizedShared()) {
    log.error('Cannot proceed without centralized _shared directory');
    return false;
  }

  // Step 2: Find all module _shared directories
  log.step('Finding module _shared directories...');
  const sharedDirs = findModuleSharedDirectories();

  if (sharedDirs.length === 0) {
    log.success('No duplicate _shared directories found!');
    return true;
  }

  log.info(`Found ${sharedDirs.length} module _shared directories:`);
  for (const dir of sharedDirs) {
    log.info(`  - ${dir.relativePath}`);
  }

  // Step 3: Check for conflicts
  log.step('Checking for file conflicts...');
  const conflictCheck = checkForConflicts(sharedDirs);

  if (conflictCheck.hasConflicts) {
    showConflicts(conflictCheck.conflicts);

    log.warning('Manual review required before cleanup!');
    log.info('Please resolve conflicts by:');
    log.info('1. Reviewing differences between files');
    log.info('2. Updating centralized _shared if needed');
    log.info('3. Re-running this script');

    return false;
  }

  log.success('No conflicts found - safe to proceed');

  // Step 4: Backup and remove module _shared directories
  log.step('Backing up and removing module _shared directories...');

  let successCount = 0;

  for (const sharedDir of sharedDirs) {
    log.info(`Processing: ${sharedDir.relativePath}`);

    // Backup first
    if (backupSharedDirectory(sharedDir)) {
      // Then remove
      if (removeSharedDirectory(sharedDir)) {
        successCount++;
      }
    }
  }

  // Step 5: Summary
  log.header('Cleanup Summary');
  log.success(`✅ Processed ${sharedDirs.length} directories`);
  log.success(`✅ Successfully cleaned ${successCount} directories`);

  if (successCount > 0) {
    log.info('📁 Backups saved to .backup_shared/');
    log.info('🚀 Run "pnpm build:backend" to sync centralized _shared');
  }

  if (successCount < sharedDirs.length) {
    log.warning(`⚠️  ${sharedDirs.length - successCount} directories had issues`);
  }

  return successCount === sharedDirs.length;
}

/**
 * Validate environment
 */
function validateEnvironment() {
  const packageJsonPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    log.error("package.json not found. Make sure you're running this from the project root.");
    process.exit(1);
  }

  log.success('Environment validation passed');
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(''); // Start with empty line
  validateEnvironment();

  const success = cleanupDuplicateShared();

  console.log(''); // End with empty line

  if (success) {
    log.success('🎉 Cleanup completed successfully!');
    process.exit(0);
  } else {
    log.error('💥 Cleanup completed with issues');
    process.exit(1);
  }
}
