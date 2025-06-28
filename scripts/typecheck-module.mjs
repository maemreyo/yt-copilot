#!/usr/bin/env node

/**
 * Dynamic module type checking script
 *
 * Usage:
 *   node scripts/typecheck-module.mjs [module-name]
 *
 * Examples:
 *   node scripts/typecheck-module.mjs           # Checks all modules
 *   node scripts/typecheck-module.mjs auth      # Checks only the auth module
 *   node scripts/typecheck-module.mjs billing   # Checks only the billing module
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
const getModulesToCheck = () => {
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

// Get the modules to check
const modulesToCheck = getModulesToCheck();

// Common Deno check command parts
const denoPath = process.env.HOME + '/.deno/bin/deno';
const configPath = './tsconfig.modules.json';
const importMapPath = './import_map.json';
const denoFlags = '--no-lock';

// Function to check a specific module
const checkModule = module => {
  const modulePath = path.join('src/modules', module);

  console.log(`\n🔍 Type checking module: ${module}`);

  try {
    // Find all TypeScript files in the module, excluding test files
    const findCommand = `find ${modulePath} -name "*.ts" | grep -v "test.ts"`;
    const files = execSync(findCommand, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);

    if (files.length === 0) {
      console.log(`⚠️  No TypeScript files found in module: ${module}`);
      return;
    }

    // Run Deno check on the files
    const denoCommand = `${denoPath} check ${denoFlags} --config=${configPath} --import-map=${importMapPath} ${files.join(' ')}`;

    try {
      execSync(denoCommand, { stdio: 'inherit' });
      console.log(`✅ Module ${module} type check passed`);
    } catch (error) {
      console.error(`❌ Module ${module} type check failed`);
      // We don't exit here to allow checking other modules
    }
  } catch (error) {
    console.error(`Error checking module ${module}:`, error.message);
  }
};

// Check all selected modules
console.log(`🚀 Starting type check for ${moduleName ? `module: ${moduleName}` : 'all modules'}`);

let hasErrors = false;

for (const module of modulesToCheck) {
  try {
    checkModule(module);
  } catch (error) {
    hasErrors = true;
    console.error(`Failed to check module ${module}:`, error.message);
  }
}

console.log('\n📋 Type checking summary:');
console.log(`Total modules checked: ${modulesToCheck.length}`);

// Exit with appropriate code
process.exit(hasErrors ? 1 : 0);
