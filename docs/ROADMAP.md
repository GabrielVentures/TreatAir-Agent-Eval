# Limitations and roadmap

## Current limitations

- The tested loader supports Apple Silicon macOS only.
- The current benchmark uses a controlled simulated ATC message rather than verified native tower audio or text.
- The demonstration covers one aircraft and airport. The runway-change benchmark has recorded model runs. The short wind challenge intentionally ends after a sustained go-around climb, not a second-approach landing. Earlier rapid-wind runs ended in go-arounds following coupled-guidance failure. A later gradual-wind control retained coupled guidance, but one Sol and one Luna run both landed despite the shared prototype tailwind constraint. The gradual profile is not yet a repeated reliability benchmark.
- The sample size is too small for statistical claims about model quality.
- X-Plane must be available locally and cannot currently be run as a fast headless evaluation service.
- The model is not fine-tuned. There is no reinforcement-learning weight update.
- The dashboard is a local operator tool, not a hosted multi-user service.

## Next work

1. Repeat the gradual-wind challenge at fixed and held-out settings to estimate how often the models apply the operating constraint. Assess whether a runway-relative wind component should be exposed as a standard derived observation, without revealing the hidden event schedule. As a separate, longer benchmark, verify complete go-around recovery and a second landing.
2. Add a complete short flight only after the adaptive approach task remains stable.
3. Repeat each model across seeded event timing and approach offsets.
4. Add replay and read-only trace review so the demo does not require a live paid model call.
5. Verify a supported native ATC observation path and compare it with the simulated message channel.
6. Add Linux and Windows plugin builds only after each has been tested in a clean installation.
7. Explore prompt and tool-policy optimization before considering model fine-tuning.
