# Thrust recovery diagnostic, 23 September 2026

This is simulator integration evidence, not certified A330 operating guidance.

## Question

The continuous wind challenge run `2026-09-23T12-23-40-777Z` established a go-around but subsequently stalled during a climbing turn and failed to establish a second approach before operator interruption. Was latency, model handling, or unavailable control the cause?

## Tests and findings

- A deterministic replay in `2026-09-23T12-48-20-845Z` reproduced the stall near simulation second 191. The earliest approach commands were late due to test launch timing, so this is an approximate reproduction, not an identical replay. The critical go-around/configuration commands used the original simulation timestamps, without model inference.
- The original model selected a higher speed but retracted flaps while actual speed was still decreasing in a climbing turn. The replay supports a command-sequencing problem rather than inference latency alone. It does not measure the counterfactual benefit of faster model decisions.
- After the replay's low-speed event, FADEC reported mode 3 (TOGA). At idle lever positions, actual throttle remained approximately 0.74 and N1 approximately 89 percent. The old autothrust action could not re-engage. No throttle override was active.
- Native `sim/autopilot/autothrottle_hard_off` cleared this state: FADEC changed to 0 with idle levers, actual throttle became 0, and engine N1 decreased. During the first test, continued low speed reactivated the protective thrust state. During the second test, with autopilot control restored, disconnection remained effective throughout the observation period.
- Re-engaging through the existing autothrust tool subsequently restored active selected-speed control and FADEC mode 1. Speed increased toward the selected 170 knots with AP1 engaged.
- The new exposed disconnect tool was separately exercised and verified, followed by successful re-engagement. No direct FADEC writes or physics overrides were used.

The installed A330 autopilot code forces autothrust mode inactive while both FADEC modes are at least 2. The exact internal protection/latch identity has not been established; mode 3 alone must not be labeled definitively as alpha-floor or TOGA-lock.

## Changes

- Added the native autothrust-disconnect cockpit control, with mode verification. It is an explicit model choice, not an automatic safety bypass.
- Added two-engine FADEC mode, actual throttle demand and N1 to observations and telemetry.
- Idle action verification no longer equates idle lever position with low actual throttle demand.
- Added general aircraft-reference guidance on lever/output distinction and possible protection reactivation. No wind-event schedule or required maneuver is disclosed.

## Interpretation

Mixed failure: model handling initiated deterioration, while the available controls and observations were incomplete for the subsequent recovery. This does not yet establish that a full return and landing is reliable, or that latency is irrelevant. The diagnostic used no paid model inference and preserved the original saved situation.

## One post-fix model retry

Run `2026-09-23T13-00-13-938Z` used GPT-6 Sol, low reasoning, the generic mission and updated reusable aircraft reference, with a 120-decision maximum. It was stopped after 44 recorded decisions, without a landing. Both calls to the new disconnect tool (steps 30 and 39) verified disengagement/disarming. Flight-state recovery remained poor, and low-speed protection could recur.

Inference latency was 4.034 seconds median, with outliers of 31.220, 20.148, 21.076, 91.927 and 91.087 seconds. The two consecutive approximately 92-second delays occurred during recovery; stale actions were discarded. The operator-facing outcome is an assistant-stopped diagnostic, not a completed benchmark or clean isolated model failure. No additional paid retry was started.

The automated tests passed during this diagnostic. X-Plane was confirmed paused afterward. Both protected situations and the protected replay retained their original hashes. The engine/control fix is verified; a reliable continuous go-around, circuit and landing remains unverified.
