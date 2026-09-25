import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

test('gateway begins only after resume verification and records interruption before cleanup pause',async()=>{
 const source=fs.readFileSync(new URL('./scenario.mjs',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('async function start(){'),source.indexOf('\nfunction rows('));
 const {evaluationInterruption}=await import('./evaluation-lifecycle.mjs');
 const events=[],order=[],saved=new Map();let handle,bindReady,resumeReady,reads=0;
 let op={phase:'READY',scenarioId:'weather-challenge',run:'/test/run',activeRunway:'10R',nav:{runway:'10R'}};
 const context={
  path,ROOT:'/test',HERE:'/test',currentRun:null,args:['--preflight'],
  chosenScenario:()=>({id:'weather-challenge',kind:'weather',goal:'go-around'}),status:async()=>({ready:true}),
  state:()=>op,update:patch=>{op={...op,...patch};},save:(file,value)=>saved.set(file,value),
  fs:{openSync:()=>1,writeSync(){},closeSync(){},readFileSync:()=> 'Use cockpit tools.',unlinkSync(){}},
  crypto:{randomBytes:()=>({toString:()=> 'test-token'})},process:{pid:123,once(){}},
  http:{createServer:callback=>{handle=callback;return {once(){},listen(_port,_host,callback){bindReady=callback;},close(){order.push('close');}};}},
  api:{resume:()=>new Promise(resolve=>{resumeReady=()=>{order.push('resume-verified');resolve();};}),pause:async()=>{order.push('cleanup-pause');}},
  sleep:()=>new Promise(resolve=>setTimeout(resolve,1)),CFG:{airport:'KPDX',agentPort:8087,sampleIntervalMs:300,atc:{},event:{}},
  observe:async()=>reads++===0?{simTime:3,paused:1,simSpeed:0,fuelKg:1000,missing:[]}:{simTime:62,paused:1,simSpeed:0,fuelKg:990,missing:[]},
  stamp:simTime=>({simTime}),log:(type,event)=>{events.push({type,event});order.push(event.type);},console:{log(){}},
  evaluationInterruption,assessMission:()=>({missionCompleted:false}),rows:()=>[],assessWeatherRun:()=>({eventDelivery:'not_triggered'}),
  checkProtected:()=>[],scoreEvaluation:()=>({score:null}),restoreWeather:async()=>{}
 };
 vm.createContext(context);vm.runInContext(fn,context);
 const started=context.start();
 const until=async predicate=>{for(let i=0;i<1000&&!predicate();i++)await new Promise(resolve=>setTimeout(resolve,1));assert.ok(predicate(),'test stage reached');};
 await until(()=>bindReady);
 assert.equal(saved.has('/test/agent-access.json'),false,'access must not be advertised before binding');
 bindReady();await until(()=>saved.has('/test/agent-access.json'));
 let response;
 const begin=handle({method:'POST',url:'/begin',headers:{authorization:'Bearer test-token'}},{setHeader(){},writeHead(){},end(value){response=JSON.parse(value);order.push('begin-acknowledged');}});
 await until(()=>resumeReady);assert.equal(response,undefined,'first action must wait for resume');
 resumeReady();await begin;await started;
 assert.equal(response.accepted,true);
 assert.ok(order.indexOf('resume-verified')<order.indexOf('begin-acknowledged'));
 assert.ok(order.indexOf('evaluation_interrupted')<order.indexOf('cleanup-pause'));
 const result=saved.get('/test/run/result.json');
 assert.equal(result.outcome,'interrupted_or_time_changed');
 assert.equal(result.termination.observed.simTime,62);
 assert.equal(result.termination.observed.paused,1);
 assert.match(result.termination.message,/source is not identified/);
 assert.equal(events.filter(row=>row.event.type==='evaluation_ending').length,1);
});
