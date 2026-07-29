export type EvidenceState =
  | "loading"
  | "complete"
  | "partial"
  | "stale"
  | "empty"
  | "error";

type ResourceEvidenceInput = {
  available: boolean;
  loading: boolean;
  error: string | null;
  partial?: boolean;
};

export function classifyResourceEvidence({
  available,
  loading,
  error,
  partial = false,
}: ResourceEvidenceInput): EvidenceState {
  if (available) {
    if (loading || error) {
      return "stale";
    }
    return partial ? "partial" : "complete";
  }
  if (loading) {
    return "loading";
  }
  if (error) {
    return "error";
  }
  return "empty";
}

export function classifyCollectionEvidence<T>({
  data,
  loading,
  error,
  partial = false,
}: {
  data: readonly T[] | null | undefined;
  loading: boolean;
  error: string | null;
  partial?: boolean;
}): EvidenceState {
  return classifyResourceEvidence({
    available: Boolean(data?.length),
    loading,
    error,
    partial,
  });
}

export function combineEvidenceStates(states: readonly EvidenceState[]): EvidenceState {
  if (states.length === 0 || states.every((state) => state === "empty")) {
    return "empty";
  }
  if (states.every((state) => state === "complete")) {
    return "complete";
  }
  if (states.every((state) => state === "loading")) {
    return "loading";
  }
  if (states.every((state) => state === "error")) {
    return "error";
  }
  if (states.includes("stale")) {
    return "stale";
  }
  return "partial";
}
