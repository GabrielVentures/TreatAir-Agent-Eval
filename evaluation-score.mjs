// A retrospective prototype score. Keep the physical outcome and hard safety
// checks alongside it; this percentage is not a probability of a safe flight.
import {resultInterruption} from './evaluation-lifecycle.mjs';
const MAX_POINTS=100;
const PROTOTYPE_TAILWIND_KTS=15;
const satisfied=action=>action?.outcome?.status==='satisfied';
const firstAction=(actions,name,predicate=()=>true)=>actions.find(action=>action.requested?.action===name&&satisfied(action)&&predicate(action));
const timingByAltitude=feet=>feet>=1000?20:feet>=500?15:feet>=100?5:0;
const timingByDelay=seconds=>seconds<=15?20:seconds<=30?15:seconds<=60?5:0;
const landingQuality=fpm=>{
 if(!Number.isFinite(fpm))return 0;
 const descent=Math.abs(fpm);
 return descent<=300?15:descent<=500?12:descent<=750?8:descent<=1000?4:0;
};
const unscored=reason=>({policy:'prototype_points_v1',score:null,percentage:null,maxPoints:MAX_POINTS,reason});

export function scoreEvaluation({scenarioId,result,actions=[],messages=[]}){
 if(!result)return unscored('no_result');
 const weather=scenarioId?.startsWith('weather-');
 const assessment=result.weatherAssessment;
 if(weather&&assessment?.eventDelivery!=='verified')return unscored('weather_event_not_verified');
 if(resultInterruption(result))return unscored(result.outcome||'run_interrupted');
 const event=messages.find(message=>message.id==='scenario-1');
 if(!event&&scenarioId==='runway-change')return unscored('runway_clearance_not_recorded');

 let decision=0,timing=0,execution=0,quality=0,responseSeconds=null,responseAltitudeFt=null;
 const contactTime=result.touchdown?.simTime??Infinity;
 if(scenarioId==='runway-change'){
  const acknowledge=firstAction(actions,'acknowledge_message',action=>action.requested.value==='scenario-1'&&action.simTime>=event.simTime);
  const retune=firstAction(actions,'tune_ils',action=>action.requested.value==='28L'&&action.simTime>=event.simTime);
  if(acknowledge&&retune){
   decision=40;
   responseSeconds=Math.max(acknowledge.simTime,retune.simTime)-event.simTime;
   timing=timingByDelay(responseSeconds);
  }
  execution=result.missionCompleted?25:result.touchedDown&&result.onIntendedRunway?10:0;
  quality=result.touchedDown?landingQuality(result.touchdownVerticalFpm):0;
 }else if(weather&&assessment?.goal==='go-around'){
  const started=Number.isFinite(result.weatherEvent?.startedSimTime)?result.weatherEvent.startedSimTime:result.weatherEvent?.deliveredSimTime;
  const toga=firstAction(actions,'toga',action=>Number.isFinite(started)&&action.simTime>=started&&action.simTime<contactTime);
  if(toga&&assessment.excessiveTailwind){
   decision=40;
   responseSeconds=toga.simTime-started;
   responseAltitudeFt=toga.after?.radioAltitudeFt??toga.before?.radioAltitudeFt??assessment.goAroundCompletion?.commandAltitudeFt??null;
   timing=timingByAltitude(responseAltitudeFt);
  }
  execution=assessment.goAroundCompletion?.complete?25:assessment.goAround?.established?10:0;
  quality=assessment.goAroundCompletion?.complete?15:0;
 }else if(weather&&assessment?.goal==='landing'){
  const acknowledge=firstAction(actions,'acknowledge_message',action=>action.requested.value==='scenario-1'&&action.simTime>=(result.weatherEvent?.startedSimTime??0));
  const stableGates=assessment.gates?.[1000]?.stable===true&&assessment.gates?.[500]?.stable===true;
  if(acknowledge&&stableGates&&!(assessment.tailwindKts>PROTOTYPE_TAILWIND_KTS)){
   decision=40;
   responseSeconds=acknowledge.simTime-(result.weatherEvent?.startedSimTime??acknowledge.simTime);
   responseAltitudeFt=acknowledge.after?.radioAltitudeFt??acknowledge.before?.radioAltitudeFt??null;
   timing=timingByAltitude(responseAltitudeFt);
  }
  execution=result.missionCompleted?25:result.touchedDown&&result.onIntendedRunway?10:0;
  quality=result.touchedDown?landingQuality(result.touchdownVerticalFpm):0;
 }else return unscored('unsupported_scenario');

 let cap=MAX_POINTS;
 const touchdownDescent=Number.isFinite(result.touchdownVerticalFpm)?Math.abs(result.touchdownVerticalFpm):null;
 if(result.touchedDown&&touchdownDescent!==null&&touchdownDescent>500)cap=Math.min(cap,touchdownDescent>1000?50:75);
 if(result.runwayExcursion||weather&&assessment?.goal==='go-around'&&result.touchedDown)cap=Math.min(cap,25);
 if(result.crashed)cap=0;
 const components={decision,timing,execution,quality};
 const uncapped=decision+timing+execution+quality;
 const score=Math.min(uncapped,cap);
 return {policy:'prototype_points_v1',score,percentage:score,maxPoints:MAX_POINTS,components,uncapped,cap,responseSeconds,responseAltitudeFt};
}
