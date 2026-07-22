# Implementation and claim map

This map connects paper sections to the implementation that generated them. It
is an audit aid, not part of the ICLR page-limited main text.

Version legend: `market_field_calculus_v1` is the formula model;
`semantic_revision=1.2` is the current additive metadata/authority contract
(legacy 1.0/1.1 payloads remain immutable/readable); and
`market_field_preliminary_v2` is the evaluation harness, not a v2 formula.

| Paper topic | Production source | Claim boundary |
|---|---|---|
| Pressure surface, prefix-only smoothing, base channels, input quality, and initialization coverage | backend/app/services/market_weather.py | Engineered bounded representation with visible minimum-input/initialization contracts; `maturity` remains a legacy serialized alias, not a convergence guarantee |
| Derivative hierarchy, log-horizon geometry, permutation entropy, strata, carriers, and semantic anchors | backend/app/services/market_weather_research.py | Finite differences and operational analogues; activity/agreement and scaling references do not change the v1 state vector |
| Form dictionary, chronology, distance tails | backend/app/services/market_weather_research.py | Request-local empirical codebook; upper calibration-distance tail, not a coordinatewise range test, universal latent regime, or formal p-value |
| Scope projections and display smoothing | frontend/src/components/marketWeather/MarketWeatherResearchLab.tsx | Visualization only; loops are not detected cycles or attractors |
| Human labels | frontend/src/utils/marketWeatherLexicon.ts | Translation of measured profiles; not independently learned semantics |
| Prior-bar support, resistance, optionality and cross-market context | backend/app/services/market_weather_context.py | Context and association screening; not order-book structure or causation |
| Completed-bar option snapshot | backend/app/services/option_field_context.py | Prefix-only daily evidence with signed-delta/action alignment when supplied and a labeled legacy long-single-leg fallback; explicit zero rank/veto/verdict/size/execution authority |
| Scanner persistence | backend/maintenance_scripts/options_chain_sweep.py and backend/app/services/options_alerts.py | Field cannot create scanner eligibility |
| Opportunity score and sweep serialization | backend/app/services/options_opportunity.py and backend/app/services/option_sweep_runs.py | Champion scoring remains unchanged |
| Manager shadow challenger | backend/app/services/option_thesis_engine.py and backend/app/api/secret_options.py | Human-visible confidence and urgency only; urgency may recompute the next-review date, but there is no algorithmic verdict, sizing, target, or execution authority; behavioral exposure remains possible and impression logging is deferred |
| Replacement display | backend/app/services/option_replacement_classifier.py | Explicit pass/watch/fail context; implementation_ready remains false |
| Point-in-time outcome cohorts | backend/app/services/option_decision_learning.py | Descriptive cohorts; no dependence, exposure, duration, or cost adjustment yet |
| Primary paper evidence generation | docs/papers/market-field/scripts/generate_assets.py | Mechanics and controlled behavior; no return or option-performance test |
| Supplementary v2 evaluation and run receipt | docs/papers/market-field/supplement/evaluate_market_field.py | Per-file source hashes identify dirty-working-tree runs; latency/payload distributions are run-specific, not service contracts |

The public research API supports 1m, 5m, 15m, 30m, 1h, 2h, 4h, 1D, and 1W
requests, but each request is one symbol and one timeframe. Horizon rows are bar
counts inside that timeframe; the present implementation is not a fused
nine-timeframe model.
