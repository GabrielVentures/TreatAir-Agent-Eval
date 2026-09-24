# Evaluation report

## Introduction

An agent can understand a new instruction yet fail to carry it out. Flight simulation makes that gap observable: decisions about navigation, speed, configuration, and changing conditions have measurable consequences while the environment keeps moving.

We built two experiments around an Airbus A330 approaching Portland International Airport (KPDX). Experiment A tests a runway reassignment. Experiment B tests whether the agent responds appropriately to equally strong winds from different directions. Together, they examine instruction following, situational judgment, and execution through tools.

The agent's mission is always `Land the aircraft at KPDX.` It receives telemetry, navigation information, communications, cockpit tools, and reusable aircraft guidance. It chooses targets and automation modes; the aircraft's autopilot handles continuous flight control. A separate controller introduces the event without revealing its schedule or expected response. The agent cannot pause time, alter weather, teleport, or remove the event.

Evaluation uses recorded aircraft state and action logs. Each run retains its original pass/fail outcome and receives a retrospective score out of 100: decision 40, timing 20, execution 25, and quality 15. Safety caps prevent good intermediate decisions from outweighing a crash or runway excursion. The [scoring rules](SCORING.md) define the thresholds. These prototype points describe partial achievement, not a probability of safe flight.

## Experiment A: runway reassignment

### Setup

The aircraft begins on approach to runway 28R. During the approach, a controlled simulated clearance announces that 28R is unavailable and assigns 28L. The agent must acknowledge the message, update navigation, and manage the revised approach. Native tower communications are not used in this benchmark.

We evaluated five selected runs each for GPT-5.6 Sol and GPT-5.6 Luna, using the direct API with reasoning set to `none`. This provided a low-latency baseline for a task where the required change is explicit. The question was whether each model could execute it reliably while the simulator continued in real time.

A completed mission requires touchdown on the assigned runway, containment of the full landing-gear footprint during rollout, and a stop on that runway without a crash. Telemetry also records fuel consumption, touchdown vertical speed, response timing, and control actions.

### Results

| Model | Full passes | Scores for runs 1–5 | Mean score |
|---|---:|---|---:|
| GPT-5.6 Sol, none | 5/5 | 100, 100, 100, 100, 100 | 100/100 |
| GPT-5.6 Luna, none | 1/5 | 60, 25, 55, 100, 60 | 60/100 |

| Run | Sol outcome | Luna outcome |
|---:|---|---|
| 1 | Landed and stopped | Decision limit before touchdown |
| 2 | Landed and stopped | Landed, then left the runway |
| 3 | Landed and stopped | Decision limit before touchdown |
| 4 | Landed and stopped | Landed and stopped |
| 5 | Landed and stopped | Decision limit before touchdown |

All ten runs acknowledged the clearance and retuned to 28L. In one successful Sol example, the flight used 34 decisions and approximately 238 kg of fuel, with a touchdown descent rate of 272 ft/min. The successful Luna run used 54 decisions and approximately 373 kg, with a touchdown descent rate of 254 ft/min. These are individual examples, not cohort averages.

### Discussion

The difference appeared primarily in execution after the runway change. Luna often recognized what to do but struggled with speed, altitude, and returning to a viable approach. Three runs exhausted their decision budgets before touchdown, while another landed but left the runway during rollout.

Partial scores preserve that distinction. Luna's incomplete approaches received credit for acknowledging and implementing the navigation change. Its runway excursion capped the total at 25 despite a relatively smooth touchdown. Sol completed this selected sample consistently, although five runs cannot establish a dependable success rate.

## Experiment B: wind-dependent landing decisions

### Setup: why two separate episodes

Our first design was one continuous flight: reject an unsafe landing, fly a full go-around circuit, and return for another attempt once the wind direction became favorable. A go-around means abandoning the current approach and climbing away from the runway.

That complete sequence proved too difficult to make reliable within the project's schedule. One run established a climb but then stalled during a climbing turn after retracting flaps while actual speed was decreasing. An approximate replay without model inference reproduced the deterioration, supporting a command-sequencing problem. Recovery also exposed an incomplete control interface: the model could not adequately inspect or disengage a retained thrust state. We added engine-output observations and a verified autothrust-disconnect control.

A subsequent Sol low-reasoning retry still failed to return and land. Its median inference latency was about four seconds, but two responses during recovery took approximately 92 seconds each. The evidence points to a combination of aircraft handling, recovery complexity, and latency, with a verified control limitation contributing before the repair. It does not establish that the full task is impossible. The [recovery diagnostic](THRUST-RECOVERY-DIAGNOSTIC.md) documents these tests.

To leave enough time and budget for repeated evaluation, we split the task into two independent episodes. B1 tests rejecting a landing in excessive tailwind. B2 tests completing a landing in favorable wind of the same strength. Each starts from the same approach with a fresh model session. This retains the wind-direction decision while removing the long return circuit from the benchmark.

### Shared setup and model selection

Both episodes use runway 10R, whose installed navigation data supports the A330's dual-channel instrument landing setup. Earlier calibration exposed automation issues, including inconsistent navigation courses between the two pilot stations. The setup now synchronizes them. We also moved the wind change earlier and made it gradual; a control test kept both autopilots and approach guidance engaged through that change.

The aircraft starts with an 8 kt headwind. At 5.5 nautical miles from the runway, the controller changes wind over 25 simulation seconds. It verifies the measured wind at the aircraft and sends an ordinary direction-and-speed report, without telling the model whether to land or go around.

We first tested GPT-6 Luna and Sol with reasoning set to `none` to limit response latency and cost. We then added Sol `low` after an exploratory run showed it explicitly applying the tailwind constraint. This tests whether additional reasoning helps under the same real-time conditions, while acknowledging that more reasoning can also delay action.

| Model and reasoning | B1 decision limit | B2 decision limit | Evaluable runs per episode |
|---|---:|---:|---:|
| GPT-6 Luna, none | 80 | 80 | 5 |
| GPT-6 Sol, none | 40 | 50 | 5 |
| GPT-6 Sol, low | 40 | 50 | 5 |

Luna was given a larger decision budget to accommodate its cheaper calls. Sol's reasoning comparison uses matching limits within each episode. These are budget-constrained experiments, not a comparison at equal numbers of decisions across all models. The scored episodes use the same generic mission, aircraft reference, and cockpit tools. A preflight step obtains the first model response while paused; evaluation then runs in real time.

### B1 setup: excessive tailwind

The wind becomes 25 kt from approximately 324° true. Relative to runway 10R, this produces about 22.7 kt of tailwind and 10.6 kt of crosswind. The shared operating policy sets a 15 kt tailwind threshold for this prototype; this is not presented as a certified A330 limit.

The required outcome is a go-around before ground contact followed by a verified sustained climb. The episode ends at that checkpoint. Selecting a thrust mode without actually climbing does not complete the task.

### B1 results

| Model and reasoning | Full passes | Scores for runs 1–5 | Mean score |
|---|---:|---|---:|
| GPT-6 Luna, none | 4/5 | 95, 100, 0, 85, 100 | 76/100 |
| GPT-6 Sol, none | 0/5 | 0, 0, 0, 0, 0 | 0/100 |
| GPT-6 Sol, low | 2/5 | 80, 0, 0, 25, 100 | 41/100 |

Luna completed four go-arounds and landed in excessive tailwind once. Sol without reasoning continued to touchdown in all five trials; three stopped on the runway and two reached the decision limit after touchdown. None completed the required go-around.

Sol with low reasoning completed two go-arounds, made one unsafe landing, crashed once, and reached the decision limit once after a late go-around and subsequent hard touchdown. Its first successful go-around began around 84 ft above ground and descended to approximately 49 ft before climbing. That run earned 80 points, including zero timing points. Its other successful go-around began around 1,159 ft and earned 100.

### B1 discussion

Luna had the strongest completion result in this sample, but its action explanations cited an unstable approach or uncaptured glidepath in all four successful go-arounds. The physical outcome was appropriate; those explanations do not establish that it calculated the tailwind component correctly. This is a limitation of using the resulting maneuver as a proxy for wind judgment.

Sol without reasoning maintained enough control to land, but did not reject the excessive tailwind. Adding low reasoning produced two completed go-arounds, yet the sample remained inconsistent and included a very late response. The result supports further testing of reasoning settings, not a general claim that more reasoning reliably solves the task.

### B2 setup: favorable wind at the same speed

The wind becomes 25 kt from approximately 144° true: about 22.7 kt of headwind and 10.6 kt of crosswind. The speed matches B1, but the direction reverses the along-runway component.

The required outcome is a stable approach, landing, and stop within runway 10R. The evaluator checks approach state at 1,000 and 500 ft, touchdown quality, and runway containment. A go-around remains a reasonable response to an approach that has become unstable, but does not by itself complete this landing task.

### B2 results

| Model and reasoning | Full passes | Scores for runs 1–5 | Mean score |
|---|---:|---|---:|
| GPT-6 Luna, none | 0/5 | 0, 50, 25, 0, 0 | 15/100 |
| GPT-6 Sol, none | 1/5 | 75, 25, 75, 50, 97 | 64.4/100 |
| GPT-6 Sol, low | 2/5 | 75, 50, 97, 50, 97 | 73.8/100 |

Luna recorded one crash, one landing and stop with a hard touchdown, one runway excursion, and two decision-limit failures without touchdown.

Sol without reasoning landed and stopped on the runway four times; one of those passed the full landing-quality checks. Its other run left the runway. Sol with low reasoning landed and stopped on the runway in all five trials, with two passing the full checks. Its touchdown descent rates were approximately 622, 1,206, 462, 1,004, and 436 ft/min.

### B2 discussion

Sol's headwind results show why landing completion and landing quality need separate measurements. The low-reasoning model completed the physical landing every time, but three touchdowns exceeded the quality threshold. Its higher average score reflects useful task completion with uneven landing quality.

The current traces do not isolate whether the hard touchdowns came from model configuration choices, the installed A330 automation, or landing support. They therefore describe performance of the complete agent-and-simulator system. Luna's strong B1 result also did not transfer to B2: successfully abandoning an approach and successfully completing one require different execution skills.

## Conclusion

The two experiments expose distinct failure modes. Runway reassignment showed that an agent can acknowledge and configure a new instruction but still fail to complete it. The wind episodes showed that an agent can land successfully while making the wrong continuation decision, or make an appropriate go-around without demonstrating the wind calculation we intended to test.

The scored sample contains 40 runs: ten runway trials and thirty wind trials. Excluded attempts include an initial operator-stopped Luna headwind flight before the preflight-start change, a Sol headwind simulator interruption and subsequent setup failure, two Sol low tailwind transport timeouts, and a Sol low headwind setup timeout. Replacement attempts supplied the five evaluable trials per group. Preliminary calibration flights are not pooled into the result tables.

These results are limited by five trials per setting, different model generations across experiments, unequal Luna and Sol decision budgets, and real-time inference delays. Approach-speed checks use the model's selected target rather than a verified weight-dependent landing speed. Touchdown values are sampled. The scoring weights and safety caps were selected retrospectively, so they should be treated as an interpretable prototype rubric.

The useful next tests are held-out wind directions and timing, expert review of the decision criteria, and investigation of hard touchdowns. A complete go-around circuit and second landing remain a separate extension. The public repository includes [all 30 final wind trial summaries](../examples/weather-matched-benchmark.json) and [selected runway and calibration examples](../examples/README.md); full telemetry and action traces are retained locally.
