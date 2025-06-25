#!/usr/bin/env node

/**
 * Script to clean TypeScript build artifacts
 * Removes dist/, *.tsbuildinfo, and generated .d.ts files
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
 * Remove directory if it exists
 */
function removeDirectory(dirPath) {
  if (fs.existsSync(dirPath)) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      const relativePath = path.relative(rootDir, dirPath);
      log.success(`Removed: ${relativePath}`);
      return true;
    } catch (error) {
      const relativePath = path.relative(rootDir, dirPath);
      log.error(`Failed to remove ${relativePath}: ${error.message}`);
      return false;
    }
  }
  return false;
}

/**
 * Remove file if it exists
 */
function removeFile(filePath) {
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      const relativePath = path.relative(rootDir, filePath);
      log.success(`Removed: ${relativePath}`);
      return true;
    } catch (error) {
      const relativePath = path.relative(rootDir, filePath);
      log.error(`Failed to remove ${relativePath}: ${error.message}`);
      return false;
    }
  }
  return false;
}

/**
 * Find all files matching a pattern recursively
 */
function findFiles(dir, pattern) {
  const files = [];

  function traverse(currentDir) {
    if (!fs.existsSync(currentDir)) return;

    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          traverse(fullPath);
        } else if (entry.isFile() && pattern.test(entry.name)) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  traverse(dir);
  return files;
}

/**
 * Clean TypeScript build artifacts
 */
function cleanTypeScriptArtifacts() {
  log.header('Cleaning TypeScript Build Artifacts');

  let cleanedCount = 0;

  // Directories to clean
  const dirsToClean = [
    // Package dist directories
    path.join(rootDir, 'packages', 'config', 'dist'),
    path.join(rootDir, 'packages', 'db-types', 'dist'),
    path.join(rootDir, 'packages', 'ui', 'dist'),

    // App dist directories
    path.join(rootDir, 'apps', 'web', 'dist'),

    // Global build directories
    path.join(rootDir, 'dist'),
    path.join(rootDir, 'build'),
  ];

  log.step('Removing dist and build directories...');
  for (const dir of dirsToClean) {
    if (removeDirectory(dir)) {
      cleanedCount++;
    }
  }

  // Remove .tsbuildinfo files
  log.step('Removing .tsbuildinfo files...');
  const tsbuildInfoFiles = findFiles(rootDir, /\.tsbuildinfo$/);
  for (const file of tsbuildInfoFiles) {
    if (removeFile(file)) {
      cleanedCount++;
    }
  }

  // Remove generated .d.ts files (but keep manual ones)
  log.step('Removing generated .d.ts files...');
  const problematicDtsFiles = [
    // Apps/web generated files
    path.join(rootDir, 'apps', 'web', 'app', 'layout.d.ts'),
    path.join(rootDir, 'apps', 'web', 'app', 'page.d.ts'),
    path.join(rootDir, 'apps', 'web', 'lib', 'supabase.d.ts'),
  ];

  for (const file of problematicDtsFiles) {
    if (removeFile(file)) {
      cleanedCount++;
    }
  }

  // Remove any .d.ts files in dist directories (they shouldn't exist anymore but just in case)
  const distDtsFiles = findFiles(path.join(rootDir, 'packages'), /\.d\.ts$/).filter(
    file => file.includes('/dist/') && !file.includes('/node_modules/')
  );

  for (const file of distDtsFiles) {
    if (removeFile(file)) {
      cleanedCount++;
    }
  }

  // Summary
  log.header('Cleanup Summary');
  log.success(`✅ Cleaned ${cleanedCount} TypeScript artifacts`);

  if (cleanedCount === 0) {
    log.info('🎉 No artifacts to clean - project is already clean!');
  } else {
    log.info('🚀 Ready for fresh TypeScript compilation');
  }

  return cleanedCount;
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

  const cleanedCount = cleanTypeScriptArtifacts();

  console.log(''); // End with empty line

  log.success('🎉 TypeScript cleanup completed!');
  log.info('💡 Run "pnpm typecheck" to verify configuration');
}
