import type { AgricultureContextData } from "./AgricultureContextPanel";

type SignalContext = Pick<AgricultureContextData, "context_score" | "setup_label" | "technical">;

type ContractSignalPresentation = {
  description: string;
  label: string;
  tone: "bullish" | "bearish" | "caution" | "inactive" | "informational";
};

const TONE_CLASS: Record<ContractSignalPresentation["tone"], string> = {
  bullish: "border-emerald-400/35 bg-emerald-500/12 text-emerald-200",
  bearish: "border-rose-400/35 bg-rose-500/12 text-rose-200",
  caution: "border-amber-400/35 bg-amber-500/12 text-amber-200",
  inactive: "border-stealth-600 bg-stealth-800/70 text-stealth-300",
  informational: "border-sky-400/30 bg-sky-500/10 text-sky-200",
};

function directionalPresentation(
  prefix: "A" | "F" | "T",
  source: "Aligned" | "Fundamental" | "Technical",
  bias?: string
): ContractSignalPresentation {
  if (bias === "bullish") {
    return { description: `${source} long`, label: `${prefix}\u2191`, tone: "bullish" };
  }
  if (bias === "bearish") {
    return { description: `${source} short`, label: `${prefix}\u2193`, tone: "bearish" };
  }
  return { description: `${source} direction unavailable`, label: `${prefix}\u2014`, tone: "informational" };
}

export function getContractSignalPresentation(
  context?: SignalContext | null,
  loading = false,
  error?: string | null
): ContractSignalPresentation {
  if (loading) {
    return { description: "Contract setup loading", label: "LOADING", tone: "inactive" };
  }
  if (error || !context) {
    return { description: "Contract setup unavailable", label: "N/A", tone: "inactive" };
  }

  const setup = context.setup_label.trim().toLowerCase();
  if (setup === "aligned long setup") return directionalPresentation("A", "Aligned", "bullish");
  if (setup === "aligned short setup") return directionalPresentation("A", "Aligned", "bearish");
  if (setup === "fundamental-only setup") {
    return directionalPresentation("F", "Fundamental", context.context_score.net_bias);
  }
  if (setup === "technical-only setup") {
    return directionalPresentation("T", "Technical", context.technical.bias);
  }
  if (setup === "conflicting signals") {
    const technicalDirection = context.technical.bias === "bullish" ? "long" : context.technical.bias === "bearish" ? "short" : "neutral";
    const fundamentalDirection = context.context_score.net_bias === "bullish" ? "long" : context.context_score.net_bias === "bearish" ? "short" : "mixed";
    return {
      description: `Conflicting signals: technical ${technicalDirection}, fundamental ${fundamentalDirection}`,
      label: "CONFLICT",
      tone: "caution",
    };
  }
  if (setup === "watch") return { description: "Watch", label: "WATCH", tone: "caution" };
  if (setup === "avoid") return { description: "Avoid", label: "AVOID", tone: "bearish" };
  if (setup === "wait for report") return { description: "Wait for report", label: "WAIT", tone: "caution" };
  if (setup === "closed/no execution") return { description: "Market closed; no execution", label: "CLOSED", tone: "inactive" };

  const fallbackLabel = context.setup_label.trim() || "Unknown setup";
  return { description: fallbackLabel, label: fallbackLabel.toUpperCase(), tone: "informational" };
}

export function ContractSignalBadge({
  symbol,
  context,
  loading = false,
  error,
}: {
  symbol: string;
  context?: SignalContext | null;
  loading?: boolean;
  error?: string | null;
}) {
  const presentation = getContractSignalPresentation(context, loading, error);

  return (
    <>
      <span
        aria-hidden="true"
        className={`inline-flex min-h-6 items-center rounded-md border px-1.5 text-xs font-bold tabular-nums ${TONE_CLASS[presentation.tone]}`}
      >
        {presentation.label}
      </span>
      <span className="sr-only">{symbol}, {presentation.description}</span>
    </>
  );
}

export function ContractSignalLegend() {
  return (
    <p className="mt-2 max-w-3xl text-xs leading-5 text-stealth-300">
      Each contract carries its current setup: <span className="font-semibold text-stealth-100">A</span> aligned,{
      " "
      }<span className="font-semibold text-stealth-100">F</span> fundamental, or <span className="font-semibold text-stealth-100">T</span> technical.
      Arrows show long or short; watch, avoid, conflict, report-wait, and closed states are written out.
    </p>
  );
}
