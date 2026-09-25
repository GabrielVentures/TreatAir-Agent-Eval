#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {decide,flightTools} from './decision-client.mjs';
import {AgentMemory,compactObservation,compactOutcome,MEMORY_GUIDANCE} from './agent-memory.mjs';
import {observationWakeReasons} from './observation-wake.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=process.env.XPLANE_SCENARIO_STATE||path.join(HERE,'.state');
const args=process.argv.slice(2);
const flag=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const backend=flag('--backend','codex');
const model=flag('--model','gpt-5.6-luna');
const reasoning=flag('--reasoning','low');
const maxDecisions=Number(flag('--max-decisions','80'));
const maxPostWaitSeconds=Number(flag('--max-post-wait-seconds','0'));
const guidanceFile=flag('--guidance-file',null);
const contextManifestFile=flag('--context-manifest',null);
if(!['codex','api'].includes(backend))throw new Error('--backend must be codex or api');
if(!Number.isInteger(maxDecisions)||maxDecisions<1)throw new Error('--max-decisions must be a positive integer');
if(!Number.isFinite(maxPostWaitSeconds)||maxPostWaitSeconds<0||maxPostWaitSeconds>15)throw new Error('--max-post-wait-seconds must be between 0 and 15');
const schemaPath=path.join(HERE,'flight-decision.schema.json');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const access=JSON.parse(fs.readFileSync(path.join(ROOT,'agent-access.json'),'utf8'));
const headers={Authorization:`Bearer ${access.token}`,'Content-Type':'application/json'};
const call=async(route,method='GET',body)=>{const r=await fetch(access.url+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const text=await r.text();if(!r.ok)throw Error(`${method} ${route}: ${r.status} ${text}`);return JSON.parse(text);};
const operator=()=>JSON.parse(fs.readFileSync(path.join(ROOT,'operator.json'),'utf8'));
const append=(file,x)=>fs.appendFileSync(file,JSON.stringify(x)+'\n',{mode:0o600});
const modeFingerprint=o=>JSON.stringify({ap1:o.state.ap1,ap2:o.state.ap2,athrOn:o.state.athrOn,headingMode:o.state.headingMode,navMode:o.state.navMode,gsMode:o.state.gsMode,verticalMode:o.state.verticalMode,onGround:o.state.onGround,hasCrashed:o.state.hasCrashed});
const staleReasons=(before,after)=>{
 const reasons=[];
 if(before.communicationRevision!==after.communicationRevision)reasons.push('communications_changed');
 if(modeFingerprint(before)!==modeFingerprint(after))reasons.push('major_aircraft_mode_changed');
 if(after.state.simTime<before.state.simTime)reasons.push('simulation_reset');
 return reasons;
};

function readContextSources(file){
 if(!file)return [];
 const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!Array.isArray(manifest.sources))throw Error('Context manifest must contain sources');
 return manifest.sources.map(s=>{
  if(typeof s?.path!=='string'||typeof s?.name!=='string')throw Error('Invalid context source');
  const content=fs.readFileSync(s.path,'utf8').slice(0,50000);
  return {name:s.name,content};
 });
}

function promptFor({instructions,navigation,observation,memory,contextSources}){
 const cacheableInstructions=instructions.operatingInstructions+'\n\nMission: '+instructions.mission+
 '\n\nNavigation information:\n'+JSON.stringify(navigation)+
 '\n\nReference material:\n'+contextSources.map(s=>s.name+'\n'+s.content).join('\n\n')+'\n\n'+MEMORY_GUIDANCE;
 memory.ingest(observation);
 const prompt='Current observation:\n'+compactObservation(observation)+'\n\n'+memory.render();
 return {cacheableInstructions,prompt};
}

let instructions=await call('/instructions');
if(guidanceFile)instructions={...instructions,operatingInstructions:fs.readFileSync(guidanceFile,'utf8')};
const contextSources=readContextSources(contextManifestFile);
const controls=await call('/controls'),navigation=await call('/navigation');
controls.observe={requiresValue:true,valueType:'number',min:0,max:15,description:'Wait up to value wall-clock seconds, 0 to 15. Returns early for communications, automation/flare/rollout or warning changes, landing height thresholds, significant speed/approach deviations, ground contact or crash. Returns wake reasons. Simulation continues during both waiting and model inference; budget both using the recent response latency in the observation. Makes no control changes.'};
const memory=new AgentMemory();
const tools=backend==='api'?flightTools(controls):undefined;
let toolHistory=[];
let finished=false;
let stopReason='decision_limit';
const latencySamples=[];
for(let step=1;step<=maxDecisions;step++){
 let observation;
 try{observation=await call('/observation');}catch(e){stopReason='gateway_end';console.error(`Evaluation gateway ended: ${e.message}`);break;}
 observation.budget={...observation.budget,decisionNumber:step,decisionsCompleted:step-1,decisionsRemaining:maxDecisions-step+1,decisionLimit:maxDecisions};
 observation.budget.recentInferenceSeconds=latencySamples.length?Math.round(latencySamples.at(-1)/100)/10:null;
 observation.budget.recentMaxInferenceSeconds=latencySamples.length?Math.round(Math.max(...latencySamples)/100)/10:null;
 const context=promptFor({instructions,controls,navigation,observation,memory,contextSources});
 const prompt=backend==='codex'?context.cacheableInstructions+'\n\n'+context.prompt+'\nReturn the required decision JSON using these controls: '+JSON.stringify(controls):context.prompt;
 const inferenceStartedAt=new Date().toISOString(),inferenceStartedMs=Date.now();
 let response;
 try{response=await decide({backend,model,reasoning,prompt,cacheableInstructions:context.cacheableInstructions,tools,toolHistory,schemaPath,cwd:HERE});}
 catch(error){console.error(JSON.stringify({type:'agent_failure',error:error.publicFailure||{code:'agent_error',message:'The agent could not start or continue. Check your connection and model settings. Details are in the local run log.'}}));throw error;}
 const {decision,transport,responseItems=[]}=response;
 const inferenceLatencyMs=Date.now()-inferenceStartedMs;
 latencySamples.push(inferenceLatencyMs);if(latencySamples.length>10)latencySamples.shift();
 if(step===1)await call('/begin','POST');
 let latest;
 try{latest=await call('/observation');}catch(e){stopReason='gateway_end';console.error(`Evaluation gateway ended after inference: ${e.message}`);break;}
 const discardedFor=staleReasons(observation,latest);
 const results=[];
 if(!discardedFor.length){
  for(const requested of decision.actions){
   if(requested.action==='observe'){
    const seconds=Number(requested.value);
    if(!Number.isFinite(seconds)||seconds<0||seconds>15){results.push({requested,accepted:false,outcome:{status:'failed',reason:'Expected seconds from 0 to 15'}});continue;}
    const waitStarted=Date.now(),until=waitStarted+seconds*1000;let observed=latest,wakeReasons=[];
    do{observed=await call('/observation');wakeReasons=observationWakeReasons(latest,observed);if(wakeReasons.length||Date.now()>=until)break;await sleep(250);}while(true);
    results.push({requested,accepted:true,outcome:{status:'satisfied',wakeReasons:wakeReasons.length?wakeReasons:['wait_elapsed'],waitedSeconds:(Date.now()-waitStarted)/1000,observation:observed}});continue;
   }
   const body={action:requested.action,value:requested.value};
   try{const result=await call('/action','POST',body);results.push({requested,accepted:true,outcome:result.outcome,state:result.state});}
   catch(e){results.push({requested,accepted:false,outcome:{status:'failed',reason:e.message},error:e.message});}
  }
 }
 const record={wallTime:new Date().toISOString(),step,backend,model,reasoning,inferenceStartedAt,inferenceLatencyMs,observationAgeAtDecisionSeconds:latest.state.simTime-observation.state.simTime,transport,observation,latestBeforeExecution:latest,discardedFor,decision,results};
 const runDir=operator().run;if(runDir)append(path.join(runDir,'model-decisions.jsonl'),record);
 console.log(JSON.stringify({step,backend,model,simTime:latest.state.simTime,inferenceLatencyMs,observationAgeSeconds:record.observationAgeAtDecisionSeconds,discardedFor,assessment:decision.assessment,actions:decision.actions,results:results.map(x=>({requested:x.requested,accepted:x.accepted,outcome:x.outcome})),waitSeconds:decision.waitSeconds,done:decision.done}));
 toolHistory=[...responseItems,...decision.actions.map((requested,index)=>({
  type:'function_call_output',call_id:requested.callId,
  output:JSON.stringify(discardedFor.length?{executed:false,reason:discardedFor}:results[index]?compactOutcome(results[index]): {executed:false})
 }))];
 memory.record(record);
 if(discardedFor.length)continue;
 // Completion is determined by simulator telemetry, never a model's done flag.
 const waitSeconds=Math.min(decision.waitSeconds,maxPostWaitSeconds);
 if(waitSeconds>0)await sleep(waitSeconds*1000);
}
// Reaching the decision cap is an explicit incomplete result, not permission to
// let the simulator continue unobserved. The runner also has a process-level
// fail-closed shutdown in case this gateway call itself is unavailable.
if(!finished){try{await call('/finish','POST',{assessment:'Runner stopped before completing the mission.',reason:stopReason});await sleep(1500);}catch{}}
