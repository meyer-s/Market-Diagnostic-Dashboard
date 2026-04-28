import { useState } from "react";
import DebtCompositeCreditWidget from "../../components/widgets/DebtCompositeCreditWidget";

type TrendPeriod = 90 | 180 | 365;

export default function DebtTools() {
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>(90);

  return (
    <div className="page-shell page-stack">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="page-kicker">Tools</span>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Debt Diagnostics</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">Expanded debt-stability view with composite stress attribution, credit quality, and live yield-curve onionskinning.</p>
        </div>
        <div className="control-strip">
          <button onClick={() => setTrendPeriod(90)} className={`flex-1 rounded-full px-3 py-1 text-sm ${trendPeriod === 90 ? "bg-stealth-700 text-white" : "text-stealth-400"}`}>90d</button>
          <button onClick={() => setTrendPeriod(180)} className={`flex-1 rounded-full px-3 py-1 text-sm ${trendPeriod === 180 ? "bg-stealth-700 text-white" : "text-stealth-400"}`}>6mo</button>
          <button onClick={() => setTrendPeriod(365)} className={`flex-1 rounded-full px-3 py-1 text-sm ${trendPeriod === 365 ? "bg-stealth-700 text-white" : "text-stealth-400"}`}>1yr</button>
        </div>
      </div>

      <DebtCompositeCreditWidget trendPeriod={trendPeriod} />

      <div className="surface-card-strong p-4 sm:p-5">
        <h3 className="text-base font-semibold text-stealth-100">Methodology & Scoring</h3>
        <div className="mt-2 text-sm text-stealth-300 space-y-1">
          <p>1. Composite stress combines four sub-systems: credit spreads, yield curve shape, rates momentum, and Treasury volatility.</p>
          <p>2. Sub-system stress scores are normalized to 0-100 and weighted into composite stress; stability is displayed as 100 minus stress.</p>
          <p>3. Credit quality view tracks HY OAS, IG OAS, and the HY-IG gap to capture funding-risk deterioration.</p>
          <p>4. Yield-curve onionskin overlays recent prior curves behind the latest curve to show shape drift visually.</p>
          <p>5. Insight labels explain inversion/flat/normal curve state and top stress drivers in plain language.</p>
        </div>
      </div>
    </div>
  );
}
