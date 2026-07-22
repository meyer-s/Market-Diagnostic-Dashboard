# Implementation and claim map

This map connects paper sections to the implementation that generated them. It
is an audit aid, not part of the ICLR page-limited main text.

| Paper topic | Production source | Claim boundary |
|---|---|---|
| Pressure surface, causal smoothing, base channels | backend/app/services/market_weather.py | Engineered bounded representation; not physical pressure |
| Derivative hierarchy, log-horizon geometry, permutation entropy, strata, carriers | backend/app/services/market_weather_research.py | Finite differences and operational analogues; not new dimensions or market physics |
| Form dictionary, chronology, distance tails | backend/app/services/market_weather_research.py | Request-local empirical codebook; not universal latent regimes or formal p-values |
| Scope projections and display smoothing | frontend/src/components/marketWeather/MarketWeatherResearchLab.tsx | Visualization only; loops are not detected cycles or attractors |
| Human labels | frontend/src/utils/marketWeatherLexicon.ts | Translation of measured profiles; not independently learned semantics |
| Prior-bar support, resistance, optionality and cross-market context | backend/app/services/market_weather_context.py | Context and association screening; not order-book structure or causation |
| Completed-bar option snapshot | backend/app/services/option_field_context.py | Prefix-only daily evidence; shadow-only and zero rank weight |
| Scanner persistence | backend/maintenance_scripts/options_chain_sweep.py and backend/app/services/options_alerts.py | Field cannot create scanner eligibility |
| Opportunity score and sweep serialization | backend/app/services/options_opportunity.py and backend/app/services/option_sweep_runs.py | Champion scoring remains unchanged |
| Manager shadow challenger | backend/app/services/option_thesis_engine.py and backend/app/api/secret_options.py | Advisory confidence and urgency only; no verdict, sizing, target, or execution authority |
| Replacement display | backend/app/services/option_replacement_classifier.py | Explicit pass/watch/fail context; implementation_ready remains false |
| Point-in-time outcome cohorts | backend/app/services/option_decision_learning.py | Descriptive cohorts; no dependence, exposure, duration, or cost adjustment yet |
| Paper evidence generation | docs/papers/market-field/scripts/generate_assets.py | Mechanics and controlled behavior; no return or option-performance test |

The public research API supports 1m, 5m, 15m, 30m, 1h, 2h, 4h, 1D, and 1W
requests, but each request is one symbol and one timeframe. Horizon rows are bar
counts inside that timeframe; the present implementation is not a fused
nine-timeframe model.
