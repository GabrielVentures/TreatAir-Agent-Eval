# Limitations and roadmap

The current evaluated wind task uses two separate matched flights: a tailwind episode that ends after a verified go-around climb, and a headwind episode that requires a landing. A full missed-approach circuit and second landing have not been validated.

## Current limitations

- The tested loader supports Apple Silicon macOS only.
- The current benchmark uses a controlled simulated ATC message rather than verified native tower audio or text.
- The demonstration covers one aircraft and airport. The runway benchmark has five selected runs each for GPT-5.6 Sol and Luna. The matched wind episodes have five evaluable GPT-6 Sol low-reasoning runs each. Their full outcomes and retrospective scores are in the evaluation report. Neither wind episode tests a second approach after a go-around.
- The sample size is too small for statistical claims about model quality.
- X-Plane must be available locally and cannot currently be run as a fast headless evaluation service.
- The model is not fine-tuned. There is no reinforcement-learning weight update.
- The dashboard is a local operator tool, not a hosted multi-user service.

## Next work

1. Repeat the matched wind episodes at held-out directions, speeds and event timings. Assess whether a runway-relative wind component should be exposed as a standard derived observation, without revealing the hidden event schedule. Separately verify a complete go-around recovery and second landing.
2. Add a complete short flight only after the adaptive approach task remains stable.
3. Repeat each model across seeded event timing and approach offsets.
4. Add replay and read-only trace review so the demo does not require a live paid model call.
5. Verify a supported native ATC observation path and compare it with the simulated message channel.
6. Add Linux and Windows plugin builds only after each has been tested in a clean installation.
7. Explore prompt and tool-policy optimization before considering model fine-tuning.
