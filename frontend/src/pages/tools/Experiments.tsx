import { useState } from "react";
import { Link } from "react-router-dom";
import WeatherPsychologyWidget from "../../components/widgets/WeatherPsychologyWidget";
import RatesSpreadWidget from "../../components/widgets/RatesSpreadWidget";

const envEnabled = (value: string | undefined, fallback = true) => {
  if (value === undefined) return fallback;
  return value.toLowerCase() !== "false";
};

const EXPERIMENTS_ENABLED = envEnabled(import.meta.env.VITE_EXPERIMENTS_ENABLED, true);
const WEATHER_ENABLED = envEnabled(import.meta.env.VITE_EXPERIMENTS_WEATHER_ENABLED, true);
const RATES_ENABLED = envEnabled(import.meta.env.VITE_EXPERIMENTS_RATES_ENABLED, true);

export default function Experiments() {
  const [days, setDays] = useState<90 | 180 | 365>(180);

  if (!EXPERIMENTS_ENABLED) {
    return (
      <div className="space-y-4 p-4 text-stealth-100 md:space-y-6 md:p-6">
        <h1 className="text-2xl font-semibold text-stealth-100">Experiments</h1>
        <div className="rounded-2xl border border-stealth-700 bg-stealth-800/90 p-6 text-sm text-stealth-300">
          Experiments are currently disabled by feature flag.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 text-stealth-100 md:space-y-6 md:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stealth-100">Experiments</h1>
          <p className="mt-1 text-sm text-stealth-400">
            Research modules for behavioral and rates-spread hypotheses. Outputs are exploratory context, not trade signals.
          </p>
        </div>
        <div className="control-strip">
          <button
            onClick={() => setDays(90)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition ${
              days === 90 ? "bg-stealth-700 text-white" : "text-stealth-400 hover:text-stealth-200"
            }`}
          >
            90d
          </button>
          <button
            onClick={() => setDays(180)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition ${
              days === 180 ? "bg-stealth-700 text-white" : "text-stealth-400 hover:text-stealth-200"
            }`}
          >
            6mo
          </button>
          <button
            onClick={() => setDays(365)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition ${
              days === 365 ? "bg-stealth-700 text-white" : "text-stealth-400 hover:text-stealth-200"
            }`}
          >
            1yr
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-stealth-700 bg-stealth-800/70 p-4 text-xs leading-relaxed text-stealth-300">
        Guardrails: correlations are shown with significance context, and proxy fallback series are suppressed by default to avoid accidental over-reading of synthetic substitutes.
        <div className="mt-2">
          <Link className="text-sky-300 hover:text-sky-200" to="/tools/weather-research">
            Open full weather explorer (granular + long-history)
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {WEATHER_ENABLED ? (
          <WeatherPsychologyWidget days={days} />
        ) : (
          <div className="primary-card p-4 md:p-6">
            <h3 className="text-sm font-semibold text-stealth-100">Weather Sensitivity</h3>
            <p className="mt-2 text-xs text-stealth-400">Disabled by feature flag.</p>
          </div>
        )}

        {RATES_ENABLED ? (
          <RatesSpreadWidget days={days} />
        ) : (
          <div className="primary-card p-4 md:p-6">
            <h3 className="text-sm font-semibold text-stealth-100">Rates Spread Monitor</h3>
            <p className="mt-2 text-xs text-stealth-400">Disabled by feature flag.</p>
          </div>
        )}
      </div>
    </div>
  );
}
