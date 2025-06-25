import { env } from './environment';

export const observabilityConfig = {
  logging: {
    level: env.LOG_LEVEL,
    structured: true,
    includeTimestamp: true,
  },
  metrics: {
    enabled: env.METRICS_ENABLED,
    prefix: 'saas_starter_',
  },
  rateLimiting: {
    requestsPerMinute: env.RATE_LIMIT_REQUESTS_PER_MINUTE,
    windowMs: 60 * 1000, // 1 minute
  }
};