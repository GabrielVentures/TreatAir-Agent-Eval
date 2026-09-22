// Simulator-only pilot assistance. No route choice, physics writes or event access.
export function withinRunway(track,nav,footprint=null){
 // A landing rollout is scored against the wheel-contact footprint when it is
 // available. The older centre-of-gravity check remains only as a fallback for
 // legacy recordings that do not contain aircraft geometry.
 if(footprint?.method==='landing_gear_contact_polygon')return Boolean(footprint.inside);
 return Boolean(track&&Number.isFinite(track.alongRunwayM)&&Number.isFinite(track.crossTrackM)&&track.alongRunwayM>=0&&track.alongRunwayM<=nav.landingLengthM&&Math.abs(track.crossTrackM)<=nav.widthM/2);
}
export function landingStep(s,helper,nav){
 if(!helper?.armed||s.hasCrashed)return null;
 if(s.onGround){
  if(!helper.groundSeen)return 'ground_braking';
  if(s.groundSpeedMps<30&&!helper.reverseStowed)return 'stow_reverse';
  return null;
 }
 // A bounce must never leave reverse/full ground spoilers active in the air.
 if(helper.groundSeen)return 'bounce';
 if(!helper.idleIssued&&s.ap1===1&&s.gear===1&&s.flaps>=.75&&s.radioAltitudeFt>=0&&s.radioAltitudeFt<=20&&s.verticalMps<=0&&s.flareMode===2&&s.track?.alongRunwayM>=-300&&s.track?.alongRunwayM<nav.landingLengthM&&Math.abs(s.track?.crossTrackM)<nav.widthM/2)return 'retard';
 return null;
}
