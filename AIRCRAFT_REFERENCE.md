# A330 simulator adapter

Heading targets use magnetic degrees, altitude targets use indicated feet, speed targets use KIAS, and vertical speed uses feet per minute. NAV frequencies use 10 kHz units; COM frequencies use kHz. Flap handle positions are 0, .25, .5, .75 and 1; actual deployment is reported separately.

AP1 is used for vectoring, go-around recovery and ordinary coupled approach tracking. AP2 is available only after AP1 and both localizer and glideslope are captured. Engaging AP2 selects dual-channel operation for autoland; do not use it during vectoring or a go-around. Selecting an altitude does not select a vertical mode.

For native X-Plane autoland, both autopilots and independent flight directors must agree on the coupled ILS. Below 1,500 ft AGL, X-Plane should then arm FLARE and ROLLOUT automatically. There is no direct FLARE or ROLLOUT command. Verify `automation.dualChannelReady`, then verify flare and rollout change from `off` to `armed` and later `active`. If required modes do not arm or the approach is unstable, go around.

The model chooses all maneuver targets, including heading, altitude, speed and vertical speed for a missed approach. No preset go-around tool is provided. Disarm landing assistance when abandoning an approach.

Observations include aircraft mass and the installed aircraft's full-flap speed limit. This single limit is not a complete configuration-speed schedule or a recommended approach speed. Weight-dependent VAPP/VREF and the full configuration-limit schedule are not yet verified or supplied; do not treat their absence as zero.

configurationLimitKias and nextFlapLimitKias expose the limits calculated by the installed A330's speed-tape logic for current and next flap configuration. nextFlapLimitKias is null when no further flap extension is available. These are maximum speeds, not approach-speed recommendations.

Localizer and glideslope deviations are raw instrument dots, meaningful only when the corresponding signal flag is 1. Their directional sign convention has not yet been verified in this installation. The runway geometry additionally reports geometric path altitude and abovePathFt (positive means above the nominal path), calculated before the threshold from runway elevation and glideslope angle. This is geometric guidance, not a terrain-clearance guarantee or a published missed-approach procedure.

This POC uses explicit simulated clearance messages. It does not implement interactive ATC requests or provide published obstacle-clearance procedures. Remaining simulation time, wall time and model decisions are included in observations.

The landing_support_arm tool automates idle, ground spoilers and reverse thrust. It does not steer, select autoland, apply wheel brakes or select a flight path. See its tool description for prerequisites. Flare and rollout modes report 0=off, 1=armed, 2=active.
