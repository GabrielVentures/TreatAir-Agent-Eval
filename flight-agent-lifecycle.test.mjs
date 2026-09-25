import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';

// Real model-loop process, local fake gateway and decision module. No paid API.
for(const outcome of ['go_around_completed','interrupted_or_time_changed',null])test(`observe connection closure with ${outcome||'no saved result'} is handled correctly`,async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'flight-lifecycle-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const file of ['flight-agent.mjs','agent-memory.mjs','observation-wake.mjs'])fs.copyFileSync(new URL(file,import.meta.url),path.join(dir,file));
 fs.writeFileSync(path.join(dir,'decision-client.mjs'),`export const flightTools=()=>[];export async function decide(){return {decision:{assessment:'Monitor flight',actions:[{action:'observe',value:2,intent:'Monitor flight',callId:'test'}],waitSeconds:0,done:false},transport:{}};}`);
 const state=path.join(dir,'state'),run=path.join(state,'runs','test');fs.mkdirSync(run,{recursive:true});
 const operator=path.join(state,'operator.json');fs.writeFileSync(operator,JSON.stringify({phase:'EVALUATING',run}));
 let observations=0;
 const server=http.createServer((req,res)=>{
  let response={};
  if(req.url==='/instructions')response={mission:'Land at KPDX',operatingInstructions:'Use cockpit tools.'};
  if(req.url==='/begin')response={accepted:true};
  if(req.url==='/observation'){
   observations++;
   if(observations===3){
    if(outcome){fs.writeFileSync(path.join(run,'result.json'),JSON.stringify({outcome}));fs.writeFileSync(operator,JSON.stringify({phase:'FINISHED',run,outcome}));}
    req.socket.destroy();server.close();return;
   }
   response={state:{simTime:10,ap1:1,onGround:0,hasCrashed:0},messages:[],budget:{},communicationRevision:'same'};
  }
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(response));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections();server.close();});
 fs.writeFileSync(path.join(state,'agent-access.json'),JSON.stringify({url:`http://127.0.0.1:${server.address().port}`,token:'test-only',run}));
 const child=spawn(process.execPath,[path.join(dir,'flight-agent.mjs'),'--backend','api','--max-decisions','2'],{env:{...process.env,XPLANE_SCENARIO_STATE:state},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stdout.resume();child.stderr.on('data',x=>stderr+=x);
 t.after(()=>{if(child.exitCode===null)child.kill();});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 if(outcome){assert.equal(code,0,stderr);assert.doesNotMatch(stderr,/triggerUncaughtException/);}
 else {assert.equal(code,1);assert.match(stderr,/"code":"gateway_unavailable"/);}
});
