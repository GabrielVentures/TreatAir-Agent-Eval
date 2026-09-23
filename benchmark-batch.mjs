#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {scenarioProfile} from './scenario-profiles.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=process.env.XPLANE_SCENARIO_STATE||path.join(HERE,'.state');
const BATCH_ROOT=path.join(HERE,'benchmark-batches');
const stamp=new Date().toISOString().replaceAll(':','-').replace(/\.\d{3}Z$/,'Z');
const batchDir=path.join(BATCH_ROOT,stamp);
const fullSchedule=[
  {round:1,model:'gpt-5.6-luna'},
  {round:1,model:'gpt-5.6-terra'},
  {round:1,model:'gpt-5.6-sol'},
  {round:2,model:'gpt-5.6-terra'},
  {round:2,model:'gpt-5.6-sol'},
  {round:2,model:'gpt-5.6-luna'},
  {round:3,model:'gpt-5.6-sol'},
  {round:3,model:'gpt-5.6-luna'},
  {round:3,model:'gpt-5.6-terra'}
];
const cli=process.argv.slice(2);
const flag=(name,fallback)=>{const i=cli.indexOf(name);return i<0?fallback:cli[i+1];};
const only=flag('--only',null);
const requestedModel=flag('--model',null);
const requestedRuns=Number(flag('--runs','3'));
const backend=flag('--backend','codex');
const reasoning=flag('--reasoning','low');
const scenarioId=scenarioProfile(flag('--scenario','runway-change')).id;
const maxDecisions=Number(flag('--max-decisions',reasoning==='none'?'300':'80'));
const maxPostWaitSeconds=Number(flag('--max-post-wait-seconds','0'));
const guidanceFile=flag('--guidance-file',fs.existsSync(path.join(ROOT,'dashboard-guidance.md'))?path.join(ROOT,'dashboard-guidance.md'):null);
const contextManifestFile=flag('--context-manifest',fs.existsSync(path.join(ROOT,'dashboard-context-manifest.json'))?path.join(ROOT,'dashboard-context-manifest.json'):null);
if(!Number.isInteger(requestedRuns)||requestedRuns<1)throw new Error('--runs must be a positive integer');
if(!['codex','api'].includes(backend))throw new Error('--backend must be codex or api');
if(!Number.isFinite(maxPostWaitSeconds)||maxPostWaitSeconds<0||maxPostWaitSeconds>15)throw new Error('--max-post-wait-seconds must be between 0 and 15');
const modelAliases={luna:'gpt-5.6-luna',terra:'gpt-5.6-terra',sol:'gpt-5.6-sol'};
if(only&&!Object.hasOwn(modelAliases,only))throw new Error('--only must be luna, terra or sol');
if(only&&requestedModel)throw new Error('Use either --only or --model, not both');
const schedule=requestedModel
  ? Array.from({length:requestedRuns},(_,i)=>({round:i+1,model:requestedModel}))
  : only
  ? Array.from({length:requestedRuns},(_,i)=>({round:i+1,model:modelAliases[only]}))
  : fullSchedule;

fs.mkdirSync(batchDir,{recursive:true});
function providerKey(){
 if(backend!=='api')return null;
 if(process.env.OPENAI_API_KEY?.trim())return process.env.OPENAI_API_KEY.trim();
 if(process.platform==='darwin')try{return execFileSync('security',['find-generic-password','-a',process.env.USER||'', '-s','agentakt-openai-api-key','-w'],{encoding:'utf8'}).trim();}catch{}
 throw new Error('No OPENAI_API_KEY is available for API benchmark runs.');
}
const apiKey=providerKey();
const run=(args,options={})=>spawnSync(process.execPath,args,{cwd:HERE,encoding:'utf8',maxBuffer:16*1024*1024,timeout:options.timeout||600000,env:{...process.env,...(apiKey?{OPENAI_API_KEY:apiKey}:{})}});
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const writeJson=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const slug=model=>model.replace(/^gpt-[\d.]+-/,'');

async function waitFor(predicate,timeoutMs,label){
  const start=Date.now();
  while(Date.now()-start<timeoutMs){if(await predicate())return;await sleep(250);}
  throw new Error(`Timed out waiting for ${label}`);
}

async function one(spec,index){
  const id=`${String(index+1).padStart(2,'0')}-r${spec.round}-${slug(spec.model)}-${reasoning}-${backend}`;
  const dir=path.join(batchDir,id);fs.mkdirSync(dir,{recursive:true});
  console.log(JSON.stringify({type:'run_start',id,index:index+1,total:schedule.length,...spec,backend,reasoning}));

  // Reposition and reconfigure the already loaded A330 without forcing a full
  // scenery/Metal reload between trials. Full reloads are both slower and have
  // produced unrelated GPU device-loss crashes on this machine.
  const setup=run(['scenario.mjs','setup','--scenario',scenarioId,...(cli.includes('--fresh-setup')?[]:['--reuse-loaded'])],{timeout:600000});
  fs.writeFileSync(path.join(dir,'setup.stdout.log'),setup.stdout||'');
  fs.writeFileSync(path.join(dir,'setup.stderr.log'),setup.stderr||'');
  if(setup.status!==0)throw new Error(`${id}: setup failed: ${setup.stderr||setup.stdout}`);

  const status=run(['scenario.mjs','status']);
  fs.writeFileSync(path.join(dir,'status.json'),status.stdout||'');
  if(status.status!==0)throw new Error(`${id}: status failed: ${status.stderr||status.stdout}`);
  const readiness=JSON.parse(status.stdout);
  if(!readiness.ready)throw new Error(`${id}: scenario not ready: ${JSON.stringify(readiness.checks)}`);

  const beforeAccess=fs.existsSync(path.join(ROOT,'agent-access.json'))?fs.statSync(path.join(ROOT,'agent-access.json')).mtimeMs:0;
  const serverOut=fs.openSync(path.join(dir,'scenario.stdout.log'),'w');
  const serverErr=fs.openSync(path.join(dir,'scenario.stderr.log'),'w');
  const server=spawn(process.execPath,['scenario.mjs','start','--scenario',scenarioId,...(cli.includes('--preflight')?['--preflight']:[])],{cwd:HERE,stdio:['ignore',serverOut,serverErr]});
  try{
    await waitFor(()=>fs.existsSync(path.join(ROOT,'agent-access.json'))&&fs.statSync(path.join(ROOT,'agent-access.json')).mtimeMs>beforeAccess,30000,'evaluation gateway');
    const activeRun=readJson(path.join(ROOT,'operator.json')).run;
    const agentArgs=['flight-agent.mjs','--backend',backend,'--model',spec.model,'--reasoning',reasoning,'--max-decisions',String(maxDecisions),'--max-post-wait-seconds',String(maxPostWaitSeconds)];
    if(guidanceFile)agentArgs.push('--guidance-file',guidanceFile);
    if(contextManifestFile)agentArgs.push('--context-manifest',contextManifestFile);
    const agentOut=fs.openSync(path.join(dir,'agent.stdout.log'),'w');
    const agentErr=fs.openSync(path.join(dir,'agent.stderr.log'),'w');
    const agent=spawn(process.execPath,agentArgs,{cwd:HERE,stdio:['ignore',agentOut,agentErr],env:{...process.env,...(apiKey?{OPENAI_API_KEY:apiKey}:{})}});
    const serverClosed=new Promise(resolve=>server.once('close',(code,signal)=>resolve({who:'server',code,signal})));
    const agentClosed=new Promise(resolve=>agent.once('close',(code,signal)=>resolve({who:'agent',code,signal})));
    const firstClosed=await Promise.race([serverClosed,agentClosed]);
    if(firstClosed.who==='server'&&agent.exitCode===null)agent.kill('SIGTERM');
    if(firstClosed.who==='agent'&&server.exitCode===null){
      await Promise.race([serverClosed,sleep(5000)]);
      if(server.exitCode===null)server.kill('SIGTERM');
    }
    const agentExit=await agentClosed;
    await serverClosed;
    fs.closeSync(agentOut);fs.closeSync(agentErr);
    if(agentExit.code!==0&&!fs.existsSync(path.join(activeRun,'result.json'))){
      // The evaluator closes its private action gateway after it has written the
      // final result. A model may race that shutdown with one last tool call.
      // Preserve the completed trial instead of misclassifying this harmless
      // post-finish connection refusal as an infrastructure failure.
      run(['scenario.mjs','pause'],{timeout:15000});
      throw new Error(`Agent transport/process failed; simulator paused: ${fs.readFileSync(path.join(dir,'agent.stderr.log'),'utf8').slice(-1000)}`);
    }
    if(agentExit.code!==0)fs.writeFileSync(path.join(dir,'agent.post-finish-warning.log'),fs.readFileSync(path.join(dir,'agent.stderr.log'),'utf8').slice(-1000));
  }finally{
    if(server.exitCode===null){server.kill('SIGINT');await waitFor(()=>server.exitCode!==null,30000,'scenario shutdown').catch(()=>server.kill('SIGKILL'));}
    fs.closeSync(serverOut);fs.closeSync(serverErr);
  }

  const operator=readJson(path.join(ROOT,'operator.json'));
  const sourceRun=operator.run;
  const result=readJson(path.join(sourceRun,'result.json'));
  const reportRun=run(['scenario.mjs','report']);
  const report=JSON.parse(reportRun.stdout);
  const summary={id,index:index+1,round:spec.round,model:spec.model,backend,reasoning,scenarioId,sourceRun,outcome:result.outcome,scenarioPassed:result.weatherAssessment?.scenarioPassed??result.missionCompleted,score:report.score,weatherAssessment:result.weatherAssessment||null,objectives:report.objectives,metrics:report.metrics,event:report.event};
  writeJson(path.join(dir,'summary.json'),summary);
  console.log(JSON.stringify({type:'run_complete',...summary}));
  return summary;
}

const results=[];
writeJson(path.join(batchDir,'manifest.json'),{createdAt:new Date().toISOString(),backend,reasoning,maxDecisions,maxPostWaitSeconds,guidanceFile,contextManifestFile,scenarioId,preflight:cli.includes('--preflight'),schedule,protocol:'Identical mission, operating instructions, action space, hidden scenario timing, native X-Plane initialization, and evaluator for every run.'});
for(let i=0;i<schedule.length;i++){
  try{results.push(await one(schedule[i],i));}
  catch(error){
    const failure={id:`${String(i+1).padStart(2,'0')}-r${schedule[i].round}-${slug(schedule[i].model)}-${reasoning}-${backend}`,index:i+1,round:schedule[i].round,model:schedule[i].model,backend,reasoning,infrastructureFailure:true,error:error.message};
    results.push(failure);writeJson(path.join(batchDir,'partial-results.json'),results);
    console.log(JSON.stringify({type:'run_error',...failure}));
    try{run(['scenario.mjs','pause']);}catch{}
    writeJson(path.join(batchDir,'results.json'),results);
    console.log(JSON.stringify({type:'batch_aborted',batchDir,reason:'Infrastructure failed before a valid model trial; continuing would not produce benchmark evidence.'}));
    process.exitCode=1;
    break;
  }
  writeJson(path.join(batchDir,'partial-results.json'),results);
}
writeJson(path.join(batchDir,'results.json'),results);
console.log(JSON.stringify({type:'batch_complete',batchDir,results}));
