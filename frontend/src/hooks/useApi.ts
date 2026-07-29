import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, getErrorMessage } from "../utils/apiUtils";
import { loadingStore } from "../utils/loadingStore";

const DEFAULT_READ_TIMEOUT_MS = 20_000;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : typeof error === "object"
      && error !== null
      && "name" in error
      && error.name === "AbortError";
}

export interface UseApiOptions {
  retainPreviousData?: boolean;
  timeoutMs?: number;
}

export function useApi<T>(
  endpoint: string,
  {
    retainPreviousData = true,
    timeoutMs = DEFAULT_READ_TIMEOUT_MS,
  }: UseApiOptions = {},
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const requestGeneration = useRef(0);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    if (!endpoint) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    let active = true;
    let loadingAccounted = true;
    const finishLoading = () => {
      if (!loadingAccounted) return;
      loadingAccounted = false;
      loadingStore.stop();
    };

    setLoading(true);
    setError(null);
    if (!retainPreviousData) setData(null);
    loadingStore.start();
    void apiFetch<T>(endpoint, { signal: controller.signal, timeoutMs })
      .then((result) => {
        if (!active || generation !== requestGeneration.current) return;
        setData(result);
      })
      .catch((err: unknown) => {
        if (!active || generation !== requestGeneration.current || controller.signal.aborted || isAbortError(err)) {
          return;
        }
        const message = getErrorMessage(err);
        console.error('Fetch error for', endpoint, ':', message);
        setError(message);
      })
      .finally(() => {
        finishLoading();
        if (active && generation === requestGeneration.current) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
      controller.abort();
      finishLoading();
    };
  }, [endpoint, refetchTrigger, retainPreviousData, timeoutMs]);

  const refetch = useCallback(() => {
    setRefetchTrigger(prev => prev + 1);
  }, []);

  return { data, loading, error, refetch };
}
