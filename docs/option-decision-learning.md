# Option decision and learning system

## Purpose

This subsystem answers a capital-allocation question, not a break-even question:

> Knowing what is observable now, would this exact contract at this size still be a good use of the remaining capital?

It is decision support. It does not create, stage, route, or execute orders.

## What is live in version 1

### Append-only evidence and decisions

- Every new tracked position receives a reconstructed entry mandate. The mandate records its source and labels generated thresholds as drafts.
- A user confirmation creates a new mandate version. It never edits the reconstructed record.
- Every automatic assessment stores its input hash, point-in-time feature snapshot, grader version, evidence, missing inputs, vetoes, and proposed action.
- Every user review references the selected automatic assessment and records whether the user confirmed or overrode the verdict, size, or mandate.
- Position opens, edits, adds/reductions, assessments, reviews, and closes are written to a lifecycle ledger.
- Closing a tracked position creates a versioned postmortem; human corrections create another version.

### Decision hierarchy

The deterministic grader applies these layers in order:

1. Reconcile the position, quote, time remaining, mandate, and risk policy.
2. Grade the company thesis from human-confirmed evidence or current cached fundamentals. Price action is never treated as business-thesis proof.
3. Grade path/timing and the exact contract separately.
4. Check current tracked-option concentration and any approved risk-policy limits.
5. Apply hard vetoes before ordinary quality logic.
6. Propose a target contract count and one of: manual review, hold, conditional hold, reduce, close, or close-and-evaluate-replacement.

The grader deliberately never proposes an add in version 1. Addition eligibility requires a confirmed mandate, current two-sided quote, approved risk policy and portfolio capital, strengthening evidence, and a separately tested sizing policy.

### Scanner replacement classification

When the scanner selects a different contract for a symbol already held, `replacement_rules_v1` evaluates the new contract as a separate capital-allocation decision. It first identifies the structure—up and out, down and out, straight out, same-expiry strike switch, shorter-dated switch, or direction change—and then applies five gates:

1. At least 14 additional calendar days for an ordinary roll-out comparison.
2. A fresh-entry score of at least 50 and, for an ordinary roll candidate, at least 10 points of improvement over the held contract.
3. At least two independent post-entry scanner occurrences.
4. Candidate and held-leg spreads no wider than 25% when those snapshots are available.
5. Explicit convexity-harvest inputs when a profitable position is moved to a more demanding strike.

The resulting classes are deliberately distinct:

- `convexity_harvest_candidate`: a profitable position may fund a smaller up-and-out replacement while retaining convex upside;
- `roll_out_candidate`: a later contract materially improves the fresh-entry case without increasing the directional hurdle;
- `watch_replacement`: the structure is plausible but one or more material gates remain incomplete;
- `rescue_roll_rejected`: a losing contract would be given a harder strike merely by purchasing more time;
- direction change, shorter-dated switch, execution rejection, portfolio-reduction conflict, or no replacement.

Every result remains shadow decision support. It is never marked implementation-ready because the stored scanner event is not a live executable two-leg quote and does not contain the complete candidate Greeks. A qualified replacement must close and journal the held contract first; the replacement becomes a new position with its own mandate, size, review window, and decision deadline.

### Closed-trade learning

Actual trade outcomes are classified separately from profit and loss:

- thesis selection;
- timing;
- contract selection;
- sizing;
- portfolio concentration;
- entry execution;
- exit discipline and review discipline;
- catalyst/event result;
- sound process with an unfavorable financial outcome.

Scanner recurrence events also preserve the replacement recommendation that was visible at the time. Closed-trade summaries compare `no_replacement_signal`, `replacement_watch_seen`, `rescue_roll_rejected_seen`, `roll_candidate_seen`, and `convexity_harvest_seen` cohorts. The bounded canary can inspect a cohort after eight actual closes, but only when another cohort in the same family independently clears the same floor.

Each recorded review is also evaluated at pre-declared 1, 3, 5, and 10-session horizons, the decision deadline, and expiration. These counterfactual decision outcomes remain explicitly separate from actual fills and actual trade labels.

### Outcome-learning bounded canary

`option_learning_influence_canary_v3` evaluates every ranked scanner opportunity beside the deterministic champion. When all experimental gates pass, it can apply an evidence-scaled learning weight of no more than 10% to the displayed score and ordering. Version 3 raises the bounded ceiling from 5% to 10%; it does not change the evidence gates, hard vetoes, sizing authority, or full-promotion requirements. Existing version 2 point-in-time receipts remain immutable and capped at their original 5%; only newly captured version 3 receipts can use the 10% ceiling. The API and expanded scanner row expose:

- the champion score and rank;
- the eligible outcome cohort for scanner recurrence, replacement classification, point-in-time Market Field, contract direction, and entry-DTE bucket;
- a shrunk descriptive score when the candidate cohort and at least one comparison cohort each contain eight actual closes;
- the counterfactual score, weight, and rank that would result from a bounded blend;
- the score, weight, and rank actually applied;
- each family's additive score contribution and marginal applied-rank effect;
- the current Market Field snapshot's 0% direct weight separately from historical
  Market Field cohort evidence inside the total canary;
- every failed evidence and promotion gate.

The canonical `nominal_weight_cap` travels with the policy and each immutable event receipt. The older `actual_rank_influence`, `maximum_counterfactual_weight`, and `maximum_applied_weight` fields remain compatibility aliases; they describe the ceiling, not the evidence-scaled weight actually applied to a particular event. `observed_max_applied_weight` and `observed_mean_applied_weight` summarize effective row-level influence in the returned candidate set.

The cohort score combines 70% posterior profitable rate and 30% percent-P/L context. The profitable rate is shrunk toward the eligible family-wide rate with 20 pseudo-observations. Median P/L is used when retained by the cohort builder; legacy families fall back to average P/L. The selected statistic is clipped to -20% through +20% before mapping to a zero-to-100 descriptive scale. This construction is intentionally simple and auditable; it is a challenger diagnostic, not a claim of calibrated expected value.

The applied weight cannot exceed 10%. It is attenuated by the fraction of the 40-cycle canary floor reached, the share of closed trades not labeled `weak_process` relative to a 10% floor, and cohort reliability up to 50 observations. The canary requires all of the following:

1. At least 40 classified actual-close cycles. The grouping reduces repeated
   horizon leakage but is not a statistical independence test.
2. At least 10% of those cycles classified above `weak_process`.
3. At least one candidate learning family with two cohorts of at least eight actual closes each.
4. Explicit operator authorization through
   `OPTION_LEARNING_CANARY_ENABLED=true`. The setting defaults to false and its
   value is frozen into each point-in-time receipt.

The 10% policy cap cannot change automatically. Once authorized, each event's
actual weight still scales deterministically from zero to that cap as its
frozen cycle, process-quality, cohort, and reliability evidence permits. The
legacy `automatic_weight_changes=false` field refers to policy/cap changes,
not to this disclosed evidence scaling; current receipts expose both concepts
separately.

The canary never changes hard vetoes, position sizing, risk policy, review verdicts, or execution authority. It only leans scanner score and ordering. Full challenger promotion still requires the 100-cycle governance floor, chronological evaluation, and a separate manual decision. Event receipts durably retain the point-in-time evidence, cohort identities, scores, operator-authorization state, and applied weight.

When normal finalization succeeds for a completed, stopped, or errored scanner
run, an append-only rank snapshot freezes the exact candidate set, display
ordinal, champion/counterfactual/applied scores and ranks, applied weight,
versions, and canonical payload hash. A GET request never manufactures a
historical snapshot; stale runs, terminal runs that predate the schema, and
failed finalizations remain explicitly unsnapshotted. Authenticated
ranking-rendered, candidate-visible, and detail-open browser impressions
reference the frozen snapshot and use idempotent client event IDs plus a
server-hashed page-session identifier. These records establish prospective
exposure evidence from the deployment boundary forward; they cannot prove who
saw older rankings.

Each newly created scanner event stores an immutable canary receipt containing the learning version, eligible cohort identities, cohort evidence, applied weight, and capture time. Scanner pages may rebase that frozen learning component onto the current deterministic recurrence score, but they may not recompute historical cohort membership or weight. Events created before the receipt schema remain shadow-only and can never receive retroactive live influence.

The legacy event-receipt field `rank_snapshot_persisted=false` describes only
the event-capture moment, before its run can be terminal. Current receipts add
`rank_snapshot_state_at_event_capture=not_yet_terminal`; the later run-level
rank snapshot is a separate immutable record and does not rewrite the event.

## Automation schedule

- Due open-position assessments: weekdays at 10:20, 13:20, and 16:20 America/New_York.
- Closed-trade classification and matured decision horizons: weekdays at 18:10 America/New_York.
- PostgreSQL advisory locks prevent duplicate work when more than one scheduler process is present.

## Learning roadmap and anti-overfit gates

The deterministic rules remain the champion while the system collects classified actual-close trade cycles. A learned model is a challenger only after at least 100 classified actual closes. That threshold is a governance floor, not evidence that a model is automatically good or that the observations are statistically independent.

Challenger development must use:

- point-in-time features only, with no revised or post-decision data;
- chronological train/calibration/test splits;
- grouping all rows from the same trade into one split to prevent horizon leakage;
- actual trade outcomes for actual-trade labels, never synthetic option marks mixed into them;
- simple baselines before flexible models;
- calibration, stability by market regime, turnover, and decision-value metrics in addition to accuracy;
- a minimum of 25 new classified actual-close trade cycles before another retraining attempt;
- frozen feature schema, code commit, training range, and evaluation report per challenger;
- manual champion promotion and an immediate rollback path.

Repeated experimentation must be tracked as multiple testing. Promotion should consider the probability of backtest overfitting and a deflated Sharpe-style correction where return-based comparisons are used. No model may promote itself, change risk policy, or enable order execution.

## Known limits and next data priorities

Version 1 is intentionally conservative when evidence is absent. It returns `unverified` or `manual_review` instead of inventing a thesis.

The highest-value data improvements are:

1. Broker-lot reconciliation and verified partial-fill linkage.
2. A current option-mark table for portfolio-wide remaining-capital and Greeks aggregation.
3. Earnings/event-calendar snapshots captured at each decision time.
4. Sector, factor, strategy, and shared-catalyst concentration features.
5. Entry bid/ask and execution-quality snapshots for all trades.
6. Human feedback controls for correcting postmortem classifications in the UI.

Until these are present, missing fields remain visible confidence limits and block addition eligibility.

## Research references

- Bailey et al., *The Probability of Backtest Overfitting*: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253
- Bailey and Lopez de Prado, *The Deflated Sharpe Ratio*: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551
- Harvey, Liu, and Zhu, *... and the Cross-Section of Expected Returns*: https://www.nber.org/papers/w20592
