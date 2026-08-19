import { AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";

import { formatCurrency } from "./presentation";
import type { OptionStrategyCandidate, OptionStrategyPlan } from "./types";

interface StrategyPlanCardProps {
  plan: OptionStrategyPlan;
  riskBudget?: number | null;
  disabled?: boolean;
  onUse: (candidate: OptionStrategyCandidate) => void;
}

const words = (value: string | null | undefined) =>
  (value || "unknown").replace(/_/g, " ");

const formatMaxProfit = (candidate: OptionStrategyCandidate) =>
  candidate.max_profit === null ? candidate.max_profit_label : formatCurrency(candidate.max_profit);

function CandidateSummary({ candidate }: { candidate: OptionStrategyCandidate }) {
  return (
    <div className="grid gap-2 text-xs text-stealth-300 sm:grid-cols-3">
      <div>
        <div className="text-stealth-500">Maximum loss</div>
        <div className="mt-0.5 font-semibold text-rose-200">{formatCurrency(candidate.max_loss)} / unit</div>
      </div>
      <div>
        <div className="text-stealth-500">Maximum profit</div>
        <div className="mt-0.5 font-semibold text-emerald-200">{formatMaxProfit(candidate)}</div>
      </div>
      <div>
        <div className="text-stealth-500">Break-even</div>
        <div className="mt-0.5 font-semibold text-stealth-100">
          {candidate.breakevens.length > 0
            ? candidate.breakevens.map((value) => `$${value.toFixed(2)}`).join(" / ")
            : "Not available"}
        </div>
      </div>
    </div>
  );
}

export function StrategyPlanCard({ plan, riskBudget, disabled = false, onUse }: StrategyPlanCardProps) {
  const candidate = plan.primary;
  const recommendedUnits =
    riskBudget && candidate.max_loss > 0
      ? Math.floor(riskBudget / candidate.max_loss)
      : 1;
  const exceedsBudget = Boolean(riskBudget && recommendedUnits < 1);
  const quotesNeedReview = candidate.status !== "actionable";
  const useDisabled = disabled || exceedsBudget;
  const useLabel = exceedsBudget
    ? "Above risk budget"
    : quotesNeedReview
      ? "Review quotes & continue"
      : "Use this plan";
  const useButtonClass = quotesNeedReview
    ? "border border-amber-500/55 bg-amber-950/55 text-amber-100 hover:bg-amber-900/65 focus-visible:ring-amber-300"
    : "bg-emerald-700 text-white hover:bg-emerald-600 focus-visible:ring-emerald-300";

  return (
    <section
      aria-labelledby="strategy-plan-heading"
      className="border-b border-stealth-800 bg-stealth-900/55 px-4 py-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="strategy-plan-heading" className="text-base font-semibold text-stealth-100">
              {candidate.label}
            </h3>
            <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-100">
              System plan
            </span>
            <span className="text-xs text-stealth-400">
              {words(candidate.direction)} · {words(candidate.volatility_exposure)}
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-stealth-300">{candidate.rationale}</p>
        </div>
        <button
          type="button"
          onClick={() => onUse(candidate)}
          disabled={useDisabled}
          className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-stealth-700 disabled:text-stealth-400 ${useButtonClass}`}
        >
          {quotesNeedReview || exceedsBudget ? (
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          )}
          {useLabel}
        </button>
      </div>

      <div className="mt-4 border-y border-stealth-800 py-3">
        <CandidateSummary candidate={candidate} />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stealth-300">
        {candidate.legs.map((leg, index) => (
          <span key={`${leg.action}-${leg.option_type}-${leg.strike}-${index}`}>
            {leg.action === "buy" ? "+" : "−"} {leg.quantity} {leg.option_type.toUpperCase()} ${leg.strike.toFixed(2)}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs leading-5 text-stealth-400">
        Works if: {candidate.success_condition}
      </p>

      {riskBudget ? (
        <p className={`mt-2 text-xs ${exceedsBudget ? "text-amber-200" : "text-stealth-400"}`}>
          Risk budget {formatCurrency(riskBudget)} supports {Math.max(0, recommendedUnits)} unit{recommendedUnits === 1 ? "" : "s"}; the trade form will use that quantity.
        </p>
      ) : (
        <p className="mt-2 text-xs text-stealth-500">No approved default risk budget was found, so the form will start at one unit.</p>
      )}

      {candidate.quote_issues.length > 0 ? (
        <div role="alert" className="mt-3 text-xs leading-5 text-amber-200">
          Live pricing check required: {candidate.quote_issues.join("; ")}.
        </div>
      ) : null}

      {plan.alternatives.length > 0 ? (
        <details className="group mt-3 border-t border-stealth-800 pt-3">
          <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 text-xs font-semibold text-stealth-300 hover:text-stealth-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">
            <ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden="true" />
            {plan.alternatives.length} more structure{plan.alternatives.length === 1 ? "" : "s"} if you want a different payoff
          </summary>
          <div className="mt-2 divide-y divide-stealth-800 border-y border-stealth-800">
            {plan.alternatives.map((alternative) => {
              const alternativeNeedsReview = alternative.status !== "actionable";
              const alternativeExceedsBudget = Boolean(riskBudget && riskBudget < alternative.max_loss);
              return (
                <div key={alternative.strategy_type} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-semibold text-stealth-200">{alternative.label}</div>
                    <div className="mt-0.5 text-xs text-stealth-400">
                      Max loss {formatCurrency(alternative.max_loss)} · max profit {formatMaxProfit(alternative)} · {words(alternative.volatility_exposure)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onUse(alternative)}
                    disabled={disabled || alternativeExceedsBudget}
                    className="min-h-9 shrink-0 rounded-md border border-stealth-600 px-3 text-xs font-semibold text-stealth-200 hover:border-stealth-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                    aria-label={`${alternativeNeedsReview ? "Review quotes and use" : "Use"} ${alternative.label}`}
                  >
                    {alternativeExceedsBudget
                      ? "Above risk budget"
                      : alternativeNeedsReview
                        ? "Review & use"
                        : "Use alternative"}
                  </button>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </section>
  );
}
