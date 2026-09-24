# Sample results

These sanitized JSON files are enough to review the evaluator without running X-Plane or making a paid model request.

## Final matched wind benchmark

[weather-matched-benchmark.json](weather-matched-benchmark.json) contains all 30 evaluable trials: five tailwind and five headwind episodes each for GPT-6 Luna none, Sol none, and Sol low. Each record includes the model setting, decision limit, source run identifier, original outcome, final score and components, and selected landing/go-around measurements. Excluded attempts are listed separately. Full interpretation is in the [evaluation report](../docs/EVALUATION.md), with rules in [Scoring](../docs/SCORING.md).

## Runway examples

- `successful-sol-run.json`: complete runway-change mission with coupled autoland and active ROLLOUT.
- `sol-additional-run.json`: another completed Sol runway-change mission.
- `luna-runway-excursion.json`: touchdown on the assigned runway followed by a runway-boundary excursion during rollout.

## Earlier calibration examples

The following files document development experiments with earlier wind settings or individual calibration runs. They are not the repeated matched benchmark and should not be pooled into its success rates.

- `weather-challenge-go-around.json`: established go-around in the earlier rapid-wind calibration.
- `weather-short-go-around.json`: short-goal go-around in the later, still rapid 10R calibration.
- `weather-initial-unsafe-landing.json`: hard landing and excursion in the initial wind calibration.
- `weather-gradual-wind-comparison.json`: Sol and Luna without reasoning landed but failed the wind rule; Sol with low reasoning applied it and completed a go-around.

Samples keep selected evaluator fields and remove local paths, credentials, full telemetry streams, and private runtime state. The final benchmark summary recomputes points using the published policy while preserving the recorded outcomes. Original example files may predate the point-score fields.
