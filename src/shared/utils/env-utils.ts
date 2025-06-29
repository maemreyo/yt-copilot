/**
 * Cross-platform environment utilities
 * Works in both Node.js and Deno environments
 */

/**
 * Get an environment variable in a cross-platform way
 * @param key The environment variable key
 * @param defaultValue Optional default value if the environment variable is not set
 * @returns The environment variable value or the default value
 */
export function getEnv(key: string, defaultValue: string = ''): string {
  // Check for Deno environment
  if (
    typeof globalThis !== 'undefined' &&
    'Deno' in globalThis &&
    typeof (globalThis as any).Deno?.env?.get === 'function'
  ) {
    return (globalThis as any).Deno.env.get(key) || defaultValue;
  }

  // Check for Node.js environment
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key] || defaultValue;
  }

  // Fallback for browser or other environments
  return defaultValue;
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return getEnv('NODE_ENV', 'development') === 'development';
}

/**
 * Check if running in production mode
 */
export function isProduction(): boolean {
  return getEnv('NODE_ENV') === 'production';
}

/**
 * Check if running in test mode
 */
export function isTest(): boolean {
  return getEnv('NODE_ENV') === 'test';
}

/**
 * Default export
 */
export default {
  getEnv,
  isDevelopment,
  isProduction,
  isTest,
};
