# Treat Air Flight Agent Evaluation Harness

An experimental deployment and evaluation system for tool-using AI agents. It connects a language model to X-Plane through a restricted cockpit action layer, introduces a controlled change during an approach, records the resulting trajectory, and scores whether the agent completes the task safely.

The demonstration uses an Airbus A330 approaching Portland International Airport. The agent starts with a normal instruction to land at KPDX. During the approach, the environment delivers a new runway clearance. The model must observe the message, reconfigure the aircraft through cockpit actions, establish a coupled approach, land on the assigned runway, and stop inside the runway boundary.

The aviation setting is a concrete testbed for a broader deployment problem: how to move from a capable model demonstration to an agent workflow that is observable, constrained, repeatable, and measurable when the environment changes.

## What is included

- A local X-Plane setup and situation loader.
- A localhost-only agent gateway with an allowlisted cockpit action surface.
- OpenAI Responses API and Codex execution backends.
- A dashboard for setup, monitoring, model selection, instructions, and results.
- Telemetry, action, message, and outcome logs.
- A runway-change scenario with an objective evaluator.
- Tests for navigation geometry, setup, action isolation, observation wakeups, and evaluation logic.
- A tested A330 situation and Apple Silicon macOS loader.

The model chooses high-level actions such as heading, altitude, speed, navigation, configuration, autopilot modes, acknowledgement, and go-around. The simulator's flight systems handle fast physical control. The evaluated agent cannot pause or accelerate time, change weather or failures, trigger or clear the event, teleport the aircraft, or write arbitrary simulator state.

## Quickstart

The complete setup is in [QUICKSTART.md](QUICKSTART.md). The short version is:

1. Install X-Plane 12.4.3 or newer with the Laminar Research A330-300.
2. Install Node.js 22 or newer.
3. Start the dashboard with `npm run dashboard` and open `http://127.0.0.1:8090`.
4. Enter the local X-Plane folder in the installation panel and install the bundled situation and loader.
5. Load and prepare the situation. Complete X-Plane's **Use Demo** and **Understood** screens if they appear.
6. Confirm the dashboard shows a paused ready state.
7. Add an OpenAI API key through the dashboard settings, set `OPENAI_API_KEY` in the server environment, or use the documented macOS Keychain fallback.
8. Select a model and start an evaluation.

The tested automatic loader is for Apple Silicon macOS. On other platforms, the dashboard provides a manual workflow: load the bundled saved flight in X-Plane, then choose **Prepare current flight**. The agent and evaluation stack are designed to use the same local web API afterward. Windows, Linux, and Intel Mac still require clean-machine testing before they can be claimed as supported.

## Review without running X-Plane

The repository includes sanitized sample outcomes in [examples](examples) and the measured experiment report in [docs/EVALUATION.md](docs/EVALUATION.md). These show a complete successful landing and a runway-excursion failure, including the objective fields used by the evaluator.

[docs/DEMO.md](docs/DEMO.md) explains how to reproduce the live walkthrough and what to record for a short demonstration video. A reviewer can understand the system and inspect the evidence without an API key or simulator installation.

## Project documentation

- [QUICKSTART.md](QUICKSTART.md): installation, configuration, and operator flow.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): system boundaries, tools, observations, and data flow.
- [docs/EVALUATION.md](docs/EVALUATION.md): experiment design, measurements, results, and failure analysis.
- [docs/ROADMAP.md](docs/ROADMAP.md): limitations and next experiments.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): approximate effort and development decisions.
- [CREDITS.md](CREDITS.md): AI assistance, reused components, and collaboration disclosure.

## Current status

The accepted runway-change experiment set contains **5 Sol completions in 5 included trials** and **1 Luna completion in 5 included trials**. Sol has **6 recorded attempts overall: 5 completions and 1 decision-limit failure excluded and replaced during development**. Earlier successful Sol runs were retained across environment repairs, so these are descriptive development results, not a fixed-version statistical comparison. See the [evaluation report](docs/EVALUATION.md) for individual runs and exclusions.

This is a proof of concept, not a certified flight system. The demonstrated scenario is intentionally narrow. Recent no-reasoning API trials completed the task with both Sol and Luna under some runs, while Luna also showed repeated decision-limit and rollout failures. The evidence is useful for studying agent reliability and tool design, not for claiming production autonomy.

The project does not perform reinforcement-learning weight updates. It provides the pieces that a future RL or agent-evaluation task would need: an environment, observations, actions, trajectories, scenario events, objective measurements, and failure labels.

## License and sharing

The repository is prepared as a public standalone project. Before publishing, choose a license and confirm redistribution rights for the simulator SDK headers, bundled loader, aircraft situation, and any screenshots or recordings. Do not commit API keys, local configuration, private meeting material, or the assignment brief.
