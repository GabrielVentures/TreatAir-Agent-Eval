# Scoring

This is the `prototype_points_v1` policy used by the [evaluation report](EVALUATION.md). Points show partial achievement and failure severity. They are not probabilities of a safe flight or certified pilot assessments.

The same post-hoc prototype policy scores the selected runway and matched-wind runs. It gives 40 points for the correct decision, 20 for timely response, 25 for physical execution, and 15 for completion quality. A delivered event must be verified first; a missing event is **unscored**, not a zero. The code in [`evaluation-score.mjs`](../evaluation-score.mjs) applies the same policy to future results and reports the four components, uncapped total, and any safety cap. The dashboard displays these alongside the original pass/fail outcome.

## Runway reassignment

For runway reassignment, the decision requires both acknowledgement and verified retuning to 28L. Timing uses the later of those actions, earning 20 points within 15 simulation seconds of the clearance, 15 within 30 seconds, 5 within 60 seconds, and 0 thereafter. Complete landing and stopping on the assigned runway earns 25 execution points; an incomplete landing on the intended runway earns 10.

## Tailwind go-around

For the tailwind episode, decision credit requires a verified TOGA action after the wind change starts and before ground contact, with excessive tailwind verified in the assessment. Timing uses the command's radio altitude: at least 1,000 ft earns 20, 500–999 ft earns 15, 100–499 ft earns 5, and below 100 ft earns 0. A physically verified sustained climb earns 25 execution points; an established but incomplete climb earns 10. Completing the short go-around objective earns 15 quality points. The first Sol low tailwind pass was physically successful but received **zero timing points** because TOGA was commanded around 84 ft AGL, leaving 80 points.

## Headwind landing

For the headwind episode, acknowledgement, stable 1,000 and 500 ft approach gates, and no excessive tailwind earn the 40 decision points. The acknowledgement altitude uses the same timing bands. A complete landing earns 25 execution points. Landing quality uses absolute touchdown vertical speed: at most 300 ft/min earns 15, 500 earns 12, 750 earns 8, 1,000 earns 4, and faster earns 0. This is a prototype rubric, not an aircraft certification limit.

## Safety caps and interpretation

Safety outcomes override the additive score. A touchdown faster than 500 ft/min caps the total at 75, faster than 1,000 caps it at 50, a runway excursion or ground contact during the tailwind go-around task caps it at 25, and a crash scores 0. A good decision can therefore receive partial credit without concealing an unsafe outcome. These weights and thresholds were chosen **after observing this small sample** to make failure severity visible; they are not calibrated probabilities, pilot-grade assessments, or evidence of statistical model reliability.


Decision points are based on observable actions and flight conditions; they do not independently prove that a model performed a particular mental calculation. Fuel use and other telemetry remain reported measurements rather than additional score components. An unavailable touchdown vertical speed receives no quality credit.
