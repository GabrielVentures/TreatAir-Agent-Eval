# Limitations and roadmap

## Current limitations

- The tested loader supports Apple Silicon macOS only.
- The current benchmark uses a controlled simulated ATC message rather than verified native tower audio or text.
- The demonstration covers one aircraft, one airport, one runway-change scenario, and one general weather state.
- The sample size is too small for statistical claims about model quality.
- X-Plane must be available locally and cannot currently be run as a fast headless evaluation service.
- The model is not fine-tuned. There is no reinforcement-learning weight update.
- The dashboard is a local operator tool, not a hosted multi-user service.

## Next work

1. Add the wind-variation scenario with the same observation and scoring interface.
2. Add a complete short flight only after the adaptive approach task remains stable.
3. Repeat each model across seeded event timing and approach offsets.
4. Add replay and read-only trace review so the demo does not require a live paid model call.
5. Verify a supported native ATC observation path and compare it with the simulated message channel.
6. Add Linux and Windows plugin builds only after each has been tested in a clean installation.
7. Explore prompt and tool-policy optimization before considering model fine-tuning.
