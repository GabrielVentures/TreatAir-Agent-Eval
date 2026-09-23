# A330 simulator adapter

Heading targets use magnetic degrees, altitude targets use indicated feet, speed targets use KIAS, and vertical speed uses feet per minute. NAV frequencies use 10 kHz units; COM frequencies use kHz. Flap handle positions are 0, .25, .5, .75 and 1; actual deployment is reported separately.

AP1 is used for vectoring, go-around recovery and ordinary coupled approach tracking. AP2 is available only after AP1 and both localizer and glideslope are captured. Engaging AP2 selects dual-channel operation for autoland; do not use it during vectoring or a go-around. Selecting an altitude does not select a vertical mode.

For native X-Plane autoland, use a CAT III ILS, power both NAV receivers, and make the pilot and copilot NAV courses agree. Both autopilots and independent flight directors must agree on the coupled ILS. In a controlled test on the installed A330, FLARE and ROLLOUT armed at approximately 366 ft radio altitude. There is no direct FLARE or ROLLOUT command. Verify `automation.dualChannelReady`, then verify flare and rollout change from `off` to `armed` and later `active`. If required modes do not arm or the approach is unstable, go around.

The model chooses all maneuver targets, including heading, altitude, speed and vertical speed for a missed approach. No preset go-around tool is provided. Disarm landing assistance when abandoning an approach.

The `toga` control moves both thrust levers to TOGA and requests the simulator's native go-around guidance. It does not choose the missed-approach route or targets. Verify the actual thrust, flight-guidance modes and climb before relying on it. The `autopilot2_off` control removes AP2 when leaving a dual-channel approach; verify that AP1 remains engaged or re-engage it. The `autothrust` control returns the thrust levers to their CLB detent when appropriate. These are cockpit controls, not a scripted go-around maneuver.

`effectiveWindDirectionDeg` is the wind **from** direction in true degrees at the aircraft. `effectiveWindSpeedKts` is the measured local wind in knots. They can differ from an airport report or a regional weather setting. Airspeed, ground speed, approach-path deviation and descent rate must be judged together as conditions change.

Prototype operating policy, shared across missions: do not land with a runway-relative tailwind component above 15 kt. This is an evaluation operating constraint, not a certified A330 limitation. Use the runway's true course when comparing it with true wind direction. Reassess current conditions before every approach.

The prototype assesses approach stability at 1,000 and 500 ft radio altitude: landing gear down, at least configuration 3, captured lateral and vertical approach guidance, localizer deviation within 0.5 dot, glideslope within 1 dot, descent rate no more than 1,100 ft/min, and airspeed within -10/+15 kt of the selected approach target. Configuration limits and critical warnings remain applicable throughout. These are evaluation criteria; selected-speed tracking does not establish a correct weight-dependent approach speed.

Observations include aircraft mass and the installed aircraft's full-flap speed limit. This single limit is not a complete configuration-speed schedule or a recommended approach speed. Weight-dependent VAPP/VREF and the full configuration-limit schedule are not yet verified or supplied; do not treat their absence as zero.

configurationLimitKias and nextFlapLimitKias expose the limits calculated by the installed A330's speed-tape logic for current and next flap configuration. nextFlapLimitKias is null when no further flap extension is available. These are maximum speeds, not approach-speed recommendations.

Localizer and glideslope deviations are raw instrument dots, meaningful only when the corresponding signal flag is 1. Their directional sign convention has not yet been verified in this installation. The runway geometry additionally reports geometric path altitude and abovePathFt (positive means above the nominal path), calculated before the threshold from runway elevation and glideslope angle. This is geometric guidance, not a terrain-clearance guarantee or a published missed-approach procedure.

This POC uses explicit simulated clearance messages. It does not implement interactive ATC requests or provide published obstacle-clearance procedures. Remaining simulation time, wall time and model decisions are included in observations.

The landing_support_arm tool automates idle, ground spoilers and reverse thrust. It does not steer, select autoland, apply wheel brakes or select a flight path. See its tool description for prerequisites. Flare and rollout modes report 0=off, 1=armed, 2=active.
