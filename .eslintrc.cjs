module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    'no-unused-vars': 'off', // Disable for now since TS handles this
    'no-console': 'off',
    'no-undef': 'off', // Disable for TS files
  },

  ignorePatterns: [
    'node_modules/',
    'dist/',
    'build/',
    '.next/',
    '.turbo/',
    'coverage/',
    'supabase/_internal/',
    'packages/db-types/index.ts',
    '**/*.d.ts',
  ],
};
