export interface ApiConfig {
  version: string;
  basePath: string;
  
  endpoints: {
    auth: {
      createApiKey: string;
      revokeApiKey: string;
      listApiKeys: string;
    };
    
    billing: {
      createCheckoutSession: string;
      createCustomerPortal: string;
      getSubscription: string;
    };
    
    core: {
      health: string;
      version: string;
    };
    
    webhooks: {
      stripe: string;
    };
  };
  
  rateLimits: {
    default: number;
    auth: number;
    apiKeys: number;
    billing: number;
  };
}

export const api: ApiConfig;