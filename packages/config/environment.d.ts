export interface EnvironmentConfig {
  isDevelopment: boolean;
  isProduction: boolean;
  isTest: boolean;
  
  supabase: {
    url?: string;
    anonKey?: string;
  };
  
  app: {
    url: string;
  };
}

export const environment: EnvironmentConfig;