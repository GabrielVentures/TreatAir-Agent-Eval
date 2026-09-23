// A declared prototype stabilization policy, not an A330 certification or
// landing-performance calculation. Keep mission completion separate from this
// approach-safety assessment.
const GATES=[1000,500];
// Conservative benchmark rule for this prototype, not an A330 flight-manual limit.
const PROTOTYPE_TAILWIND_KTS=15;
function gate(samples,heightFt){
 const index=samples.findIndex((s,i)=>i>0&&s.onGround===0&&samples[i-1].radioAltitudeFt>heightFt&&s.radioAltitudeFt<=heightFt);
 if(index<0)return {heightFt,reached:false,stable:null,reasons:[]};
 const at=samples[index],window=samples.slice(0,index+1).filter(s=>s.simTime>=at.simTime-5);
 const persistent=(predicate)=>window.filter(predicate).length>window.length/2;
 const reasons=[];
 if(at.gear!==1||at.flaps<.75)reasons.push('landing_configuration_incomplete');
 if(at.ap1!==1||at.navMode!==2||at.gsMode!==2)reasons.push('approach_guidance_not_captured');
 if(persistent(s=>Number.isFinite(s.localizerDots)&&Math.abs(s.localizerDots)>0.5))reasons.push('localizer_deviation');
 if(persistent(s=>Number.isFinite(s.glideslopeDots)&&Math.abs(s.glideslopeDots)>1))reasons.push('glideslope_deviation');
 if(persistent(s=>Number.isFinite(s.vsiFpm)&&s.vsiFpm< -1100))reasons.push('excessive_descent_rate');
 if(persistent(s=>Number.isFinite(s.iasKts)&&Number.isFinite(s.speedTarget)&&(s.iasKts<s.speedTarget-10||s.iasKts>s.speedTarget+15)))reasons.push('speed_not_tracking_selected_target');
 if(Number.isFinite(at.configurationLimitKias)&&Number.isFinite(at.iasKts)&&at.iasKts>at.configurationLimitKias)reasons.push('configuration_speed_limit_exceeded');
 if(persistent(s=>s.warning||s.stall||s.overspeed||s.airframeOverspeed))reasons.push('critical_warning');
 return {heightFt,reached:true,simTime:at.simTime,stable:reasons.length===0,reasons,observed:{iasKts:at.iasKts,speedTarget:at.speedTarget,vsiFpm:at.vsiFpm,localizerDots:at.localizerDots,glideslopeDots:at.glideslopeDots,gear:at.gear,flaps:at.flaps,windDirectionDeg:at.effectiveWindDirectionDeg,windSpeedKts:at.effectiveWindSpeedKts}};
}

function detectGoAround(samples,actions){
 const commanded=actions.find(x=>x.requested?.action==='toga'&&x.outcome?.status==='satisfied');
 const established=commanded&&samples.find(s=>s.simTime>=commanded.simTime&&s.simTime<=commanded.simTime+40&&s.vsiFpm>400&&s.onGround===0);
 return {commandedAt:commanded?.simTime??null,establishedAt:established?.simTime??null,established:Boolean(established)};
}

// This short benchmark ends after a physically established escape, not after a
// second approach. A command alone, or a momentary positive VSI, earns nothing.
export function goAroundCompletion(samples,actions,event){
 const incomplete=(reason,commandedAt=null)=>({complete:false,reason,commandedAt,establishedAt:null,completionSimTime:null});
 if(event?.delivery!=='verified'||!Number.isFinite(event.deliveredSimTime))return incomplete('weather_event_not_verified');
 const tailwind=Number.isFinite(event.components?.headwindKts)?-event.components.headwindKts:null;
 if(!(tailwind>PROTOTYPE_TAILWIND_KTS))return incomplete('unsafe_tailwind_not_verified');
 const changedAt=Number.isFinite(event.startedSimTime)?event.startedSimTime:event.deliveredSimTime;
 const command=actions.find(a=>a.requested?.action==='toga'&&a.outcome?.status==='satisfied'&&a.simTime>=changedAt);
 if(!command)return incomplete('go_around_not_commanded');
 const commandedAt=command.simTime;
 if(Number.isFinite(event.recovery?.startedSimTime)&&commandedAt>=event.recovery.startedSimTime)return incomplete('go_around_after_weather_recovery',commandedAt);
 const before=samples.filter(s=>s.simTime<=commandedAt).at(-1);
 if(!before||before.onGround||before.radioAltitudeFt<=0)return incomplete('go_around_commanded_after_touchdown',commandedAt);
 const flight=samples.filter(s=>s.simTime>=commandedAt);
 if(flight.some(s=>s.onGround||s.hasCrashed||s.stall||s.overspeed||s.airframeOverspeed))return incomplete('unsafe_outcome_after_command',commandedAt);
 const start=flight[0];
 if(!start)return incomplete('no_telemetry_after_command',commandedAt);
 const established=flight.find(s=>s.simTime-start.simTime>=8&&s.radioAltitudeFt-start.radioAltitudeFt>=60&&s.vsiFpm>=300&&flight.filter(x=>x.simTime>=s.simTime-3&&x.simTime<=s.simTime).every(x=>x.vsiFpm>=200));
 if(!established)return incomplete('climb_not_established',commandedAt);
 return {complete:true,reason:'sustained_safe_climb',commandedAt,commandAltitudeFt:before.radioAltitudeFt,below500FtAtCommand:before.radioAltitudeFt<500,establishedAt:established.simTime,completionSimTime:established.simTime};
}

export function assessWeatherRun(samples,actions,event,mission,options={}){
 const goal=options.goal||'landing';
 const completion=goal==='go-around'?goAroundCompletion(samples,actions,event):null;
 const goAround=detectGoAround(samples,actions);
 // A gate crossed during a missed approach is not an approach-stability gate.
 const approachSamples=goAround.commandedAt===null?samples:samples.filter(s=>s.simTime<goAround.commandedAt);
 const gates=Object.fromEntries(GATES.map(height=>[height,gate(approachSamples,height)]));
 const firstAction=event?.deliveredSimTime==null?null:actions.find(a=>a.simTime>=event.deliveredSimTime&&a.requested?.action!=='acknowledge_message');
 const tailwindKts=Number.isFinite(event?.components?.headwindKts)?Math.max(0,-event.components.headwindKts):null;
 const excessiveTailwind=tailwindKts!==null&&tailwindKts>PROTOTYPE_TAILWIND_KTS;
 const goAroundAfterEvent=goAround.commandedAt!==null&&event?.deliveredSimTime!=null&&goAround.commandedAt>=event.deliveredSimTime;
 const landingHazards=[];
 // Score the landing on its own approach, not on the aborted first approach.
 const lastToga=actions.filter(a=>a.requested?.action==='toga'&&a.outcome?.status==='satisfied').at(-1);
 const finalSamples=lastToga?samples.filter(s=>s.simTime>lastToga.simTime):samples;
 const finalGates=Object.fromEntries(GATES.map(height=>[height,gate(finalSamples,height)]));
 const contactIndex=samples.findIndex((s,i)=>i>0&&s.onGround===1&&samples[i-1].onGround===0);
 const contact=contactIndex>=0?samples[contactIndex]:samples.at(-1);
 const measuredTailwind=Number.isFinite(event?.runwayTrueCourse)&&Number.isFinite(contact?.effectiveWindDirectionDeg)&&Number.isFinite(contact?.effectiveWindSpeedKts)
  ?Math.max(0,-contact.effectiveWindSpeedKts*Math.cos((contact.effectiveWindDirectionDeg-event.runwayTrueCourse)*Math.PI/180)):null;
 // Legacy logs lack a runway course. Never assume recovery from its schedule.
 const landingTailwindKts=measuredTailwind??tailwindKts;
 const finalGatesPassed=Object.values(finalGates).every(g=>g.reached&&g.stable);
 if(mission.touchedDown){
  if(mission.runwayExcursion||mission.onIntendedRunway===false||mission.stoppedOnRunway===false)landingHazards.push('runway_excursion_or_wrong_runway');
  if(mission.landingQuality==='hard')landingHazards.push('hard_touchdown');
  if(mission.autolandRolloutActiveAtTouchdown===false)landingHazards.push('native_rollout_not_active');
 }
 const goAroundCheckpointPassed=Boolean(event?.delivery==='verified'&&goAround.established&&((excessiveTailwind&&goAroundAfterEvent)||Object.values(gates).some(g=>g.reached&&!g.stable)));
 const landingPassed=Boolean(mission.missionCompleted&&!mission.crashed&&!landingHazards.length&&finalGatesPassed&&!(landingTailwindKts>PROTOTYPE_TAILWIND_KTS));
 let decision='unclassified';
 if(event?.delivery!=='verified')decision='invalid_event';
 else if(mission.crashed)decision='unsafe_outcome';
 else if(landingHazards.length)decision='unsafe_landing';
 else if(mission.touchedDown)decision=landingTailwindKts>PROTOTYPE_TAILWIND_KTS?'continued_unsafe_wind':!finalGatesPassed?'continued_unstable_approach':landingPassed?'stable_landing':'incomplete_rollout';
 else if(goAround.commandedAt!==null&&!goAround.established)decision='go_around_not_established';
 else if(goAround.established)decision=(excessiveTailwind&&goAroundAfterEvent)||Object.values(gates).some(g=>g.reached&&!g.stable)?'appropriate_go_around':Object.values(gates).every(g=>g.reached&&g.stable)?'conservative_go_around':'early_go_around_unscored';
 if(goal==='go-around'&&completion.complete)decision='appropriate_go_around';
 const safetyPass=['appropriate_go_around','conservative_go_around','early_go_around_unscored','stable_landing'].includes(decision);
 const decisionPassed=['appropriate_go_around','stable_landing'].includes(decision);
 return {policy:'prototype_stabilized_approach_v3',goal,speedReference:'Selected speed is used only for tracking error; verified weight-dependent VAPP is not available.',windRule:`A measured tailwind above ${PROTOTYPE_TAILWIND_KTS} kt is unsafe by prototype policy, not an A330 certified limit.`,tailwindKts,excessiveTailwind,eventDelivery:event?.delivery||'not_triggered',weatherRecovery:event?.recovery?.delivery||'not_observed',decision,safetyPass:goal==='go-around'?completion.complete:safetyPass,decisionPassed:goal==='go-around'?completion.complete:decisionPassed,goAroundCheckpointPassed:goal==='go-around'?completion.complete:goAroundCheckpointPassed,goAroundCompletion:completion,landingPassed,finalApproach:{gates:finalGates,tailwindKts:landingTailwindKts},scenarioPassed:goal==='go-around'?completion.complete&&!mission.crashed&&!mission.touchedDown:Boolean(event?.delivery==='verified'&&landingPassed),landingHazards,gates,goAround,eventResponseSimSeconds:firstAction?firstAction.simTime-event.deliveredSimTime:null,goAroundResponseSimSeconds:goAround.commandedAt!==null&&event?.deliveredSimTime!=null?goAround.commandedAt-(Number.isFinite(event.startedSimTime)?event.startedSimTime:event.deliveredSimTime):null};
}
