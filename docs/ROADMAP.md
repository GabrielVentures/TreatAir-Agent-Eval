# Limitations and roadmap

The current evaluated wind task uses two separate matched flights: a tailwind episode that ends after a verified go-around climb, and a headwind episode that requires a landing. A full missed-approach circuit and second landing have not been validated.

## Current limitations

- The tested loader supports Apple Silicon macOS only.
- The current benchmark uses a controlled simulated ATC message rather than verified native tower audio or text.
- The demonstration covers one aircraft and airport. There are ten selected runway runs, five each for GPT-5.6 Sol and Luna without reasoning, and thirty matched wind runs: five per episode for GPT-6 Luna none, Sol none, and Sol low. See the [evaluation report](EVALUATION.md) for outcomes and scores. Neither wind episode tests a second approach after a go-around.
- The sample size is too small for statistical claims about model quality.
- X-Plane must be available locally and cannot currently be run as a fast headless evaluation service.
- The model is not fine-tuned. There is no reinforcement-learning weight update.
- The dashboard is a local operator tool, not a hosted multi-user service.

## Next work

1. Investigate the recurring hard touchdowns and distinguish model configuration choices from aircraft automation and landing-support behavior. Review the prototype scoring rules with an aviation expert.
2. Repeat the matched wind episodes at held-out directions, speeds and event timings. Assess whether a runway-relative wind component should be exposed as a standard derived observation, without revealing the hidden event schedule. Separately verify a complete go-around recovery and second landing.
3. Add a complete short flight only after the adaptive approach task remains stable.
4. Repeat each model across seeded event timing and approach offsets.
5. Add replay and read-only trace review so the demo does not require a live paid model call.
6. Verify a supported native ATC observation path and compare it with the simulated message channel.
7. Add Linux and Windows plugin builds only after each has been tested in a clean installation.
8. Explore prompt and tool-policy optimization before considering model fine-tuning.
