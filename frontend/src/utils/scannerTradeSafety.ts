import type { ScannerReplacementDecision } from "./scannerPositionMatch";

// No Fidelity account-funding feed exists. Keep this fail-closed even when an
// older API response or a cached scanner event still says "candidate".
export const SCANNER_RECOMMENDATIONS_PAUSED = true;
export const SCANNER_FUNDING_LABEL = "Funding not verified — research only";
export const SCANNER_FUNDING_REASON = "Fidelity restrictions, payment for the held option, and settled cash for the full replacement purchase and fees are unverified. Trade and roll recommendations are withheld.";
export const SCANNER_FUNDING_RULE = "A margin label or net-credit roll does not establish eligibility. Closing-sale credits and unsettled proceeds do not count as settled cash.";

export function enforceScannerFundingGate(decision: ScannerReplacementDecision): ScannerReplacementDecision {
  if (decision.status === "rejected" || decision.status === "not_applicable") return decision;
  return {
    ...decision,
    status: "blocked",
    recommendation: "funding_unverified",
    action: "none",
    label: "Roll withheld · funding unverified",
    summary: SCANNER_FUNDING_REASON,
    implementation_ready: false,
    automated_execution_enabled: false,
    journal_rule: "Verify payment and settled funds before trading. Record completed fills as separate trades.",
  };
}
