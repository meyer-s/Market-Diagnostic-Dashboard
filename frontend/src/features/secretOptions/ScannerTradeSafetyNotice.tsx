import { SCANNER_FUNDING_LABEL, SCANNER_FUNDING_REASON, SCANNER_FUNDING_RULE } from "../../utils/scannerTradeSafety";

export function ScannerTradeSafetyNotice() {
  return (
    <aside aria-label="Scanner funding guard" className="my-3 rounded-lg border border-amber-600/45 bg-amber-950/25 p-3 text-sm leading-6 text-amber-100">
      <strong className="block">{SCANNER_FUNDING_LABEL}</strong>
      <p className="mt-1">{SCANNER_FUNDING_REASON}</p>
      <details className="mt-1">
        <summary className="min-h-11 cursor-pointer content-center font-semibold">Settled-cash requirements</summary>
        <p>{SCANNER_FUNDING_RULE}</p>
        <p className="mt-2">The scanner does not clear a broker restriction based on elapsed calendar days. Confirm the restriction and available funds with Fidelity.</p>
        <a className="inline-flex min-h-11 items-center underline" href="https://www.fidelity.com/learning-center/trading-investing/trading/avoiding-cash-trading-violations" target="_blank" rel="noreferrer">Fidelity cash trading rules ↗</a>
      </details>
    </aside>
  );
}
