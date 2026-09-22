# Demonstration guide

## Live walkthrough

The shortest live walkthrough is:

1. Open Flight Control Room.
2. Validate the local X-Plane installation.
3. Load and prepare the bundled A330 situation.
4. Show the paused approach state and the restricted agent tools.
5. Start a low-cost no-reasoning run.
6. Show the runway-change message arriving during the approach.
7. Show the model changing navigation and configuration and engaging the coupled approach.
8. Show the landing and final result fields.
9. Open the result trace and point to the event time, actions, touchdown, footprint, fuel, and stopping outcome.

For a public recording, capture only the simulator, dashboard, terminal output, and repository files. Do not capture API keys, Keychain dialogs, private files, or unrelated desktop content.

## Offline review

Reviewers without X-Plane can inspect the two sample results in this directory's `examples` folder and read [the evaluation report](EVALUATION.md). The successful result shows a completed runway change and coupled landing. The failure result shows a landing that crossed the runway boundary during rollout and explains why it was scored as incomplete.

## Suggested narration

“The model receives a normal landing objective and a restricted set of cockpit tools. The environment changes the runway during the approach. We record what the model observed, what it requested, what the simulator actually did, and whether the aircraft completed the mission. The point is to evaluate deployment behavior under changing conditions, not to claim that a language model should replace a flight-control system.”
