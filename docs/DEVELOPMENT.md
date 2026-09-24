# Development notes

The implementation was completed as a focused one-week proof-of-concept effort, approximately 30 to 40 engineering hours including simulator setup, integration, debugging, action-layer repair, evaluation design, documentation, and controlled experiments.

The largest changes in direction were deliberate:

- Direct joystick-style model control was replaced by high-level cockpit actions backed by native aircraft systems.
- Saved-situation restoration alone was replaced by a setup flow that reads back and verifies the live aircraft state.
- A single center-point landing check was replaced by a landing-gear contact footprint and runway-boundary test.
- Model success was separated from setup, transport, and event-delivery failures.
- The project focused first on a changing approach decision because it tests adaptation and observability in a shorter, more repeatable task than a complete flight.
- The first weather design required a full go-around circuit and second landing. Trials exposed poor speed/configuration sequencing, incomplete thrust-recovery controls, and occasional long inference delays. After repairing the control interface, a complete return and landing remained unreliable. To leave time and budget for repeated experiments, we split the wind task into an unsafe-tailwind go-around and a favorable-headwind landing, each starting from the same approach. The [evaluation report](EVALUATION.md) explains the tradeoff.
- Binary outcomes were supplemented with a retrospective 100-point rubric so a correct decision followed by a hard landing could be distinguished from missing the wind constraint. Original outcomes remain visible, and the [scoring policy](SCORING.md) makes its weights and safety caps explicit.

The development process used small controlled experiments, trace inspection, and regression tests after changes to the action layer and evaluator. The result is intentionally a research prototype with a clear path toward broader scenarios.
