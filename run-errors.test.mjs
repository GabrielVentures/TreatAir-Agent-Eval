import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {providerFailure,parseAgentFailure} from './run-errors.mjs';

test('quota, authentication and temporary rate limits have distinct safe messages',()=>{
 const quota=providerFailure(429,{error:{code:'insufficient_quota',message:'private provider details'}});
 assert.equal(quota.code,'api_quota');
 assert.match(quota.message,/credit or spending limit/);
 assert.ok(!quota.message.includes('private provider details'));
 assert.equal(providerFailure(429,{error:{code:'rate_limit_exceeded'}}).code,'api_rate_limit');
 assert.equal(providerFailure(401,{}).code,'api_auth');
 assert.equal(parseAgentFailure('unstructured stderr'),null);
 assert.deepEqual(parseAgentFailure('log\n'+JSON.stringify({type:'agent_failure',error:quota})+'\nstack trace'),quota);
});

test('runner publishes quota failure and shuts down the paused preflight scenario',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'flight-quota-test-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const file of ['dashboard-runner.mjs','run-errors.mjs'])fs.copyFileSync(new URL(file,import.meta.url),path.join(dir,file));
 const state=path.join(dir,'state');fs.mkdirSync(state);
 fs.writeFileSync(path.join(dir,'scenario.mjs'),`
  import fs from 'node:fs';import path from 'node:path';
  const root=process.env.XPLANE_SCENARIO_STATE;
  if(!process.argv.includes('--preflight'))process.exit(2);
  fs.writeFileSync(path.join(root,'agent-access.json'),'{}');
  process.on('SIGTERM',()=>{fs.writeFileSync(path.join(root,'paused'),'yes');process.exit(0);});
  setInterval(()=>{},100);
 `);
 const failure=providerFailure(429,{error:{code:'insufficient_quota'}});
 fs.writeFileSync(path.join(dir,'flight-agent.mjs'),`console.error(${JSON.stringify(JSON.stringify({type:'agent_failure',error:failure}))});process.exitCode=1;`);
 const config=path.join(dir,'config.json');fs.writeFileSync(config,JSON.stringify({backend:'api',model:'test',reasoning:'none',scenarioId:'runway-change',guidanceFile:'unused',contextManifestFile:'unused'}));
 const child=spawn(process.execPath,[path.join(dir,'dashboard-runner.mjs'),config],{env:{...process.env,XPLANE_SCENARIO_STATE:state,OPENAI_API_KEY:'test-only'},stdio:'ignore'});
 t.after(()=>{if(child.exitCode===null)child.kill();});
 await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 const result=JSON.parse(fs.readFileSync(path.join(state,'dashboard-runner.json')));
 assert.equal(result.status,'failed');assert.equal(result.errorCode,'api_quota');assert.equal(result.error,failure.message);
 assert.equal(fs.readFileSync(path.join(state,'paused'),'utf8'),'yes');
 assert.equal(result.agentExit.code,1);
 assert.ok(!JSON.stringify(result).includes('test-only'));
});
