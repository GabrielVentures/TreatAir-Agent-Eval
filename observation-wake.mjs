// Compare against the start of this wait. Used only to wake observation,
// never to choose a maneuver or cancel an otherwise valid model action.
export function observationWakeReasons(before,after){
 const a=before.state||{},b=after.state||{},reasons=[];
 if(before.communicationRevision!==after.communicationRevision)reasons.push('communications_changed');
 for(const k of ['ap1','ap2','athrOn','headingMode','navMode','gsMode','verticalMode','flareMode','rolloutMode','onGround','hasCrashed','warning','caution','stall','overspeed','airframeOverspeed','lowSpeedProtection']){
  if(a[k]!==undefined&&b[k]!==undefined&&a[k]!==b[k])reasons.push(k+'_changed');
 }
 const changed=(k,delta)=>Number.isFinite(a[k])&&Number.isFinite(b[k])&&Math.abs(b[k]-a[k])>=delta;
 if(changed('iasKts',10))reasons.push('airspeed_changed_10kt');
 if(changed('effectiveWindSpeedKts',5))reasons.push('wind_speed_changed_5kt');
 if(Number.isFinite(a.effectiveWindDirectionDeg)&&Number.isFinite(b.effectiveWindDirectionDeg)&&Math.abs(((b.effectiveWindDirectionDeg-a.effectiveWindDirectionDeg+540)%360)-180)>=30&&Math.max(a.effectiveWindSpeedKts||0,b.effectiveWindSpeedKts||0)>=5)reasons.push('wind_direction_changed_30deg');
 if(changed('bank',10)&&Math.abs(b.bank)>=20)reasons.push('bank_increased');
 if(b.onGround===0){
  for(const feet of [2000,1500,1000,500,200,100,50,20])if(a.radioAltitudeFt>feet&&b.radioAltitudeFt<=feet)reasons.push('descending_through_'+feet+'ft');
  for(const k of ['localizerDots','glideslopeDots'])if(changed(k,.5)&&Math.abs(b[k])>=1&&Math.abs(b[k])>Math.abs(a[k]))reasons.push(k+'_deviation_increased');
  if(b.radioAltitudeFt<500&&changed('vsiFpm',500)&&b.vsiFpm<a.vsiFpm)reasons.push('sink_rate_increased');
 }
 if(b.simTime<a.simTime)reasons.push('simulation_reset');
 return reasons;
}
