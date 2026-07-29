import {
  getSecretOptionsScope,
  isSecretOptionsEndpoint,
  isSecretOptionsReadScopeAppend,
  notifySecretOptionsAuthRequired,
  withSecretOptionsAuthorization,
} from "./secretOptionsAuth";

const DEFAULT_HEALTH_TIMEOUT_MS = 5_000;
const MAX_PUBLIC_DETAIL_LENGTH = 280;

export interface ApiFetchOptions extends RequestInit {
  /**
   * Optional request deadline. Long-running mutations remain unbounded unless
   * their caller opts in; read hooks apply a default timeout separately.
   */
  timeoutMs?: number;
}

export class ApiError extends Error {
  status: number;
  endpoint: string;
  body: unknown;
  code?: string;

  constructor(
    endpoint: string,
    status: number,
    message: string,
    body?: unknown,
    code?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.endpoint = endpoint;
    this.status = status;
    this.body = body;
    this.code = code;
  }
}

export function getApiUrl(): string {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  return "/api";
}

export function buildApiUrl(endpoint: string): string {
  const baseUrl = getApiUrl();
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${baseUrl}${cleanEndpoint}`;
}

export function getLegacyApiUrl(): string {
  return getApiUrl();
}

function getBodyDetail(body: unknown): string | null {
  const candidate = typeof body === "string"
    ? body
    : typeof body === "object" && body !== null && "detail" in body
      ? (body as { detail: unknown }).detail
      : null;
  if (typeof candidate !== "string") return null;

  const normalized = candidate.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (
    normalized.length === 0
    || normalized.length > MAX_PUBLIC_DETAIL_LENGTH
    || /(?:traceback|stack trace|select\s.+\sfrom|syntaxerror)/i.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function normalizeApiErrorMessage(status: number, body?: unknown): string {
  const safeDetail = getBodyDetail(body);
  switch (status) {
    case 0:
      return "The service could not be reached. Check your connection and try again.";
    case 400:
    case 422:
      return safeDetail ?? "The request could not be completed. Check the inputs and try again.";
    case 401:
      return "Your session is not authorized for this request. Sign in again and retry.";
    case 403:
      return "You do not have permission to complete this request.";
    case 404:
      return "The requested data is not available.";
    case 408:
    case 504:
      return "The request took too long. Try again in a moment.";
    case 409:
      return safeDetail ?? "The request conflicts with the current data. Refresh and try again.";
    case 429:
      return "The service is receiving too many requests. Wait a moment and try again.";
    default:
      if (status >= 500) {
        return "The service is temporarily unavailable. Try again in a moment.";
      }
      return safeDetail ?? "The request could not be completed.";
  }
}

function composeTimeoutSignal(
  upstream: AbortSignal | null | undefined,
  timeoutMs: number | undefined,
) {
  if (timeoutMs === undefined || timeoutMs <= 0) {
    return {
      signal: upstream,
      didTimeOut: () => false,
      cleanup: () => undefined,
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  const abortFromUpstream = () => {
    controller.abort(upstream?.reason ?? new DOMException("Aborted", "AbortError"));
  };

  if (upstream?.aborted) abortFromUpstream();
  else upstream?.addEventListener("abort", abortFromUpstream, { once: true });

  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    cleanup: () => {
      window.clearTimeout(timeoutId);
      upstream?.removeEventListener("abort", abortFromUpstream);
    },
  };
}

export async function apiFetch<T>(
  endpoint: string,
  options?: ApiFetchOptions,
): Promise<T> {
  const url = buildApiUrl(endpoint);
  const { timeoutMs, ...fetchOptions } = options ?? {};
  const authorizedOptions = withSecretOptionsAuthorization(
    endpoint,
    options ? fetchOptions : undefined,
  );
  const method = String(authorizedOptions?.method || "GET").toUpperCase();

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

  const timeout = composeTimeoutSignal(authorizedOptions?.signal, timeoutMs);
  const requestOptions = authorizedOptions || timeout.signal
    ? { ...authorizedOptions, signal: timeout.signal }
    : undefined;

  try {
    const response = await fetch(url, requestOptions);
    if (
      isSecretOptionsEndpoint(endpoint)
      && (response.status === 401 || response.status === 403)
    ) {
      notifySecretOptionsAuthRequired(response.status);
    }

    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => null);

    if (!response.ok) {
      throw new ApiError(
        endpoint,
        response.status,
        normalizeApiErrorMessage(response.status, body),
        body,
      );
    }

    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timeout.didTimeOut()) {
      throw new ApiError(
        endpoint,
        408,
        normalizeApiErrorMessage(408),
        undefined,
        "timeout",
      );
    }
    if (
      error instanceof DOMException && error.name === "AbortError"
      || typeof error === "object"
        && error !== null
        && "name" in error
        && error.name === "AbortError"
    ) {
      throw error;
    }
    throw new ApiError(endpoint, 0, normalizeApiErrorMessage(0), undefined, "network");
  } finally {
    timeout.cleanup();
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) {
    return getBodyDetail(error.message) ?? "Unexpected error. Try again.";
  }
  return "Unexpected error. Try again.";
}

export async function checkApiHealth(): Promise<boolean> {
  try {
    await apiFetch<{ status: string }>("/health/", {
      timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}
