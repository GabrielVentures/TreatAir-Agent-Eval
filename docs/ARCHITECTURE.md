# Architecture and design notes

## System boundary

The harness has four cooperating layers:

1. **X-Plane** supplies aircraft physics, instruments, autopilot behavior, navigation signals, and the visual environment.
2. **The scenario controller** prepares the aircraft, schedules the selected hidden event, owns setup and weather privileges, and records telemetry.
3. **The agent gateway** exposes observations and a small, typed cockpit action surface over localhost. It keeps setup and event controls outside the evaluated agent.
4. **The model loop and evaluator** choose actions, verify resulting state, record the trajectory, and calculate mission outcome and quality metrics.

The model does not receive arbitrary X-Plane datarefs. It receives compact state, runway geometry, communications, recent history, action results, and a decision budget. Actions describe intent at the level of a pilot using the FCU, radios, autopilot, and aircraft configuration.

## Why the model is not a joystick controller

Language-model response latency is too high for reliable sub-second elevator, rudder, and aileron control. The A330's native systems handle those continuous corrections. The model decides what the aircraft should do and verifies whether the selected modes actually took effect.

This creates a useful deployment boundary: deterministic software handles fast mechanics while the model handles planning, mode selection, adaptation, and recovery.

## Action verification

An accepted HTTP action is not treated as proof that the aircraft responded. The gateway reads the relevant state after each action and reports whether the target selector, mode, or configuration is satisfied, pending, or failed. Observations also expose runway distance, threshold bearing, inbound runway course, cross-track error, distance trend, and threshold trend so the model can distinguish a good alignment from an aircraft that has already passed the threshold.

The final approach uses the A330's native dual-channel autoland. FLARE and ROLLOUT remain read-only simulator states. The evaluator scores the actual landing-gear footprint against the assigned runway polygon, rather than using only the aircraft center point.

## Scenario flow

The agent receives the generic mission to land at KPDX. In the runway-reassignment profile, a separate controller delivers a new clearance. In the wind profiles, the controller changes regional weather and verifies the resulting wind at the aircraft before it reports delivery. The agent sees local wind, flight behavior and a routine weather report, but not the event schedule or target. The prompt and aircraft reference remain the same across profiles.

The matched wind benchmark uses two independent episodes. `weather-challenge` introduces excessive tailwind and ends after a verified go-around command and sustained airborne climb. `weather-headwind` introduces equally strong favorable wind and requires a stable landing and stop, including approach checks at 1,000 and 500 ft. Both start on 10R, ramp from 8 kt to 25 kt over 25 simulation seconds at 5.5 NM, and hold their new wind for the episode. Each uses a fresh model session. The older `weather-mild` profile remains available for calibration but is outside the matched results.

A late go-around can complete the physical objective while losing timing points. These rules are declared benchmark policy, not verified A330 operating limits. Selected speed is a tracking reference because a verified weight-dependent landing-speed calculation is not yet available from the adapter. The [scenario specification](WEATHER-PAIR.md) gives the two wind directions and objectives.

The batch runner supports `--preflight`, used for the matched benchmark. It obtains the first model response while paused, then starts the real-time flight. Subsequent inference runs while the aircraft continues moving.

## Evidence flow

Each run has separate JSONL logs for model decisions, agent actions, telemetry, messages, scenario events, and setup decisions. `result.json` contains the final structured assessment. This makes it possible to inspect whether a failure came from the model decision, action mapping, scenario setup, or missing event delivery.

`evaluation-score.mjs` computes the 100-point score from the recorded result, actions, and messages. The result includes decision, timing, execution, quality, the total before safety caps, and the final score. Missing event evidence leaves the result unscored. Reports and the dashboard show the points alongside the original outcome; see [Scoring](SCORING.md). Published [wind benchmark summaries](../examples/weather-matched-benchmark.json) contain selected measurements from all 30 evaluated wind trials without local paths or credentials.

## Deliberate omissions

The current handover omits full takeoff-to-landing routing, native ATC injection, reinforcement-learning training, multi-aircraft support, and real-flight certification. Repeated trials exist for both matched wind episodes; held-out wind directions and timings remain future work. Complete missed-approach recovery and a second landing were explored but not made reliable within the project schedule.
