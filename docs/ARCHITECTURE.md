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

The manageable wind profile keeps full physical landing completion separate from its approach-safety assessment at 1,000 and 500 ft. The challenge wind profile has a deliberately shorter goal: the changed wind must be verified at the aircraft, TOGA must be commanded while the aircraft is airborne and the event is active, and the aircraft must remain airborne in a sustained climb. A safe go-around below 500 ft can still succeed, but its decision altitude is recorded. The latter ends the run before a second approach. These gates are declared benchmark policy, not verified A330 operating limits. The selected speed is used only as a tracking reference because a weight-dependent VAPP is not yet available from the installed aircraft adapter.

## Evidence flow

Each run has separate JSONL logs for model decisions, agent actions, telemetry, messages, scenario events, and setup decisions. `result.json` contains the final structured assessment. This makes it possible to inspect whether a failure came from the model decision, action mapping, scenario setup, or missing event delivery.

## Deliberate omissions

The current handover omits full takeoff-to-landing routing, native ATC injection, reinforcement-learning training, multi-aircraft support, and real-flight certification. The short weather challenge needs repeated fixed-setting and held-out-wind evaluations before its difficulty can be characterized. Complete missed-approach recovery and a second landing are separate future tests.
