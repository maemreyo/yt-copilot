#!/usr/bin/env node

/**
 * Test Module Script
 *
 * Runs unit tests for a specific module with helpful options
 *
 * Usage:
 *   node scripts/test-module.mjs billing
 *   node scripts/test-module.mjs core --watch
 *   node scripts/test-module.mjs shared --coverage
 *   node scripts/test-module.mjs billing --file create-checkout-session
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Color codes for terminal output
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

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

function log(message, color = 'cyan') {
  console.log(colorize(message, color));
}

function error(message) {
  console.error(colorize(`❌ ${message}`, 'red'));
}

function success(message) {
  console.log(colorize(`✅ ${message}`, 'green'));
}

function warning(message) {
  console.log(colorize(`⚠️  ${message}`, 'yellow'));
}

function showUsage() {
  log('\n📋 Usage:', 'bright');
  console.log('  pnpm test:module <module-name> [options]');
  console.log('  node scripts/test-module.mjs <module-name> [options]');

  log('\n📦 Available Modules:', 'bright');
  console.log('  auth       - Authentication and authorization');
  console.log('  billing    - Billing and payment functionality');
  console.log('  core       - Core application functionality');
  console.log('  shared     - Shared utilities and components');

  log('\n⚙️  Options:', 'bright');
  console.log('  --watch    - Watch for file changes and re-run tests');
  console.log('  --coverage - Generate coverage report');
  console.log('  --file     - Run tests for specific test file (without .test.ts)');
  console.log('  --help     - Show this help message');

  log('\n💡 Examples:', 'bright');
  console.log('  pnpm test:module billing');
  console.log('  pnpm test:module billing --watch');
  console.log('  pnpm test:module billing --coverage');
  console.log('  pnpm test:module billing --file create-checkout-session');
  console.log('  pnpm test:module core --watch --coverage');
}

function getModulePath(moduleName) {
  const paths = {
    auth: 'src/modules/auth/tests/',
    billing: 'src/modules/billing/tests/',
    core: 'src/modules/core/',
    shared: 'src/shared/',
  };

  return paths[moduleName] || null;
}

function getAvailableModules() {
  const modules = [];
  const moduleDirectories = [
    { name: 'auth', path: 'src/modules/auth/tests' },
    { name: 'billing', path: 'src/modules/billing/tests' },
    { name: 'core', path: 'src/modules/core' },
    { name: 'shared', path: 'src/shared' },
  ];

  for (const { name, path } of moduleDirectories) {
    const fullPath = join(projectRoot, path);
    if (existsSync(fullPath)) {
      modules.push(name);
    }
  }

  return modules;
}

function buildTestCommand(moduleName, options) {
  const { watch, coverage, file } = options;

  let command = 'pnpm vitest';

  // Add run flag if not in watch mode
  if (!watch) {
    command += ' run';
  }

  // Add coverage flag
  if (coverage) {
    command += ' --coverage';
  }

  // Add config
  command += ' --config vitest.unit.config.ts';

  // Add specific file or module path
  if (file) {
    const modulePath = getModulePath(moduleName);
    if (!modulePath) {
      throw new Error(`Unknown module: ${moduleName}`);
    }
    command += ` ${modulePath}${file}.test.ts`;
  } else {
    const modulePath = getModulePath(moduleName);
    if (!modulePath) {
      throw new Error(`Unknown module: ${moduleName}`);
    }
    command += ` ${modulePath}`;
  }

  return command;
}

function main() {
  const args = process.argv.slice(2);

  // Show help if requested or no arguments
  if (args.includes('--help') || args.length === 0) {
    showUsage();
    return;
  }

  const moduleName = args[0];
  const options = {
    watch: args.includes('--watch'),
    coverage: args.includes('--coverage'),
    file: null,
  };

  // Extract file option
  const fileIndex = args.indexOf('--file');
  if (fileIndex !== -1 && args[fileIndex + 1]) {
    options.file = args[fileIndex + 1];
  }

  // Validate module name
  const availableModules = getAvailableModules();
  if (!availableModules.includes(moduleName)) {
    error(`Unknown module: ${moduleName}`);
    log(`Available modules: ${availableModules.join(', ')}`, 'yellow');
    return process.exit(1);
  }

  // Check if module path exists
  const modulePath = getModulePath(moduleName);
  const fullPath = join(projectRoot, modulePath);
  if (!existsSync(fullPath)) {
    error(`Module path does not exist: ${fullPath}`);
    return process.exit(1);
  }

  try {
    // Build and execute test command
    const command = buildTestCommand(moduleName, options);

    log(`\n🧪 Running tests for module: ${moduleName}`, 'bright');
    if (options.file) {
      log(`📄 File: ${options.file}.test.ts`);
    }
    if (options.watch) {
      log('👀 Watch mode enabled');
    }
    if (options.coverage) {
      log('📊 Coverage report enabled');
    }

    log(`\n⚡ Command: ${command}`, 'blue');
    log('\n' + '='.repeat(60), 'cyan');

    // Execute the command
    execSync(command, {
      stdio: 'inherit',
      cwd: projectRoot,
    });

    success(`\n✨ Tests completed for module: ${moduleName}`);
  } catch (err) {
    error(`\n❌ Test execution failed: ${err.message}`);
    process.exit(1);
  }
}

// Run the script
main();
