# Evaluation report

## Task

Start an Airbus A330 on approach to KPDX runway 28R. During the approach, deliver a hidden instruction that runway 28R is unavailable and the aircraft is cleared to land on runway 28L. The initial model instruction remains simply: `Land the aircraft at KPDX.`

The agent is evaluated on adaptation and execution, not on manually moving the aircraft's control surfaces. The same simulator action layer and evaluator are used across models.

## Success criteria

The mission is complete when the aircraft:

- touches down on the assigned runway;
- keeps the complete landing-gear contact footprint inside the runway bounds;
- stops on that runway;
- does not crash or trigger a critical failure.

The evaluator also records fuel use, touchdown vertical speed, lateral and longitudinal position, warning samples, cross-track error, event response time, model decisions, and action count.

## Recent benchmark

The following no-reasoning API trials used the same runway-change task. The accepted set retains three earlier successful Sol trials, a successful replacement after repairs, and an additional trial on September 23. Luna's five included trials used the repaired observation and action layer. This development series spans environment changes and is not a fixed-version statistical comparison.

| Model | Trials | Completed | Landed | Excursions | Decision-limit failures | Crashes |
|---|---:|---:|---:|---:|---:|---:|
| GPT-5.6 Luna | 5 | 1 | 2 | 1 | 3 | 0 |
| GPT-5.6 Sol | 5 included trials | 5 | 5 | 0 | 0 | 0 |

### Sol run accounting

All run IDs use UTC timestamps.

| Run ID | Outcome | Decisions | Included |
|---|---|---:|---|
| `2026-09-22T03-41-10-816Z` | Mission completed | 66 | Yes, retained earlier success |
| `2026-09-22T03-46-53-634Z` | Mission completed | 53 | Yes, retained earlier success |
| `2026-09-22T03-51-48-468Z` | Decision limit, no touchdown | 80 | No, excluded and replaced during development |
| `2026-09-22T03-58-44-111Z` | Mission completed | 54 | Yes, retained earlier success |
| `2026-09-22T06-10-46-016Z` | Mission completed | 43 | Yes, replacement after repairs |
| `2026-09-23T04-38-03-560Z` | Mission completed | 34 | Yes, additional trial |

There are **five accepted successes and six recorded Sol attempts overall: five completions and one decision-limit failure**. The exclusion follows the development decision to repair the environment and replace that attempt; its recorded outcome remains disclosed. Retaining successes across revisions while replacing a failure introduces selection bias, so the included 5/5 is not an unbiased reliability estimate. The first retained success recorded no active native ROLLOUT at touchdown despite satisfying the mission-completion evaluator.

The September 23 trial used the direct API, no reasoning, and a 50-decision limit. It completed in approximately 190 seconds, with 34 decisions and 21 non-observe actions, approximately 238 kg fuel consumed, and touchdown vertical speed of approximately -272 ft/min. It landed and stopped on 28L with native ROLLOUT active, no excursion, and no crash. Flight telemetry and model-action logs were preserved locally; a sanitized result is included in the examples. These outcome criteria do not establish compliance with every real-world approach or landing procedure.

The September 22 replacement Sol trial used 43 decisions and 27 non-observe actions. It landed on 28L, stopped inside the runway boundary, and had native ROLLOUT active at touchdown. Touchdown vertical speed was approximately -192 ft/min and fuel use was approximately 313 kg.

The successful Luna trial used 54 decisions and 40 non-observe actions. It also completed the mission with native ROLLOUT active. Touchdown vertical speed was approximately -254 ft/min and fuel use was approximately 373 kg.

One Luna run touched down on 28L but later crossed the runway boundary during rollout. Three Luna runs reached the decision limit without touching down. The dominant failure pattern was energy and recovery management: the model sometimes remained too high or too fast near the threshold, then failed to construct an efficient go-around and re-intercept before exhausting its decision budget.

The complete sanitized result objects are in [examples](../examples). The raw traces used to produce them remain local in the development workspace and are not required for a reviewer to understand the result.

## Interpretation

The experiment demonstrates that the environment is solvable and that models differ in reliability under the same tool boundary. It also shows why deployment evaluation needs more than a final success flag. A landing can be smooth but still fail because rollout leaves the runway. A tool call can be accepted while the aircraft remains in the wrong mode. The telemetry and action log expose those distinctions.

## Earlier observations

The initial direct-control experiments showed that a language model should not be responsible for sub-second joystick corrections. Subsequent failures exposed ambiguous A330 commands, stale or incoherent saved aircraft state, and insufficient runway geometry. The implementation was changed in response to those traces: native approach initialization, typed actions, post-action verification, explicit threshold geometry, dual-channel autoland states, and contact-footprint scoring.

## Reproducibility limits

This is a local simulator proof of concept. The sample is small, X-Plane is not run in parallel, and simulator timing and model latency affect the trajectory. Native ATC OCR and native runway-incursion delivery are not part of the demonstrated benchmark. The next experiments should repeat the scenario with seeded event timing and held-out wind conditions.
