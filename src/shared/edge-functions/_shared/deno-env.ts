/**
 * Deno environment wrapper for TypeScript compatibility
 */

// This is a wrapper around Deno.env to make it work with TypeScript
// It's used to avoid TypeScript errors when using Deno.env
export const denoEnv = {
  get: (key: string): string | undefined => {
    // @ts-ignore - Deno is available at runtime
    return Deno.env.get(key);
  },
  set: (key: string, value: string): void => {
    // @ts-ignore - Deno is available at runtime
    Deno.env.set(key, value);
  },
  has: (key: string): boolean => {
    // @ts-ignore - Deno is available at runtime
    return Deno.env.has(key);
  },
  delete: (key: string): void => {
    // @ts-ignore - Deno is available at runtime
    Deno.env.delete(key);
  },
};
