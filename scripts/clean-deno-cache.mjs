#!/usr/bin/env node

/**
 * Clean Deno cache for modules
 *
 * Usage:
 *   node scripts/clean-deno-cache.mjs [module-name]
 *
 * Examples:
 *   node scripts/clean-deno-cache.mjs           # Cleans cache for all modules
 *   node scripts/clean-deno-cache.mjs auth      # Cleans cache only for the auth module
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Get the module name from command line arguments
const moduleName = process.argv[2];

// Base directory for modules
const modulesDir = path.resolve(process.cwd(), 'src/modules');

// Check if the modules directory exists
if (!fs.existsSync(modulesDir)) {
  console.error(`Error: Modules directory not found at ${modulesDir}`);
  process.exit(1);
}

// Get all module directories if no specific module is provided
const getModulesToClean = () => {
  if (moduleName) {
    const modulePath = path.join(modulesDir, moduleName);
    if (!fs.existsSync(modulePath)) {
      console.error(`Error: Module '${moduleName}' not found at ${modulePath}`);
      process.exit(1);
    }
    return [moduleName];
  } else {
    // Get all directories in the modules folder
    return fs
      .readdirSync(modulesDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
  }
};

// Get the modules to clean
const modulesToClean = getModulesToClean();

// Common Deno cache command parts
const denoPath = process.env.HOME + '/.deno/bin/deno';
const importMapPath = './import_map.json';

// Function to clean cache for a specific module
const cleanModuleCache = module => {
  const modulePath = path.join('src/modules', module);

  console.log(`\n🧹 Cleaning Deno cache for module: ${module}`);

  try {
    // Find all TypeScript files in the module, excluding test files
    const findCommand = `find ${modulePath} -name "*.ts" | grep -v "test.ts"`;
    const files = execSync(findCommand, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);

    if (files.length === 0) {
      console.log(`⚠️  No TypeScript files found in module: ${module}`);
      return;
    }

    // Run Deno cache reload on the files
    const denoCommand = `${denoPath} cache --reload --import-map=${importMapPath} ${files.join(' ')}`;

    try {
      execSync(denoCommand, { stdio: 'inherit' });
      console.log(`✅ Module ${module} cache cleaned successfully`);
    } catch (error) {
      console.error(`❌ Failed to clean cache for module ${module}`);
      // We don't exit here to allow cleaning other modules
    }
  } catch (error) {
    console.error(`Error cleaning cache for module ${module}:`, error.message);
  }
};

// Clean cache for all selected modules
console.log(
  `🚀 Starting cache cleaning for ${moduleName ? `module: ${moduleName}` : 'all modules'}`
);

let hasErrors = false;

for (const module of modulesToClean) {
  try {
    cleanModuleCache(module);
  } catch (error) {
    hasErrors = true;
    console.error(`Failed to clean cache for module ${module}:`, error.message);
  }
}

console.log('\n📋 Cache cleaning summary:');
console.log(`Total modules processed: ${modulesToClean.length}`);

// Exit with appropriate code
process.exit(hasErrors ? 1 : 0);
