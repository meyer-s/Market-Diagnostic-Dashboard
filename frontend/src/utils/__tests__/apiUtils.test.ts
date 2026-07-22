import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch, checkApiHealth } from "../apiUtils";
import {
  clearSecretOptionsToken,
  SECRET_OPTIONS_AUTH_REQUIRED_EVENT,
  setSecretOptionsScope,
  setSecretOptionsToken,
} from "../secretOptionsAuth";

describe("apiUtils", () => {
  afterEach(() => {
    clearSecretOptionsToken();
    vi.restoreAllMocks();
  });

  it("checks the real health endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: () => "application/json",
      },
      json: async () => ({ status: "ok" }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkApiHealth()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/health/"), undefined);
  });

  it("adds the memory-only bearer token only to Secret Options requests", async () => {
    setSecretOptionsToken("session-secret");
    setSecretOptionsScope("write");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ scope: "write" }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/secret/options/access");

    const [, options] = fetchMock.mock.calls[0];
    const headers = new Headers(options.headers);
    expect(headers.get("Authorization")).toBe("Bearer session-secret");
    expect(window.sessionStorage.length).toBe(0);

    await apiFetch("/health/");
    expect(fetchMock.mock.calls[1][1]).toBeUndefined();
  });

  it("blocks Secret Options mutations locally for a validated read scope", async () => {
    setSecretOptionsToken("read-session");
    setSecretOptionsScope("read");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiFetch("/secret/options/risk-policy", { method: "POST" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets only an explicit access validation establish scope and never closes an upgrade prompt on background success", async () => {
    setSecretOptionsToken("read-session");
    setSecretOptionsScope("read");
    const authEvents: number[] = [];
    const listener = (event: Event) => {
      authEvents.push(Number((event as CustomEvent<{ status: number }>).detail.status));
    };
    window.addEventListener(SECRET_OPTIONS_AUTH_REQUIRED_EVENT, listener);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ positions: [] }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/secret/options/positions");

    expect(authEvents).toEqual([]);
    window.removeEventListener(SECRET_OPTIONS_AUTH_REQUIRED_EVENT, listener);
  });

  it("announces rejected Secret Options credentials", async () => {
    setSecretOptionsToken("stale-session");
    const authEvents: number[] = [];
    const listener = (event: Event) => {
      authEvents.push(Number((event as CustomEvent<{ status: number }>).detail.status));
    };
    window.addEventListener(SECRET_OPTIONS_AUTH_REQUIRED_EVENT, listener);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => "application/json" },
      json: async () => ({ detail: "Unauthorized" }),
      text: async () => "",
    }));

    await expect(apiFetch("/secret/options/access")).rejects.toMatchObject({ status: 401 });

    expect(authEvents).toEqual([401]);
    window.removeEventListener(SECRET_OPTIONS_AUTH_REQUIRED_EVENT, listener);
  });

  it("aborts in-flight Secret Options reads when the in-memory credential changes", async () => {
    setSecretOptionsToken("first-session");
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
      requestSignal = options?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const pending = apiFetch("/secret/options/positions").catch((error) => error);
    await Promise.resolve();

    setSecretOptionsToken("second-session");

    expect(requestSignal?.aborted).toBe(true);
    await expect(pending).resolves.toMatchObject({ name: "AbortError" });
  });
});
