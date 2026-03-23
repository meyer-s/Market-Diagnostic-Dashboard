export const normalizeUpdateSummary = (summary?: string | null): string | null => {
  const normalized = (summary || "").replace(/\s+/g, " ").trim();
  return normalized || null;
};

export const splitUpdateSummary = (
  summary?: string | null,
): { lead: string | null; remainder: string | null } => {
  const normalized = normalizeUpdateSummary(summary);
  if (!normalized) {
    return { lead: null, remainder: null };
  }

  const sentences =
    normalized.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];

  if (sentences.length <= 1) {
    return { lead: normalized, remainder: null };
  }

  return {
    lead: sentences[0],
    remainder: sentences.slice(1).join(" ").trim() || null,
  };
};
