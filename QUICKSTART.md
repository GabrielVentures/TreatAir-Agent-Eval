# Quickstart

## Requirements

- X-Plane 12.4.3 or newer.
- The Laminar Research Airbus A330-300 included with the tested installation.
- Node.js 22 or newer.
- Apple Silicon macOS for the bundled loader.
- An OpenAI API key for direct API evaluations, or a configured Codex CLI for the Codex backend.

The harness uses X-Plane's local web API on `http://localhost:8086/api/v3`. X-Plane and the dashboard must run on the same computer.

## Install

From the repository root:

```sh
npm run check
npm test
npm run dashboard
```

Open `http://127.0.0.1:8090`. In the **X-Plane installation** panel, select the local X-Plane 12 folder and choose **Validate & install project files**. The installer checks the A330, navigation data, airport data, and platform loader, then copies the bundled situation and loader without overwriting an existing destination.

The equivalent command is:

```sh
node install.mjs --xplane-root "/path/to/X-Plane 12"
```

The path is stored only in `.state/local-config.json`, which is ignored by Git. `XPLANE_ROOT` can provide it for a one-off command.

## Prepare a run

On Apple Silicon macOS, use **Load & prepare** in the dashboard. The harness launches X-Plane, waits through any demo screens, loads the bundled situation, configures the aircraft, reapplies pause after initialization, and verifies the handoff. If the demo screens appear, click **Use Demo** and then **Understood**.

Choose the scenario before preparation:

| Dashboard choice | Scenario ID | Objective |
|---|---|---|
| Runway reassignment | `runway-change` | Adapt from runway 28R to 28L and land |
| Changing wind · tailwind go-around | `weather-challenge` | Reject the landing and establish a sustained climb |
| Changing wind · headwind landing | `weather-headwind` | Land and stop in favorable wind of the same strength |

The two matched wind episodes use a KPDX 10R approach, an 8 kt initial headwind, and static/preset weather rather than Real Weather. Wind changes to 25 kt over 25 simulation seconds when the aircraft reaches 5.5 NM. The new conditions remain in place for the episode; they do not return to baseline during these runs. Prepare a new flight between episodes. The controller restores the original weather settings after evaluation ends.

The dashboard reports whether the new wind was actually measured at the aircraft. An unverified event is not a valid agent comparison. The model receives measured wind and ordinary weather updates, plus the shared aircraft reference, without the event schedule or expected decision. See [the matched episode specification](docs/WEATHER-PAIR.md).

**Changing wind · manageable** (`weather-mild`) is an additional calibration profile, outside the reported matched benchmark. It uses a moderate change, then restores baseline wind after a 120-second hold and a 30-second recovery ramp.

On Windows, Linux, or another system without the bundled native loader, use the manual path shown in the dashboard:

1. Start X-Plane and complete any demo prompts.
2. Load **Runway Change Airbus A330-300 Situation** through X-Plane's saved-flight interface.
3. Wait until the A330 cockpit and scenery are visible.
4. Return to Flight Control Room and choose **Prepare current flight**.

The manual path uses the same setup verification, action layer, agent loop, recorder, and evaluator. It bypasses only automatic saved-flight loading. It has not yet been validated on Windows or Linux, so those platforms are compatibility targets rather than claimed supported configurations.

The command-line equivalent is:

```sh
node scenario.mjs setup --scenario weather-challenge
node scenario.mjs status
```

The final status must report `"ready": true` and `"paused": 1` before an evaluation begins.

## Run an agent

For the direct API backend, open the settings button in the upper-right corner and add an OpenAI API key for the current dashboard session. The key remains in server memory and is not written to disk or returned to the browser.

For command-line use, set the environment variable instead:

```sh
export OPENAI_API_KEY="..."
node scenario.mjs start
```

In another terminal:

```sh
export OPENAI_API_KEY="..."
node flight-agent.mjs --backend api --model gpt-5.6-sol --reasoning none --max-decisions 80
```

For Codex:

```sh
node scenario.mjs start
```

In another terminal:

```sh
node flight-agent.mjs --backend codex --model gpt-5.6-sol --reasoning low
```

The gateway writes one-run credentials to `.state/agent-access.json`. Keep that directory local and never publish it.

To run the benchmark helper:

```sh
node benchmark-batch.mjs --only sol --runs 1 --backend api --reasoning none --max-decisions 50
```

For one matched wind trial using the evaluated Sol low setting, prepare the simulator and use:

```sh
node benchmark-batch.mjs --scenario weather-challenge --model gpt-6-sol --runs 1 --backend api --reasoning low --max-decisions 40 --preflight
```

For the headwind episode, replace `weather-challenge` with `weather-headwind` and use `--max-decisions 50`. `--preflight` obtains the first model response while the prepared aircraft remains paused, then starts real-time evaluation. These commands make paid model requests.

Dashboard runs keep the prepared aircraft paused until the first model response succeeds. If OpenAI rejects a request for insufficient quota, the dashboard displays a persistent credit/spending-limit error with a billing link. Add credit or review limits for the account/project owning the API key, then prepare the flight and retry. Invalid keys and temporary rate limits have separate messages.

The evaluator records raw telemetry and writes a structured `result.json` in `.state/runs/<timestamp>`, including the original outcome and the 100-point score with component values and safety caps. The dashboard displays both. See [scoring rules](docs/SCORING.md). Generate the structured report with:

```sh
node scenario.mjs report
```

## Troubleshooting

- If X-Plane's demo dialog appears, complete both buttons and let setup continue.
- If scenery is missing, choose **Continue with Water Only** for this scenario.
- If X-Plane closes, start a new setup attempt. A stopped setup must not relaunch it automatically.
- If the loader conflicts with an existing destination, inspect the conflict and preserve the existing file.
- Native ATC OCR is optional and is not required for the demonstrated runway-change scenario.
- Do not use a saved `.sit` from another aircraft or installation. The bundled situation is tied to the tested A330 and navigation data.
