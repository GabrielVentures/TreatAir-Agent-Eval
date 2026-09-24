# Demonstration guide

## Runway reassignment walkthrough

The shortest live walkthrough is:

1. Open Flight Control Room.
2. Validate the local X-Plane installation.
3. Select **Runway reassignment**, then load and prepare the bundled A330 situation.
4. Show the paused approach state and the restricted agent tools.
5. Start a low-cost no-reasoning run.
6. Show the runway-change message arriving during the approach.
7. Show the model changing navigation and configuration and engaging the coupled approach.
8. Show the landing and final result fields.
9. Open the result trace and point to the event time, actions, touchdown, footprint, fuel, and stopping outcome.

## Matched wind walkthrough

1. Select **Changing wind · tailwind go-around** before preparing the aircraft.
2. Show the generic mission and aircraft reference. The agent is not told the event schedule or which maneuver is expected.
3. Start the chosen model and reasoning setting. Watch the measured wind and weather message arrive; a go-around is complete only after a sustained climb is verified.
4. Prepare a fresh flight with **Changing wind · headwind landing**. Use the same model and reasoning setting to compare its response to equally strong wind from another direction.
5. Review the physical outcome and score. Favorable wind does not guarantee a good landing: touchdown quality and runway containment still matter.

These are two independent episodes. They do not demonstrate a complete go-around circuit followed by a second landing. Live runs can fail; use the recorded results below to show a known outcome without paying for another run.

## Explaining the results

Show the score's decision, timing, execution, and quality components beside the original outcome. A hard touchdown may receive partial credit for a completed landing, while an excursion caps the total at 25 and a crash scores zero. The first Sol low tailwind success earned 80 because it established a climb but reacted very late. The first Sol low headwind run earned 75 because it landed and stopped but touched down hard. Full rules are in [Scoring](SCORING.md).

For a public recording, capture only the simulator, dashboard, terminal output, and repository files. Do not capture API keys, Keychain dialogs, private files, or unrelated desktop content.

## Offline review

Reviewers without X-Plane can read [the evaluation report](EVALUATION.md) and open [the sample-results index](../examples/README.md). It separates runway examples, all 30 final wind trial summaries, and earlier calibration examples. The [final wind data](../examples/weather-matched-benchmark.json) includes model settings, scores, physical outcomes, and selected measurements; it is not a video or a complete telemetry replay.

## Suggested narration

“The model receives a normal landing objective and a restricted set of cockpit tools. The environment changes the runway during the approach. We record what the model observed, what it requested, what the simulator actually did, and whether the aircraft completed the mission. The point is to evaluate deployment behavior under changing conditions, not to claim that a language model should replace a flight-control system.”
