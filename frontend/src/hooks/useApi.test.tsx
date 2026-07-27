import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useApi } from "./useApi";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  loadingStart: vi.fn(),
  loadingStop: vi.fn(),
}));

vi.mock("../utils/apiUtils", () => ({
  apiFetch: mocks.apiFetch,
}));

vi.mock("../utils/loadingStore", () => ({
  loadingStore: {
    start: mocks.loadingStart,
    stop: mocks.loadingStop,
  },
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("useApi", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.loadingStart.mockReset();
    mocks.loadingStop.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("aborts a superseded endpoint and ignores a stale response even if the fetcher resolves after abort", async () => {
    const first = deferred<{ value: string }>();
    const second = deferred<{ value: string }>();
    const signals = new Map<string, AbortSignal>();
    mocks.apiFetch.mockImplementation((endpoint: string, options?: RequestInit) => {
      signals.set(endpoint, options?.signal as AbortSignal);
      return endpoint === "/first" ? first.promise : second.promise;
    });

    const { result, rerender, unmount } = renderHook(
      ({ endpoint }) => useApi<{ value: string }>(endpoint),
      { initialProps: { endpoint: "/first" } },
    );

    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(true);
    expect(mocks.loadingStart).toHaveBeenCalledTimes(1);

    rerender({ endpoint: "/second" });

    expect(signals.get("/first")?.aborted).toBe(true);
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
    expect(mocks.loadingStart).toHaveBeenCalledTimes(2);
    expect(mocks.loadingStop).toHaveBeenCalledTimes(1);

    await act(async () => {
      second.resolve({ value: "new" });
      await second.promise;
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ value: "new" });
    expect(mocks.loadingStop).toHaveBeenCalledTimes(2);

    await act(async () => {
      first.resolve({ value: "stale" });
      await first.promise;
    });
    expect(result.current.data).toEqual({ value: "new" });
    expect(mocks.loadingStop).toHaveBeenCalledTimes(2);

    unmount();
    expect(signals.get("/second")?.aborted).toBe(true);
    expect(mocks.loadingStop).toHaveBeenCalledTimes(2);
  });

  it("cancels on unmount, balances loading immediately, and suppresses abort errors", async () => {
    let requestSignal: AbortSignal | undefined;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.apiFetch.mockImplementation((_endpoint: string, options?: RequestInit) => {
      requestSignal = options?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    });

    const { unmount } = renderHook(() => useApi("/pending"));
    expect(mocks.loadingStart).toHaveBeenCalledTimes(1);

    await act(async () => {
      unmount();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(requestSignal?.aborted).toBe(true);
    expect(mocks.loadingStop).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("returns a stable refetch callback and starts exactly one new request per refetch", async () => {
    mocks.apiFetch.mockResolvedValue({ value: "ok" });
    const { result, rerender } = renderHook(
      ({ endpoint }) => useApi<{ value: string }>(endpoint),
      { initialProps: { endpoint: "/stable" } },
    );
    const firstRefetch = result.current.refetch;

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);

    rerender({ endpoint: "/stable" });
    expect(result.current.refetch).toBe(firstRefetch);
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);

    act(() => firstRefetch());
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.refetch).toBe(firstRefetch);
    expect(mocks.loadingStart).toHaveBeenCalledTimes(2);
    expect(mocks.loadingStop).toHaveBeenCalledTimes(2);
  });

  it("reports a current non-abort failure and still balances loading", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.apiFetch.mockRejectedValue(new Error("provider unavailable"));

    const { result } = renderHook(() => useApi("/failed"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("provider unavailable");
    expect(result.current.data).toBeNull();
    expect(mocks.loadingStart).toHaveBeenCalledTimes(1);
    expect(mocks.loadingStop).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      "Fetch error for",
      "/failed",
      ":",
      "provider unavailable",
    );
  });

  it("can clear prior data while a replacement request is pending or fails", async () => {
    const first = deferred<{ value: string }>();
    const second = deferred<{ value: string }>();
    mocks.apiFetch.mockImplementation((endpoint: string) => (
      endpoint === "/first" ? first.promise : second.promise
    ));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { result, rerender } = renderHook(
      ({ endpoint }) => useApi<{ value: string }>(
        endpoint,
        { retainPreviousData: false },
      ),
      { initialProps: { endpoint: "/first" } },
    );
    await act(async () => {
      first.resolve({ value: "first" });
      await first.promise;
    });
    await waitFor(() => expect(result.current.data).toEqual({ value: "first" }));

    rerender({ endpoint: "/second" });
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await act(async () => {
      second.reject(new Error("replacement failed"));
      try {
        await second.promise;
      } catch {
        // The hook converts this rejection into its public error state.
      }
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("replacement failed");
    expect(consoleError).toHaveBeenCalled();
  });
});
