# Options decision engine: July 15, 2026 review

## Executive summary

Today the options page changed from a position ledger with model context into an auditable decision-support system. The core question is now:

> Knowing what we know today, would this exact contract, at this size, still be one of the best uses of the remaining capital?

The system now reconstructs and versions the original trade mandate, produces deterministic point-in-time thesis assessments, separates automatic recommendations from human decisions, preserves every review and revised decision window, journals position lifecycle events, classifies closed-trade lessons, and records scanner recurrences when a held contract appears again.

It remains a decision engine, not an execution engine. It does not add, trim, close, roll, stage, or route orders. It does not silently approve thresholds, rewrite history, or promote a learned model. The user remains the decision authority.

The page also became materially faster. Position metrics can be served from a stale-but-usable cache while a guarded background refresh runs. Heavy evidence is disclosed on demand, review windows are fetched in one portfolio request, and the whole-list refresh has explicit pending/settled state. As the final visual adjustment today, refresh state is shown on the right edge of each affected position row rather than on the entire list card.

## What changed today

The work landed as a sequence of compatible changes:

| Change | What it added | Why it matters |
| --- | --- | --- |
| Append-only decision reviews | Versioned reviews, position snapshots, review history, and supersession links | A new decision never destroys the old one |
| Automatic thesis grading | Deterministic assessment engine, point-in-time inputs, vetoes, target size, confidence, and six separate axes | The system can prepare most of the review without asking the user to re-enter observable data |
| Decision and trade learning | Decision-horizon outcomes, closed-trade postmortems, model registry, and learning summary | The system can compare decisions with later outcomes without confusing counterfactuals with actual fills |
| Scheduled processing | Intraday due-review grading and after-hours learning jobs | Reviews and outcome maturation do not depend on the page being open |
| Decision cockpit | Separate confirm, override, revise-window, and refresh-grade actions | Human intent is explicit and the primary decision is no longer buried in evidence |
| Performance work | Cached position metrics, stale-while-refresh behavior, bounded background computation, and reduced repeated loading | The page can render useful state before fresh broker-dependent work completes |
| Review-window correction | Future next-review dates, decision-aware maximum-hold deadlines, and expiry buffers | A revised window is actionable from today instead of replaying an entry-era date |
| Timeline redesign | Filled active windows, compact brackets, a stronger today marker, and persistent onion-skin history | The active interval is primary while prior decisions remain visible |
| Whole-list refresh | One control refreshes positions and portfolio review windows, with pending and settled feedback | The user can deliberately request a coherent portfolio refresh |
| Scanner repeat evidence | Held-contract matching, recurrence counts, evidence deltas, conflict detection, and append-only scanner events | A repeat hit becomes evidence to investigate, not an automatic instruction to add |
| Row-level refresh state | Amber pending and short-lived green settled bars on each position row | Refresh status now belongs visually to the data being refreshed |

## The operating model

The subsystem separates five concepts that used to blur together:

1. **Mandate:** what the position was originally intended to accomplish.
2. **Assessment:** what the deterministic grader concludes from point-in-time evidence.
3. **Decision review:** what the human actually confirms or overrides.
4. **Lifecycle evidence:** what happened to the position, including edits, size changes, scanner recurrence, reviews, and closure.
5. **Outcome:** what later happened to the decision and to the actual closed trade.

That separation is the main safeguard against hindsight drift. A later assessment may supersede an earlier assessment, and a later review may supersede an earlier review, but neither edits its predecessor.

## Data records and their responsibilities

### Position mandate

`option_position_mandate` is a versioned statement of intent. It records:

- original company thesis and exact-contract thesis;
- expected path and catalyst;
- confirmation and invalidation conditions;
- decision deadline and risk budget;
- threshold values plus their origin and approval status;
- source event, source confidence, capture kind, and confirmation status;
- a pointer to the mandate version it supersedes.

Existing positions receive a reconstructed draft mandate when necessary. Reconstruction is useful context, not proof of original intent. When the user confirms or changes the mandate through a review, the system appends a new user-confirmed mandate version.

### Automatic thesis assessment

`option_thesis_assessment` is an immutable point-in-time grader result. It stores:

- grader and feature-schema versions;
- an input hash and the complete input snapshot used by the grader;
- company thesis, security readiness, path, contract, portfolio, and data-quality states;
- proposed verdict and target contract range;
- quality, urgency, and confidence;
- continuation condition, next review, and decision deadline;
- hard vetoes, reasons, missing inputs, evidence, and axis details;
- the trigger that created the assessment and the assessment it supersedes.

This is deliberately reproducible. A future grader can be compared with the stored input and version rather than reconstructing the past from current data.

### Human decision review

`option_position_review` is the append-only human decision journal. Every row copies the contract identity, contract count, mandate context, live price and risk snapshot, verdict, target count, review timing, and supporting notes. It also records:

- which automatic assessment was considered;
- whether the decision was confirmed or overridden;
- the override reason;
- whether thresholds are still drafts or have been approved;
- the preceding review and monotonically increasing review sequence.

Copying position fields into the review is intentional. The record remains understandable after the live position is resized, edited, or moved to closed history.

### Position lifecycle event

`option_position_event` is the append-only operational ledger. It can link an event to a review, assessment, scanner alert, or closed position and preserves quantity, execution, cost, source, and structured detail. Current event uses include open, edit/resize, assessment, review, scanner recurrence, and close.

### Decision outcome

`option_decision_outcome` evaluates a review at a predeclared horizon. It stores the decision and recommended verdict, contract counts, underlying and option values at the decision and outcome, directional and option returns, incremental value, valuation method, process quality, outcome quality, and attribution.

These rows are counterfactual decision-learning records. They are not substituted for actual executions.

### Closed-trade outcome

`option_trade_outcome` is a versioned postmortem for the actual closed trade. It separately classifies:

- financial outcome;
- thesis selection;
- contract selection;
- timing;
- sizing;
- portfolio concentration;
- entry execution;
- exit discipline;
- event result;
- review discipline;
- process quality, decision alignment, and primary lesson.

Human corrections create another outcome version instead of overwriting the automatic classification.

### Risk policy and model registry

`option_risk_policy` stores versioned portfolio guardrails. A policy affects hard decisions only when it is both active and approved. Draft values remain visible but do not quietly become mandate rules.

`option_model_registry` records champion and challenger versions, feature schema, sample count, training range, metrics, promotion gates, code commit, and promotion time. Promotion is explicit and manual.

## End-to-end processes

### 1. Opening or importing a position

1. The position is stored with contract identity, trade date, size, fill, premium cost, entry-underlying context, and scanner attribution when available.
2. Duplicate protection checks existing open and closed records.
3. The system creates or locates a mandate. For older positions this may be a low-confidence reconstructed draft.
4. An `opened` lifecycle event is appended.
5. The position becomes eligible for live metrics, review-window matching, assessment, and later outcomes.

Context: reconstructed context reduces data entry, but unknown thesis facts remain unknown. The grader exposes missing mandate fields instead of inventing certainty.

### 2. Loading the options workspace

1. The position list requests `/secret/options/positions`.
2. The API returns cached metrics immediately when a usable snapshot exists.
3. If the cache is stale, the response can still serve the stale snapshot and indicate that a background refresh is active.
4. Metrics computation uses detached scalar position snapshots so the database session does not outlive the request.
5. Background work is bounded and protected so multiple page requests do not launch competing IBKR-heavy refreshes.
6. Review windows are loaded once from the compact portfolio-level `/decision-review-windows` endpoint.
7. Selected-position assessment and deeper market/risk evidence load separately from the base list.

Context: stale-while-refresh is a deliberate tradeoff. A timestamped recent value is more useful for initial rendering than blocking the entire page on every quote and calculation, provided the UI makes freshness visible.

### 3. Refreshing the whole list

1. The user presses **Refresh list**.
2. The frontend requests positions with `refresh=true` and reloads the compact review-window payload in parallel.
3. The API schedules one guarded batch metrics refresh rather than one competing refresh per row.
4. The frontend polls quietly while `refresh_in_progress` remains true.
5. Each displayed row shows an amber right-edge bar while the batch affecting it is pending.
6. After completion, each row briefly shows a green right-edge bar and the button reports **Updated**.

The row bars are presentation-level per-row status over a batch refresh; they do not imply that each contract has a separate broker request or independent completion time. This preserves the faster batch architecture while locating the status beside the data it describes.

### 4. Generating an automatic grade

The assessment is deterministic and layered:

1. **Reconcile inputs.** Read the exact position, quote, DTE, current underlying, mandate, latest human review, scanner source event, portfolio, projection/fundamental snapshot, technical snapshot, and risk policy.
2. **Company thesis.** Prefer the latest human thesis status. If none exists, use current fundamental signals. Price action is not allowed to prove the company thesis.
3. **Path and timing.** Compare direction-adjusted underlying progress with entry and deadline context. Technical state is supporting path evidence, not a replacement for business evidence.
4. **Exact contract.** Evaluate time remaining, moneyness versus remaining implied move, and execution spread.
5. **Portfolio fit.** Calculate tracked-premium shares for the position, direction, and expiry bucket. Apply approved policy limits if one exists; otherwise surface crowding as context.
6. **Data quality.** List missing live quotes, technical history, fundamentals, confirmed mandate, approved policy, and capital/NAV. Missing spot or DTE stops decision-grade output.
7. **Hard vetoes.** Apply invalid thesis, expiration, failed deadline, nonviable contract, mandate risk-budget breach, or material approved-policy breach before ordinary grading.
8. **Decision.** Produce `manual_review`, `hold`, `conditional_hold`, `reduce`, `close`, or `replacement_candidate` and a target contract range.
9. **Timing.** Rebase the decision window from the assessment date.
10. **Persist.** Save the full point-in-time assessment and append an assessment lifecycle event when the assessment is new.

Version 1 never automatically recommends an add. A strong repeat hit can reinforce evidence, but it cannot increase the position.

### 5. How verdicts and target size are selected

- Broken/retired thesis or expiration leads to `close` with a zero target.
- A nonviable exact contract with an otherwise viable company thesis leads to `replacement_candidate`, also with a zero target in the current contract.
- Failed decision deadline, risk-budget breach, material portfolio-policy breach, or impaired thesis leads toward `reduce`.
- Missing blocking data or unverified company evidence leads to `manual_review`.
- Crowding, a behind/failed path, or a marginal contract leads to `conditional_hold` when no harder veto applies.
- A clean, supported setup leads to `hold`.
- `reduce` currently proposes roughly half the contracts, with a narrow one-contract range around the target. Hold decisions keep the current size.

These are shadow recommendations. They become the human record only through confirmation or override.

### 6. Confirming the grade

1. The user reviews the current assessment and presses **Confirm grade**.
2. The frontend submits a review linked to that assessment.
3. The automatic verdict, target, timing, evidence, and snapshots are copied into a new review row.
4. The decision source and no-override state are recorded.
5. A lifecycle event links the position, assessment, and review.
6. If the review confirms mandate content, a new mandate version is appended as appropriate.

Confirmation never sends an order. It records that the user accepted the shadow decision.

### 7. Overriding a decision

1. The user selects **Override decision**.
2. The decision form begins with assessment-derived defaults and current point-in-time snapshots.
3. The user may change verdict, target contracts, thesis state, continuation condition, timing, mandate context, and notes.
4. An override reason records why the human differed from the grader.
5. A new review and lifecycle event are appended.
6. Previous reviews remain available in the journal and on the timeline.

Context: disagreement is valuable training data. The system should learn whether the override was useful later, not pressure the user into agreeing now.

### 8. Revising the decision window

Window revision is narrower than a full decision override:

1. The active assessment or latest review provides the current decision context.
2. The system computes suggested future dates from the original scanner window and current decision.
3. The form can apply those dates, but never saves them automatically.
4. The user can adjust the next review and deadline, plus the reason/continuation condition.
5. Saving appends a new review that carries the current decision forward with new timing.
6. The earlier window remains in history and renders as an onion skin.

Validation prevents a next review after the decision deadline. For open hold/reduce/manual-review decisions, the suggested next review is future-facing. Close or expired decisions may legitimately terminate today without a future review.

### 9. How a revised window is calculated

The calculation has two stages.

**Initial scanner window**

- Starts from the scanner's base hold duration.
- Shortens the maximum when expiration would leave fewer than 14 calendar days.
- Estimates setup speed from IV/HV, expected daily range, trend strength, and IV percentile.
- Faster setups receive an earlier minimum review gate; slower setups receive more time.
- The result is an initial minimum/maximum number of trading sessions.

**Actionable decision window**

- Rebases from the current assessment date, not the original entry date.
- Never extends beyond the original maximum.
- Never extends past the expiry safety boundary.
- Shortens the maximum based on verdict: `manual_review` about 2 sessions, `reduce` about 3, and `conditional_hold` about 5, subject to tighter limits.
- Shortens further for critical/high urgency and nonviable/marginal contract status.
- Uses the earlier review as a process checkpoint and the deadline as the maximum recommended hold for that exact contract.

The deadline therefore means “do not continue this exact decision beyond here without a new decision,” not “the option expires here.”

### 10. Scheduled due-review processing

- At 10:20, 13:20, and 16:20 America/New_York on weekdays, the scheduler finds due assessments and refreshes them without creating orders.
- The scheduler starts before the potentially long startup ETL, so assessment schedules are registered promptly.
- PostgreSQL advisory locks prevent another scheduler process from performing the same job concurrently.

The page can still force a manual grade refresh for one selected position.

### 11. Scanner run and held-contract recurrence

When the scanner persists a hit:

1. The backend compares it with open positions in the same symbol entered before the hit.
2. It first tries exact contract identity: option type, expiration, and strike.
3. If no exact contract matches, it identifies the nearest same-symbol position and reports contract drift or missing contract-comparison fields.
4. For exact matches, it compares the current hit with the prior matching recurrence or original source event.
5. The comparison uses a base opportunity score that explicitly excludes the recurrence bonus, preventing a circular “repeat proves itself” result.
6. Material changes in score, IV/HV, IV percentile, EDR, trend, spread, and related fields are classified as favorable or unfavorable.
7. The result becomes one of `strengthened`, `still_qualifies`, `contradiction`, `contract_drift`, or `portfolio_conflict`.
8. A conflict is raised when the latest accepted review/assessment calls for a reduction or exit that conflicts with the repeated scanner interest.
9. A material exact-contract result sets `assessment_refresh_recommended=true`.
10. An idempotent `scanner_recurrence` lifecycle event is appended for the position and scanner event.

The recurrence process never mutates contracts, review dates, or deadlines. It never enables an automated add. An absent scanner repeat is also not treated as disconfirmation; the scanner is a sparse qualifying process, not continuous coverage.

### 12. Closing a position

1. The user supplies the exit price and close information.
2. The API computes proceeds and realized P/L and checks for a duplicate closed trade.
3. The open record is copied into closed history with source-position linkage.
4. A `closed` lifecycle event is appended.
5. The first actual-trade postmortem is classified immediately.
6. Any outstanding sell reminder is skipped because the position is no longer open.
7. The open position is removed only after the closed record and linked evidence are established in the transaction.

### 13. Closed-trade learning

The automatic postmortem asks more than “did it make money?” It separates financial outcome from process quality. For example, a sound thesis and disciplined exit can still lose money, while a profitable trade can still expose poor sizing or deadline discipline.

The classifier uses actual trade records and the latest relevant mandate/review to label the dimensions listed above. If the user corrects a label, the feedback endpoint creates a new outcome version. This preserves both the model's original classification and the human correction.

### 14. Decision-horizon learning

Every recorded review declares evaluation horizons before outcomes are known:

- 1 trading session;
- 3 trading sessions;
- 5 trading sessions;
- 10 trading sessions;
- the decision deadline when present;
- expiration when distinct.

At 18:10 America/New_York on weekdays, the learning job:

1. finds newly closed trades without a current postmortem and classifies them;
2. finds decision horizons whose target date has matured;
3. records available underlying and option outcomes using the declared valuation method;
4. marks data limitations rather than manufacturing an option mark;
5. updates the learning summary without changing the live champion.

Decision outcomes and actual trade outcomes stay in separate tables and serve different questions.

## Learning without overfitting

The current deterministic grader is the champion. A learned challenger is not eligible until at least 100 independent classified actual closes exist. This is a governance floor, not proof that a model is good.

Any future challenger must use:

- point-in-time features only;
- chronological train, calibration, and test periods;
- trade-level grouping so multiple horizons from one trade cannot leak across splits;
- actual closes for actual-trade labels;
- simple baselines before flexible models;
- calibration, regime stability, turnover, and decision value in addition to raw accuracy;
- at least 25 new independent trade cycles before another retraining attempt;
- frozen feature schema, code commit, training range, and evaluation report;
- explicit manual promotion and a rollback path;
- multiple-testing and backtest-overfitting controls when many variants are tried.

No model can promote itself, edit risk policy, approve thresholds, or enable order execution.

## Timeline and visual behavior

The current visual hierarchy is intentionally compact:

- the full rail is the contract life;
- the filled interval is the active maximum-hold window;
- compact bracket ends define the active interval without overpowering it;
- a thin amber line marks the next review checkpoint;
- the capped white I-shaped marker identifies today;
- translucent onion skins show every older decision window without requiring hover;
- interaction increases bracket/history emphasis without changing the underlying information;
- each row owns its refresh-status bar: amber while pending, green briefly when settled.

The expanded row and right-hand cockpit contain the details. The list rail is for immediate timing and history, not for reproducing every assessment input.

## API surface added or materially changed

The main workflows are exposed through:

- `GET /secret/options/positions` and `GET ...?refresh=true`;
- `GET /secret/options/decision-review-windows`;
- `GET|POST /secret/options/positions/{id}/thesis-assessment`;
- `POST /secret/options/thesis-assessments/refresh-due`;
- `GET|POST /secret/options/positions/{id}/decision-reviews`;
- `GET|POST /secret/options/positions/{id}/lifecycle-events`;
- `GET|POST /secret/options/risk-policy`;
- `GET /secret/options/learning-summary`;
- `POST /secret/options/learning-outcomes/backfill`;
- `GET /secret/options/closed-positions/{id}/learning`;
- `POST /secret/options/closed-positions/{id}/learning-feedback`;
- scanner summary/run/detail endpoints with held-position match evidence.

Read endpoints do not submit orders. Scanner summary/detail reads are also read-only; recurrence lifecycle writes occur when scanner events are persisted or explicitly backfilled for a run.

## Database migrations

Today's decision stack is represented by three main migrations after the earlier review-window foundation:

- `20260715_0013`: append-only position reviews;
- `20260715_0014`: mandates, assessments, lifecycle events, decision outcomes, trade outcomes, risk policies, and model registry;
- `20260715_0015`: scanner recurrence linkage and idempotency support.

The production database was advanced through `20260715_0015` during today's deployments.

## Current live proof from today

A production scanner run exercised the repeat-evidence path:

- **GIS:** exact held contract, 10 contracts, third recurrence, classified as a contradiction with base-score delta of approximately -8.53; assessment refresh recommended.
- **SJM:** exact held contract, 5 contracts, second recurrence, classified as strengthened with base-score delta of approximately +21.65; assessment refresh recommended.

The reads were fast in the live check, and the position records remained unchanged. That is the intended behavior: the scanner adds evidence and flags a review, but does not trade or move decision dates.

## Important limits and deliberate manual gates

- The grader uses available cached fundamentals, technicals, quotes, and stored context; it is not omniscient and will expose missing inputs.
- Reconstructed mandates are drafts until confirmed.
- New thresholds are drafts until explicitly approved.
- Risk-policy hard limits only apply when the policy is active and approved.
- A scanner recurrence recommends an assessment refresh but does not currently queue a full synchronous grade inside the scanner write path. This avoids slowing persistence and Discord output.
- Historical scanner recurrence is not blindly backfilled from future-known information. Going-forward event capture is safer against temporal leakage.
- Option outcome marks may be unavailable at a matured horizon; the system records the limitation and valuation method.
- Portfolio concentration is based on tracked option premium and is only as complete as the tracked book.
- Brokerage reconciliation, live Greeks, and two-sided quote quality still determine how decision-grade an assessment can be.
- No automated order execution exists.

## What to watch next

1. **Assessment refresh queue:** turn `assessment_refresh_recommended` into a small asynchronous queue with deduplication and visible completion state.
2. **Broker reconciliation:** link partial fills and broker lots so remaining capital and exposure reflect the executable book exactly.
3. **Point-in-time event data:** snapshot earnings/calendar context at each assessment rather than relying on later reconstruction.
4. **Portfolio risk units:** add delta-dollar, theta-dollar, vega, expiry, direction, sector, and shared-catalyst aggregation when live inputs are reliable.
5. **Closed-trade review UI:** make human corrections and lesson review easier without weakening version history.
6. **Per-row refresh precision:** if the backend later refreshes positions independently, return per-position refresh timestamps/status so row bars can represent true individual completion rather than shared batch state.
7. **Learning governance:** keep the challenger dormant until sample, leakage, calibration, regime, and manual-promotion gates are met.

## Practical bedtime checklist

When reviewing the system tomorrow, verify these behaviors first:

1. Press **Refresh list** and confirm the pending/settled bar appears on each visible position row, not on the outer card.
2. Select a position and verify the cockpit separates confirm, override, revise window, and refresh grade.
3. Revise one window and confirm the new next review is future-facing, the deadline is the maximum recommended hold, and the prior window remains visible as an onion skin.
4. Confirm an assessment and verify a new journal entry appears without erasing the prior review.
5. Open a scanner hit that matches a held contract and inspect match type, recurrence, deltas, current decision conflict, and refresh recommendation.
6. Confirm that none of these actions submitted or staged an order.

## Bottom line

The system now has the basic architecture required to improve responsibly: immutable inputs, append-only decisions, explicit human overrides, actual-versus-counterfactual outcome separation, controlled automation, and conservative model-governance gates. The next gains should come from cleaner broker/event data and repeated independent decision cycles, not from adding model complexity early.
