/** Create a per-impression identifier without coupling scanner UI to browser APIs. */
export const createScannerTelemetryId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `scanner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
};
