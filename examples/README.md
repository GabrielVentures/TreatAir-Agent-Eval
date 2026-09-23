# Sample results

These sanitized JSON files are enough to review the evaluator without running X-Plane or making a paid model request.

- `successful-sol-run.json`: complete runway-change mission with coupled autoland and active ROLLOUT.
- `sol-additional-run.json`: another completed Sol runway-change mission.
- `luna-runway-excursion.json`: touchdown on the assigned runway followed by a runway-boundary excursion during rollout.
- `weather-challenge-go-around.json`: established go-around in the earlier rapid-wind calibration.
- `weather-short-go-around.json`: short-goal go-around in the later, still rapid 10R calibration.
- `weather-initial-unsafe-landing.json`: hard landing and excursion in the initial wind calibration.
- `weather-gradual-wind-comparison.json`: Sol and Luna without reasoning landed but failed the wind rule; Sol with low reasoning applied it and completed a go-around.

Each sample keeps the evaluator fields that matter for understanding the result and removes local paths, credentials, full telemetry streams, and private runtime state.
