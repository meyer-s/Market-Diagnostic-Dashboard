import type { ReactNode } from "react";

import type { EvidenceState } from "../../utils/evidenceState";

const stateLabels: Record<EvidenceState, string> = {
  loading: "Loading",
  complete: "Complete",
  partial: "Partial",
  stale: "Stale",
  empty: "No data",
  error: "Unavailable",
};

const stateStyles: Record<EvidenceState, string> = {
  loading: "border-sky-500/35 bg-sky-500/10 text-sky-200",
  complete: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  partial: "border-amber-500/35 bg-amber-500/10 text-amber-200",
  stale: "border-orange-500/35 bg-orange-500/10 text-orange-200",
  empty: "border-stealth-600 bg-stealth-800 text-stealth-200",
  error: "border-red-500/35 bg-red-500/10 text-red-200",
};

type EvidenceStateNoticeProps = {
  panelId: string;
  title: string;
  state: EvidenceState;
  message: string;
  details?: ReactNode;
  className?: string;
};

export default function EvidenceStateNotice({
  panelId,
  title,
  state,
  message,
  details,
  className = "",
}: EvidenceStateNoticeProps) {
  const liveRole = state === "error" ? "alert" : state === "complete" ? undefined : "status";

  return (
    <section
      className={`rounded-xl border p-3 ${stateStyles[state]} ${className}`.trim()}
      data-evidence-panel={panelId}
      data-evidence-state={state}
      role={liveRole}
      aria-label={`${title}: ${stateLabels[state]}`}
      aria-live={liveRole ? (state === "error" ? "assertive" : "polite") : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="rounded-full border border-current/25 px-2 py-1 text-xs font-semibold uppercase tracking-[0.12em]">
          {stateLabels[state]}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 opacity-90">{message}</p>
      {details ? <div className="mt-2 text-xs opacity-80">{details}</div> : null}
    </section>
  );
}
