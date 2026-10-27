# Learning methodology

Pipeline: Evidence -> Candidate -> Validation -> Challenger -> Champion.

## Evidence eligibility

A sample is excluded if integrity failed, formula/model version is unknown or not the current formula contract, entry price is invalid, realized outcome is missing, timestamps are out of order, future information is present, or the decision violates the fixed >21% current/daily extreme-move exclusion. Pre-extreme21 evidence remains auditable but cannot calibrate or train the current model.

## Deterministic learner

`DeterministicWeightLearner` uses only outcomes realized by the supplied as-of time. It computes bounded utility evidence per K1-K7, shrinks adaptation toward base weights, applies floor/ceiling constraints and renormalizes to one.

The learner cannot promote a model.

## Validation

Promotion policy requires minimum samples and regime diversity, positive net economic utility, bounded drawdown and minimum stability. Weight floors/ceilings prevent criterion deletion or domination.

Walk-forward folds are time ordered: train < validation < test. Production formula/selection code is reused in backtest.

## Promotion and rollback

Room stores candidate weights, validation metrics, parent version and reason. Champion transition and audit event are one transaction. Rollback is explicit and audited.
