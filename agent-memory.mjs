// Prompt memory only. The recorder retains full observations and outcomes.
export const MEMORY_GUIDANCE='Observations use key=value lines with the same field names and units as the aircraft reference. Numeric values are rounded for readability. runwayGeometry.bearingToThresholdMag is the present bearing from the aircraft to the threshold; inboundRunwayCourseMag is the runway approach course and is not a bearing to the runway. distanceTrend and thresholdTrend report whether the aircraft is closing on or moving away from the threshold. positionAlongApproach=beyond_threshold means the aircraft has passed the threshold and continuing the inbound runway course moves farther past it. automation localizer/glideslope values distinguish armed from captured. A330 throttle/reverser arrays contain the two installed engines. An action status verifies only the reported control or mode state unless it explicitly says otherwise; it does not prove that the maneuver is improving the flight path. Communications remain chronological, including superseded instructions; apply the latest applicable clearance. Check fresh state for current execution. Use observe to allow an accepted command time to progress when no new action is needed; it returns early on communications or major mode changes.';

function rounded(value,key){
 if(typeof value!=='number'||!Number.isFinite(value))return value;
 const digits=key==='lat'||key==='lon'?6:2;
 return Number(value.toFixed(digits));
}
function lines(value,prefix=''){
 const out=[];
 for(const [key,v] of Object.entries(value||{})){
  if(key==='wallTime')continue;
  const name=prefix?prefix+'.'+key:key;
  if(Array.isArray(v))out.push(name+'='+JSON.stringify(v.map(x=>rounded(x,key))));
  else if(v&&typeof v==='object')out.push(...lines(v,name));
  else out.push(name+'='+String(rounded(v,key)));
 }
 return out;
}
export function compactObservation(observation){
 const state={...observation.state};
 for(const key of ['throttles','reversers'])if(Array.isArray(state[key]))state[key]=state[key].slice(0,2);
 // Keep each valid weather layer, including calm wind, with its original index.
 if(Array.isArray(state.windSpeedKts)&&Array.isArray(state.windDirectionDeg)){
  state.windLayers=state.windSpeedKts.flatMap((speed,index)=>speed<0?[]:[{index,directionDeg:rounded(state.windDirectionDeg[index],''),speedKts:rounded(speed,'')}]);
  delete state.windSpeedKts;delete state.windDirectionDeg;
 }
 return lines(state).join('\n')+'\nBudget: '+lines(observation.budget).join(' ')+'\nCommunications interface: '+(observation.communications?.mode||'unspecified');
}
export function compactOutcome(result){
 const outcome=result?.outcome||{};
 // observe returns a full snapshot to the recorder; the next prompt supplies
 // fresh state, so do not duplicate its snapshot in history or tool results.
 const {observation,...rest}=outcome;
 return {accepted:result.accepted,...rest};
}
const historyNumber=(v,digits=0)=>Number.isFinite(v)?Number(v.toFixed(digits)):'?';
const modeKeys=['ap1','ap2','athrOn','headingMode','navMode','gsMode','verticalMode','onGround','hasCrashed','warning','caution','stall','overspeed'];
function flightSample(s){
 const modes=modeKeys.map(k=>`${k}=${s[k]??'?'}`).join(' ');
 const runways=Object.entries(s.runwayGeometry||{}).slice(0,2).map(([id,g])=>`${id}:${historyNumber(g.distanceNm,1)},${historyNumber(g.crossTrackM)},${historyNumber(s.approachGeometry?.[id]?.abovePathFt)},${g.distanceTrend||'?'},${g.thresholdTrend||'?'},${g.positionAlongApproach||'?'}`).join(' ');
 return {time:s.simTime,modes,text:`${historyNumber(s.simTime,1)} ${historyNumber(s.altitudeIndicatedFt)} ${historyNumber(s.iasKts)} ${historyNumber(s.headingMag)} ${historyNumber(s.vsiFpm)} ${historyNumber(s.bank)} wind=${historyNumber(s.effectiveWindDirectionDeg)}/${historyNumber(s.effectiveWindSpeedKts)} | ${runways} | AP=${s.ap1??'?'}/${s.ap2??'?'} AT=${s.athrOn??'?'} H/N/G/V=${s.headingMode??'?'}/${s.navMode??'?'}/${s.gsMode??'?'}/${s.verticalMode??'?'}`};
}
export class AgentMemory{
 constructor(){this.messages=new Map();this.recent=[];this.latest=new Map();this.failures=[];this.counts=new Map();this.intent='';this.samples=[];this.flightEvents=[];this.lastFlightSample=null;}
 ingest(observation){
  for(const m of observation.messages||[]){
   const key=String(m.id)+'\n'+m.text;
   this.messages.set(key,{id:m.id,simTime:m.simTime,sender:m.sender,source:m.source,text:m.text,acknowledged:m.acknowledged});
  }
  const s=observation.state;
  if(!s||!Number.isFinite(s.simTime))return;
  const sample=flightSample(s),previous=this.lastFlightSample;
  // Ignore re-ingested observations from before execution. No backwards history.
  if(previous&&sample.time<=previous.time)return;
  if(previous&&sample.modes!==previous.modes){
   const old=Object.fromEntries(previous.modes.split(' ').map(x=>x.split('=')));
   const changes=modeKeys.filter(k=>String(s[k]??'?')!==old[k]).map(k=>`${k}:${old[k]}>${s[k]??'?'}`).join(' ');
   this.flightEvents.push({time:sample.time,text:sample.text+' | '+changes});
   this.flightEvents=this.flightEvents.slice(-4);
  }
  // Six time-spaced samples, not six nearly identical fast tool calls.
  if(!this.samples.length||sample.time-this.samples.at(-1).time>=10){this.samples.push(sample);this.samples=this.samples.slice(-6);}
  this.lastFlightSample=sample;
 }
 record(record){
  this.ingest(record.observation);this.ingest(record.latestBeforeExecution);
  this.intent=record.decision.assessment||this.intent;
  for(const [index,a] of record.decision.actions.entries()){
   const result=record.results[index];if(result?.outcome?.observation)this.ingest(result.outcome.observation);
   if(result?.state)this.ingest({state:result.state});
   const discarded=record.discardedFor?.length;
   const status=discarded?'not_executed':result?.outcome?.status||'unknown';
   const detail=discarded?record.discardedFor.join(','):status==='satisfied'?'':result?.outcome?.reason||result?.error||'';
   const entry={step:record.step,text:`${Math.round(record.latestBeforeExecution.state.simTime)}s ${a.action}${a.value==null?'':' '+a.value}: ${status}${detail?' ('+detail+')':''}`};
   if(a.action!=='observe'){
    this.recent.push(entry);this.recent=this.recent.slice(-12);
    if(!discarded)this.latest.set(a.action,entry);
   }
   if(discarded||result?.accepted===false||status==='failed'){this.failures.push(entry);this.failures=this.failures.slice(-6);}
   const key=a.action+':'+status;this.counts.set(key,(this.counts.get(key)||0)+1);
  }
 }
 render(){
  const entries=[...new Map([...this.latest.values(),...this.recent,...this.failures].map(e=>[e.step+' '+e.text,e])).values()].sort((a,b)=>a.step-b.step);
  return 'Communications (retained):\n'+[...this.messages.values()].map(m=>`${Math.round(m.simTime||0)}s id=${m.id} ${m.sender||m.source||''} ${m.acknowledged?'acknowledged':'UNACKNOWLEDGED'}: ${m.text}`).join('\n')+
   '\nLast stated intent: '+this.intent+'\nAction memory (latest per control, recent actions and recent failures):\n'+entries.map(e=>e.text).join('\n')+
   '\nCumulative action counts: '+[...this.counts].map(([k,n])=>k+'='+n).join(' ')+
   '\nFlight history (sampled, not continuous; ?=unknown). Columns: simSeconds altitudeFt IASkt magneticHeadingDeg verticalSpeedFpm bankDeg windFromTrueDeg/windKt | runway:distanceNM,signedCrossTrackM,abovePathFt,distanceTrend,thresholdTrend,position | AP1/AP2 autothrust heading/nav/glideslope/vertical mode codes.\n'+
   this.samples.map(s=>s.text).join('\n')+'\nRecent mode/warning changes (old>new):\n'+this.flightEvents.map(s=>s.text).join('\n');
 }
}
