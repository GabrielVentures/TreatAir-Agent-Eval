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

The following no-reasoning API trials used the same runway-change scenario and the repaired observation and action layer. The sample is intentionally small and is evidence of behavior, not a statistical model comparison.

| Model | Trials | Completed | Landed | Excursions | Decision-limit failures | Crashes |
|---|---:|---:|---:|---:|---:|---:|
| GPT-5.6 Luna | 5 | 1 | 2 | 1 | 3 | 0 |
| GPT-5.6 Sol | 1 replacement trial | 1 | 1 | 0 | 0 | 0 |

The successful Sol trial used 43 decisions and 27 non-observe actions. It landed on 28L, stopped inside the runway boundary, and had native ROLLOUT active at touchdown. Touchdown vertical speed was approximately -192 ft/min and fuel use was approximately 313 kg.

The successful Luna trial used 54 decisions and 40 non-observe actions. It also completed the mission with native ROLLOUT active. Touchdown vertical speed was approximately -254 ft/min and fuel use was approximately 373 kg.

One Luna run touched down on 28L but later crossed the runway boundary during rollout. Three Luna runs reached the decision limit without touching down. The dominant failure pattern was energy and recovery management: the model sometimes remained too high or too fast near the threshold, then failed to construct an efficient go-around and re-intercept before exhausting its decision budget.

The complete sanitized result objects are in [examples](../examples). The raw traces used to produce them remain local in the development workspace and are not required for a reviewer to understand the result.

## Interpretation

The experiment demonstrates that the environment is solvable and that models differ in reliability under the same tool boundary. It also shows why deployment evaluation needs more than a final success flag. A landing can be smooth but still fail because rollout leaves the runway. A tool call can be accepted while the aircraft remains in the wrong mode. The telemetry and action log expose those distinctions.

## Earlier observations

The initial direct-control experiments showed that a language model should not be responsible for sub-second joystick corrections. Subsequent failures exposed ambiguous A330 commands, stale or incoherent saved aircraft state, and insufficient runway geometry. The implementation was changed in response to those traces: native approach initialization, typed actions, post-action verification, explicit threshold geometry, dual-channel autoland states, and contact-footprint scoring.

## Reproducibility limits

This is a local simulator proof of concept. The sample is small, X-Plane is not run in parallel, and simulator timing and model latency affect the trajectory. Native ATC OCR and native runway-incursion delivery are not part of the demonstrated benchmark. The next experiments should repeat the scenario with seeded event timing and held-out wind conditions.
