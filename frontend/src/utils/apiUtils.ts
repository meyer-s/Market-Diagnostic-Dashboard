import {
  getSecretOptionsScope,
  isSecretOptionsEndpoint,
  isSecretOptionsReadScopeAppend,
  notifySecretOptionsAuthRequired,
  withSecretOptionsAuthorization,
} from "./secretOptionsAuth";

/**
 * API Utilities
 * 
 * Helper functions for API interactions and URL management.
 */

export class ApiError extends Error {
  status: number;
  endpoint: string;
  body: unknown;

  constructor(endpoint: string, status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.endpoint = endpoint;
    this.status = status;
    this.body = body;
  }
}

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
  return getApiUrl();
}

/**
 * Fetch wrapper with error handling
 */
export async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = buildApiUrl(endpoint);
  const requestOptions = withSecretOptionsAuthorization(endpoint, options);
  const method = String(requestOptions?.method || "GET").toUpperCase();
  if (
    isSecretOptionsEndpoint(endpoint)
    && getSecretOptionsScope() === "read"
    && !["GET", "HEAD", "OPTIONS"].includes(method)
    && !isSecretOptionsReadScopeAppend(endpoint, method)
  ) {
    notifySecretOptionsAuthRequired(403);
    throw new ApiError(
      endpoint,
      403,
      "This Secret Options session is read-only. Enter a write-scoped credential to make changes.",
    );
  }
  const response = await fetch(url, requestOptions);
  if (isSecretOptionsEndpoint(endpoint)) {
    if (response.status === 401 || response.status === 403) {
      notifySecretOptionsAuthRequired(response.status);
    }
  }
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (!response.ok) {
    const message =
      typeof body === "string"
        ? body
        : typeof body === "object" && body !== null && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : `Request failed with status ${response.status}`;
    throw new ApiError(endpoint, response.status, message, body);
  }

  return body as T;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error.";
}

/**
 * Check if the API is reachable
 */
export async function checkApiHealth(): Promise<boolean> {
  try {
    await apiFetch<{ status: string }>('/health/');
    return true;
  } catch {
    return false;
  }
}
