/**
 * Network Utilities for Form Factor EAS
 * Provides network connectivity checks and debugging tools
 */

import { Platform } from 'react-native';
import { errorWithTs, logWithTs } from '@/lib/logger';

export interface NetworkStatus {
  isConnected: boolean;
  error?: string;
  supabaseReachable?: boolean;
  timestamp: number;
}

/**
 * Test network connectivity to Supabase
 */
export const testSupabaseConnection = async (): Promise<NetworkStatus> => {
  const timestamp = Date.now();
  
  try {
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    
    if (!supabaseUrl) {
      return {
        isConnected: false,
        error: 'Supabase URL not configured',
        timestamp,
      };
    }

    // Test basic connectivity to Supabase health endpoint
    const healthUrl = `${supabaseUrl}/health`;
    
    logWithTs('[Network] Testing connection to:', healthUrl);
    
    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': `FormFactorEAS/${Platform.OS}`,
      },
      // Set a reasonable timeout
      signal: AbortSignal.timeout(10000), // 10 seconds
    });

    const isHealthy = response.ok;
    
    logWithTs('[Network] Supabase health check:', {
      status: response.status,
      ok: response.ok,
      healthy: isHealthy,
    });

    return {
      isConnected: isHealthy,
      supabaseReachable: isHealthy,
      timestamp,
    };
  } catch (error) {
    errorWithTs('[Network] Connection test failed:', error);
    
    let errorMessage = 'Unknown network error';
    
    if (error instanceof TypeError && error.message === 'Network request failed') {
      errorMessage = 'Network request failed - check internet connection';
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }
    
    return {
      isConnected: false,
      error: errorMessage,
      timestamp,
    };
  }
};

/**
 * Check if environment variables are properly configured
 */
export const checkEnvironmentConfig = (): {
  isValid: boolean;
  issues: string[];
  config: {
    hasSupabaseUrl: boolean;
    hasSupabaseKey: boolean;
    supabaseUrl?: string;
  };
} => {
  const issues: string[] = [];
  
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!supabaseUrl) {
    issues.push('EXPO_PUBLIC_SUPABASE_URL is missing');
  }
  
  if (!supabaseKey) {
    issues.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is missing');
  }
  
  // Validate URL format if present
  if (supabaseUrl) {
    try {
      new URL(supabaseUrl);
    } catch {
      issues.push('EXPO_PUBLIC_SUPABASE_URL is not a valid URL');
    }
  }
  
  return {
    isValid: issues.length === 0,
    issues,
    config: {
      hasSupabaseUrl: !!supabaseUrl,
      hasSupabaseKey: !!supabaseKey,
      supabaseUrl,
    },
  };
};

/**
 * Comprehensive network and configuration diagnostic
 */
export const runDiagnostics = async (): Promise<{
  environment: ReturnType<typeof checkEnvironmentConfig>;
  network: NetworkStatus;
  recommendations: string[];
}> => {
  logWithTs('[Diagnostics] Running comprehensive diagnostics...');
  
  const environment = checkEnvironmentConfig();
  const network = await testSupabaseConnection();
  
  const recommendations: string[] = [];
  
  // Environment recommendations
  if (!environment.isValid) {
    recommendations.push('Fix environment variables in .env file');
    if (environment.issues.includes('EXPO_PUBLIC_SUPABASE_URL is missing')) {
      recommendations.push('Add EXPO_PUBLIC_SUPABASE_URL=https://nxywytufzdgzcizmpvbd.supabase.co to .env');
    }
    if (environment.issues.includes('EXPO_PUBLIC_SUPABASE_ANON_KEY is missing')) {
      recommendations.push('Add EXPO_PUBLIC_SUPABASE_ANON_KEY to .env');
    }
  }
  
  // Network recommendations
  if (!network.isConnected) {
    recommendations.push('Check your internet connection');
    recommendations.push('Verify Supabase project is active');
    if (network.error?.includes('Network request failed')) {
      recommendations.push('Try restarting your development server with --clear flag');
    }
  }
  
  logWithTs('[Diagnostics] Results:', {
    environment: environment.isValid ? '✅ Valid' : '❌ Invalid',
    network: network.isConnected ? '✅ Connected' : '❌ Failed',
    recommendations: recommendations.length,
  });
  
  return {
    environment,
    network,
    recommendations,
  };
};
