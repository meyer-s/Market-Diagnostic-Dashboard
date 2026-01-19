import { useState, useEffect } from "react";
import { apiFetch } from "../utils/apiUtils";
import { loadingStore } from "../utils/loadingStore";

export function useApi<T>(endpoint: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  const fetchData = () => {
    setLoading(true);
    setError(null);
    loadingStore.start();
    apiFetch<T>(endpoint)
      .then((result) => {
        setData(result);
      })
      .catch((err) => {
        console.error('Fetch error for', endpoint, ':', err.message);
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
        loadingStore.stop();
      });
  };

  useEffect(() => {
    if (endpoint) {
      fetchData();
    }
  }, [endpoint, refetchTrigger]);

  const refetch = () => {
    setRefetchTrigger(prev => prev + 1);
  };

  return { data, loading, error, refetch };
}
