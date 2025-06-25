// API constants

export const API_VERSION = 'v1';
export const API_BASE_PATH = `/api/${API_VERSION}`;

export const ENDPOINTS = {
  // Auth endpoints
  AUTH: {
    CREATE_API_KEY: `${API_BASE_PATH}/api-keys/create`,
    REVOKE_API_KEY: `${API_BASE_PATH}/api-keys/revoke`,
    LIST_API_KEYS: `${API_BASE_PATH}/api-keys`,
  },
  
  // Billing endpoints
  BILLING: {
    CREATE_CHECKOUT_SESSION: `${API_BASE_PATH}/billing/create-checkout-session`,
    CREATE_CUSTOMER_PORTAL: `${API_BASE_PATH}/billing/create-customer-portal`,
    GET_SUBSCRIPTION: `${API_BASE_PATH}/billing/subscription`,
  },
  
  // Core endpoints
  CORE: {
    HEALTH: `${API_BASE_PATH}/health`,
    VERSION: `${API_BASE_PATH}/version`,
  },
  
  // Webhook endpoints
  WEBHOOKS: {
    STRIPE: `/api/webhooks/stripe`,
  },
};

export const RATE_LIMITS = {
  DEFAULT: 60, // requests per minute
  AUTH: 10, // requests per minute
  API_KEYS: 5, // requests per minute
  BILLING: 20, // requests per minute
};