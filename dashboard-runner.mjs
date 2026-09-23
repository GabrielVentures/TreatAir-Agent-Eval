#!/usr/bin/env node
// Starts one evaluation requested by the local Flight Control Room. The web
// server owns configuration; this process owns the child processes and never
// exposes provider credentials to the browser or to run records.
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=process.env.XPLANE_SCENARIO_STATE||path.join(HERE,'.state');
const configFile=process.argv[2];
if(!configFile)throw Error('Usage: node dashboard-runner.mjs RUN_CONFIG.json');
const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
const runnerFile=path.join(ROOT,'dashboard-runner.json');
const write=x=>fs.writeFileSync(runnerFile,JSON.stringify({updatedAt:new Date().toISOString(),...x},null,2),{mode:0o600});
const append=(stream,chunk)=>fs.appendFileSync(path.join(ROOT,'dashboard-run.log'),`[${new Date().toISOString()}] ${stream} ${chunk}`,{mode:0o600});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const node=process.execPath;

function providerKey(){
 if(config.backend!=='api')return null;
 if(process.env.OPENAI_API_KEY?.trim())return process.env.OPENAI_API_KEY.trim();
 if(process.platform==='darwin'){
  try{return execFileSync('security',['find-generic-password','-a',process.env.USER||'', '-s','agentakt-openai-api-key','-w'],{encoding:'utf8'}).trim();}
  catch{}
 }
 throw Error('No OPENAI_API_KEY is available. Set it in the dashboard server environment; macOS may alternatively use the agentakt-openai-api-key Keychain entry.');
}
function child(label,args,env){
 const p=spawn(node,args,{cwd:HERE,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
 p.stdout.on('data',x=>append(label+':stdout',x));p.stderr.on('data',x=>append(label+':stderr',x));
 p.once('error',error=>append(label+':error',error.stack+'\n'));
 return p;
}
async function waitForAccess(started){
 const file=path.join(ROOT,'agent-access.json');
 for(let i=0;i<80;i++){
  if(fs.existsSync(file)&&fs.statSync(file).mtimeMs>=started)return;
  await sleep(250);
 }
 throw Error('Scenario gateway did not become ready within 20 seconds. Check dashboard-run.log.');
}

let scenario,agent;
try{
 write({status:'starting',config:{model:config.model,reasoning:config.reasoning,backend:config.backend,contextNames:config.contextNames}});
 const started=Date.now();
 scenario=child('scenario',['scenario.mjs','start','--scenario',config.scenarioId],{});
 await waitForAccess(started);
 const key=providerKey();
 const agentArgs=['flight-agent.mjs','--backend',config.backend,'--model',config.model,'--reasoning',config.reasoning,'--max-decisions',String(config.maxDecisions||80),'--max-post-wait-seconds','0','--guidance-file',config.guidanceFile,'--context-manifest',config.contextManifestFile];
 agent=child('agent',agentArgs,key?{OPENAI_API_KEY:key}:{});
 write({status:'running',scenarioPid:scenario.pid,agentPid:agent.pid,config:{model:config.model,reasoning:config.reasoning,backend:config.backend,contextNames:config.contextNames}});
 const scenarioExitPromise=new Promise(resolve=>scenario.once('close',(code,signal)=>resolve({code,signal})));
 const agentExitPromise=new Promise(resolve=>agent.once('close',(code,signal)=>resolve({code,signal})));
 const first=await Promise.race([scenarioExitPromise.then(exit=>({who:'scenario',exit})),agentExitPromise.then(exit=>({who:'agent',exit}))]);
 // A model process that stops due to an inference failure or decision limit
 // must never leave the live simulator running until the scenario timeout.
 // SIGTERM is handled by scenario.mjs, which pauses X-Plane in its finally block.
 if(first.who==='agent'&&!scenario.killed){append('runner',`Agent exited first: ${JSON.stringify(first.exit)}. Requesting fail-closed scenario shutdown.\n`);scenario.kill('SIGTERM');}
 if(first.who==='scenario'&&!agent.killed){append('runner',`Scenario exited first: ${JSON.stringify(first.exit)}. Stopping agent.\n`);agent.kill('SIGTERM');}
 const [scenarioExit,agentExit]=await Promise.all([scenarioExitPromise,agentExitPromise]);
 write({status:'finished',scenarioExit,agentExit,config:{model:config.model,reasoning:config.reasoning,backend:config.backend,contextNames:config.contextNames}});
}catch(error){
 if(scenario&&!scenario.killed)scenario.kill('SIGTERM');
 if(agent&&!agent.killed)agent.kill('SIGTERM');
 write({status:'failed',error:error.message,config:{model:config.model,reasoning:config.reasoning,backend:config.backend,contextNames:config.contextNames}});
 process.exitCode=1;
}
