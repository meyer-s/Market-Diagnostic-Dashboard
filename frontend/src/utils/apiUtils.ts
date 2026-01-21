/**
 * API Utilities
 * 
 * Helper functions for API interactions and URL management.
 */

/**
 * Get the base API URL based on environment
 */
export function getApiUrl(): string {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  // Use relative /api path which Vite will proxy to backend
  return '/api';
}

/**
 * Construct a full API URL for an endpoint
 */
export function buildApiUrl(endpoint: string): string {
  const baseUrl = getApiUrl();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${baseUrl}${cleanEndpoint}`;
}

/**
 * Get the legacy direct API URL (for backward compatibility)
 * Now routes through proxy to avoid CORS issues with HTTPS
 */
export function getLegacyApiUrl(): string {
  return '/api';
}

/**
 * Fetch wrapper with error handling
 */
export async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = buildApiUrl(endpoint);
  
  try {
    const response = await fetch(url, options);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`API fetch error for ${endpoint}:`, error);
    throw error;
  }
}

/**
 * Check if the API is reachable
 */
export async function checkApiHealth(): Promise<boolean> {
  try {
    const response = await fetch(buildApiUrl('/'), { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}
