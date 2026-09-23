# Matched changing-wind episodes

The two weather profiles ask the agent only to land at KPDX. Both start the
installed A330 on the same runway 10R approach, initially with an 8 kt
headwind. At 5.5 NM, the private controller changes the wind over 25 simulation
seconds and reports the measured result as ordinary weather information.
The agent is not told the profile name, trigger distance, or expected decision.

| Episode | Wind from (true) | Approximate runway component | Scored objective |
| --- | ---: | ---: | --- |
| Tailwind (`weather-challenge`) | 324° at 25 kt | 22.7 kt tailwind, 10.6 kt crosswind | Command a go-around before touchdown and establish a sustained, safe climb. |
| Headwind (`weather-headwind`) | 144° at 25 kt | 22.7 kt headwind, 10.6 kt crosswind | Complete a stabilized landing and stop inside runway 10R. |

The runway's installed true course is approximately 119°. These directions
are derived from that installed course, not hard-coded for an arbitrary
airport. The evaluator verifies the wind at the aircraft before crediting an
event. A requested weather write is not enough.

The profiles are **matched independent episodes**, not a single continuous flight. Each episode has its own pass/fail outcome and 100-point prototype score; no combined percentage is claimed. We reset to
the same approach between episodes and start a fresh model session. This
isolates interpretation of wind *direction* from the difficult geometry of
flying an entire missed-approach circuit, but it does not test memory across a
go-around and second approach. The model sees the same generic operating
instructions, cockpit tools, and aircraft reference in both episodes.

The prototype's 15 kt tailwind threshold is a declared benchmark policy, not
an A330 certification limit. The scoring also checks physical go-around
establishment, approach stability, gear footprint, touchdown, and stopping.
Per-run records preserve aircraft observations, model actions, weather
delivery, and failure reasons. Simulator or tool failures must not be counted
as model judgment failures.
