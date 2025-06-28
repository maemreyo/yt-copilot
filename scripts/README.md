# Project Scripts

This directory contains utility scripts for the project.

## Module Type Checking

### `typecheck-module.mjs`

This script provides a flexible way to type check Deno modules in the project.

#### Usage

```bash
# Check all modules
pnpm typecheck:modules

# Check a specific module
pnpm typecheck:module auth
pnpm typecheck:module billing
pnpm typecheck:module core
# etc.
```

The script will:
1. Find all TypeScript files in the specified module(s), excluding test files
2. Run Deno type checking on those files
3. Report any errors found
4. Provide a summary of the type checking results

#### Adding New Modules

When adding a new module to the project, you don't need to create a new npm script. Simply place your module in the `src/modules` directory, and it will automatically be included in the type checking process.

## Deno Cache Cleaning

### `clean-deno-cache.mjs`

This script cleans the Deno cache for modules in the project.

#### Usage

```bash
# Clean cache for all modules
pnpm clean:deno

# Clean cache for a specific module
pnpm clean:deno:module auth
pnpm clean:deno:module billing
pnpm clean:deno:module core
# etc.
```

The script will:
1. Find all TypeScript files in the specified module(s), excluding test files
2. Reload the Deno cache for those files
3. Report the results of the cache cleaning operation

## Benefits of This Approach

- **Scalability**: No need to add new npm scripts when adding new modules
- **Consistency**: All modules are checked using the same configuration
- **Flexibility**: Can check all modules or just a specific one
- **Maintainability**: Centralized logic for type checking and cache cleaning
- **Clarity**: Clear output with emojis and summaries