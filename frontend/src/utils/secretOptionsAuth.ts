export const SECRET_OPTIONS_AUTH_REQUIRED_EVENT = "secret-options-auth-required";

let memoryToken = "";
let memoryScope: SecretOptionsScope = null;
let sessionController: AbortController | null = typeof AbortController === "undefined"
  ? null
  : new AbortController();

export type SecretOptionsScope = "read" | "write" | "development" | null;

export function isSecretOptionsEndpoint(endpoint: string): boolean {
  const path = endpoint.startsWith("http")
    ? (() => {
        try {
          return new URL(endpoint).pathname;
        } catch {
          return endpoint;
        }
      })()
    : endpoint;
  return path === "/secret/options" || path.startsWith("/secret/options/");
}

export function getSecretOptionsToken(): string {
  return memoryToken;
}

export function setSecretOptionsToken(value: string): void {
  const nextToken = value.trim();
  if (nextToken !== getSecretOptionsToken()) {
    sessionController?.abort();
    sessionController = typeof AbortController === "undefined" ? null : new AbortController();
  }
  memoryToken = nextToken;
}

export function clearSecretOptionsToken(): void {
  setSecretOptionsToken("");
  setSecretOptionsScope(null);
}

export function getSecretOptionsScope(): SecretOptionsScope {
  return memoryScope;
}

export function setSecretOptionsScope(value: SecretOptionsScope): void {
  memoryScope = value;
}

export function withSecretOptionsAuthorization(
  endpoint: string,
  options?: RequestInit,
): RequestInit | undefined {
  if (!isSecretOptionsEndpoint(endpoint)) return options;
  const token = getSecretOptionsToken();
  const headers = new Headers(options?.headers);
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (!headers.has("X-Request-ID")) {
    const requestId = globalThis.crypto?.randomUUID?.();
    if (requestId) headers.set("X-Request-ID", requestId);
  }
  return {
    ...options,
    headers,
    signal: options?.signal ?? sessionController?.signal,
  };
}

export function notifySecretOptionsAuthRequired(status: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(SECRET_OPTIONS_AUTH_REQUIRED_EVENT, { detail: { status } }),
  );
}
