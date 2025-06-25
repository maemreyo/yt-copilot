#!/usr/bin/env node

/**
 * Script to fix import paths in Supabase Edge Functions
 * Converts '../_shared/cors.ts' to '_shared/cors.ts' and other Deno-specific fixes
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
  header: msg => console.log(`${colors.bright}${colors.magenta}🛠️  ${msg}${colors.reset}`),
};

/**
 * Import path replacements for Deno environment
 */
const IMPORT_REPLACEMENTS = [
  // Fix _shared imports
  {
    pattern: /from\s+['"]\.\.\/\_shared\/(.+)['"];?/g,
    replacement: "from '_shared/$1';",
    description: 'Relative _shared imports → absolute _shared imports',
  },

  // Fix Deno standard library imports
  {
    pattern: /from\s+['"]https:\/\/deno\.land\/std@[\d\.]+\/(.+)['"];?/g,
    replacement: "from 'std/$1';",
    description: 'Deno std URLs → import map references',
  },

  // Fix Supabase client imports
  {
    pattern: /from\s+['"]https:\/\/esm\.sh\/@supabase\/supabase-js@[\d\.]+['"];?/g,
    replacement: "from '@supabase/supabase-js';",
    description: 'Supabase ESM URLs → import map references',
  },

  // Fix Stripe imports
  {
    pattern: /from\s+['"]https:\/\/esm\.sh\/stripe@[\d\.]+\?target=deno['"];?/g,
    replacement: "from 'stripe';",
    description: 'Stripe ESM URLs → import map references',
  },

  // Fix other common ESM imports
  {
    pattern: /from\s+['"]https:\/\/esm\.sh\/(.+?)@[\d\.]+(?:\?[^'"]*)?['"];?/g,
    replacement: "from '$1';",
    description: 'ESM URLs → package names',
  },
];

/**
 * Find all TypeScript files in a directory recursively
 */
function findTsFiles(dir) {
  const files = [];

  function traverse(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        traverse(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        files.push(fullPath);
      }
    }
  }

  if (fs.existsSync(dir)) {
    traverse(dir);
  }

  return files;
}

/**
 * Fix imports in a single file
 */
function fixFileImports(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let hasChanges = false;
  const changes = [];

  for (const replacement of IMPORT_REPLACEMENTS) {
    const matches = content.matchAll(replacement.pattern);
    let matchCount = 0;

    for (const match of matches) {
      matchCount++;
    }

    if (matchCount > 0) {
      content = content.replace(replacement.pattern, replacement.replacement);
      hasChanges = true;
      changes.push(`${replacement.description} (${matchCount} matches)`);
    }
  }

  if (hasChanges) {
    fs.writeFileSync(filePath, content, 'utf8');
    const relativePath = path.relative(rootDir, filePath);
    log.success(`Fixed: ${relativePath}`);

    for (const change of changes) {
      log.info(`  └─ ${change}`);
    }
  }

  return hasChanges;
}

/**
 * Main function to fix all imports
 */
function fixAllImports() {
  log.header('Fixing Import Paths for Deno Environment');

  // Directories to process
  const directories = [
    path.join(rootDir, 'src', 'modules'),
    path.join(rootDir, 'supabase', '_internal', 'functions'),
    path.join(rootDir, 'supabase', 'functions'),
  ];

  let totalFiles = 0;
  let fixedFiles = 0;

  for (const dir of directories) {
    if (!fs.existsSync(dir)) {
      log.warning(`Directory not found: ${path.relative(rootDir, dir)}`);
      continue;
    }

    log.step(`Processing directory: ${path.relative(rootDir, dir)}`);

    const files = findTsFiles(dir);
    totalFiles += files.length;

    for (const file of files) {
      if (fixFileImports(file)) {
        fixedFiles++;
      }
    }
  }

  // Summary
  log.header('Import Fix Summary');
  log.success(`✅ Processed ${totalFiles} TypeScript files`);
  log.success(`✅ Fixed imports in ${fixedFiles} files`);

  if (fixedFiles === 0) {
    log.info('🎉 All import paths are already correct!');
  } else {
    log.info('🚀 Import paths have been updated for Deno compatibility');
    log.info('💡 Remember to run "pnpm build:backend" to sync changes');
  }
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
  fixAllImports();
  console.log(''); // End with empty line
}
