// API configuration
module.exports = {
  version: 'v1',
  basePath: '/api/v1',
  
  endpoints: {
    // Auth endpoints
    auth: {
      createApiKey: '/api/v1/api-keys/create',
      revokeApiKey: '/api/v1/api-keys/revoke',
      listApiKeys: '/api/v1/api-keys',
    },
    
    // Billing endpoints
    billing: {
      createCheckoutSession: '/api/v1/billing/create-checkout-session',
      createCustomerPortal: '/api/v1/billing/create-customer-portal',
      getSubscription: '/api/v1/billing/subscription',
    },
    
    // Core endpoints
    core: {
      health: '/api/v1/health',
      version: '/api/v1/version',
    },
    
    // Webhook endpoints
    webhooks: {
      stripe: '/api/webhooks/stripe',
    },
  },
  
  rateLimits: {
    default: 60, // requests per minute
    auth: 10, // requests per minute
    apiKeys: 5, // requests per minute
    billing: 20, // requests per minute
  },
};