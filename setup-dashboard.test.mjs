import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';

test('concurrent Start requests cannot spawn two evaluation runners',async()=>{
 const source=fs.readFileSync(new URL('./dashboard.mjs',import.meta.url),'utf8');
 const apiSource=source.slice(source.indexOf('async function api('),source.indexOf('const mime='));
 const pending=[];let launches=0,runner=null;
 const context={path,ROOT:'/test',HERE:'/test',operatorFile:'/test/operator.json',process:{execPath:'node',env:{}},dashboardApiKey:'',startingEvaluation:false,
  requireLocalControl:()=>{},readJson:file=>file.endsWith('dashboard-runner.json')?runner:{scenarioId:'weather-challenge'},
  liveReadiness:()=>({ready:true,paused:true}),credentialSummary:()=>({configured:true}),
  evaluationBusy:()=>Boolean(runner&&['starting','running'].includes(runner.status)),
  runConfig:input=>input,body:()=>new Promise(resolve=>pending.push(resolve)),
  writeJson:(file,value)=>{if(file.endsWith('dashboard-runner.json'))runner=value;},
  spawn:()=>{launches++;return {pid:123,once(){},unref(){}};},send:()=>{}
 };
 vm.createContext(context);vm.runInContext(apiSource,context);
 const request={method:'POST'},url={pathname:'/api/run'};
 const first=context.api(request,{},url),second=context.api(request,{},url);
 const done=Promise.allSettled([first,second]);
 for(const resolve of pending)resolve({scenarioId:'weather-challenge'});
 const results=await done;
 assert.equal(launches,1,'only one runner may own the shared operator and result files');
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.match(results.find(result=>result.status==='rejected').reason.message,/already active/);
 assert.equal(context.startingEvaluation,false);
});

test('overlapping preparation requests cannot start competing setup processes',async()=>{
 const source=fs.readFileSync(new URL('./dashboard.mjs',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('async function api('),source.indexOf('const mime='));
 for(const route of ['/api/setup','/api/prepare-loaded']){
  const pending=[];let launched=0;
  const context={requireLocalControl(){},evaluationBusy:()=>launched>0,CFG:{},installationSummary:()=>({automaticLoadAvailable:true,manualLoadAvailable:true}),
   body:()=>new Promise(resolve=>pending.push(resolve)),scenarioProfile:id=>({id}),listSituations:()=>[{path:'test.sit'}],launchXPlane:()=>({}),
   startJob:()=>{launched++;return {};},send:()=>{}
  };
  vm.createContext(context);vm.runInContext(fn,context);
  const calls=[context.api({method:'POST'},{},{pathname:route}),context.api({method:'POST'},{},{pathname:route})];
  const done=Promise.allSettled(calls);for(const resolve of pending)resolve({scenarioId:'weather-challenge',situation:'test.sit'});
  const results=await done;assert.equal(launched,1);assert.equal(results.filter(result=>result.status==='rejected').length,1);
 }
});

test('dashboard refresh cannot enable Start while its request is pending',()=>{
 const source=fs.readFileSync(new URL('./dashboard/app.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('function renderSetupState('),source.indexOf('function renderMeta('));
 const nodes=new Map();
 const context={
  $:selector=>{if(!nodes.has(selector))nodes.set(selector,{});return nodes.get(selector);},
  readableStage:()=>'',setupRequestError:null,startingRun:true,startRequestPending:true,
  readiness:{checked:true,reachable:true,ready:true,paused:true},
  catalog:{scenarios:[],situations:['test.sit'],installation:{automaticLoadAvailable:true,manualLoadAvailable:true}}
 };
 vm.createContext(context);vm.runInContext(fn,context);
 const snapshot={operator:{phase:'READY'},job:{status:'finished'},runner:{status:'failed'}};
 context.renderSetupState(snapshot);assert.equal(nodes.get('#start-run').disabled,true);
 context.startingRun=false;context.renderSetupState(snapshot);assert.equal(nodes.get('#start-run').disabled,true);
 context.startRequestPending=false;context.renderSetupState(snapshot);assert.equal(nodes.get('#start-run').disabled,false);
});

test('interrupted weather result explains the stop without calling the go-around a failure',()=>{
 const source=fs.readFileSync(new URL('./dashboard/app.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('function renderResults('),source.indexOf('function readableStage('));
 const nodes=new Map(),context={
  $:selector=>{if(!nodes.has(selector))nodes.set(selector,{replaceChildren(...children){this.children=children;}});return nodes.get(selector);},
  el:(tag,className,text)=>({text}),result:(label,value)=>({label,value}),failureReasons:()=>[],compact:JSON.stringify
 };
 vm.createContext(context);vm.runInContext(fn,context);
 context.renderResults({telemetry:[],result:{outcome:'interrupted_or_time_changed',interruption:{title:'Run interrupted',detail:'The simulator paused before the wind event.'},weatherAssessment:{goal:'go-around',eventDelivery:'not_triggered',scenarioPassed:false}}});
 assert.equal(nodes.get('#result-summary').children[0].text,'Run interrupted');
 assert.equal(nodes.get('#results').children.find(item=>item.label==='Outcome').value,'Not evaluated');
 assert.equal(nodes.get('#results').children.find(item=>item.label==='Prototype score').value,'not scored');
 assert.doesNotMatch(JSON.stringify(nodes.get('#result-summary')),/Go-around not completed/);
});

test('prepare buttons preserve the selected scenario across a setup redraw',async()=>{
 const source=fs.readFileSync(new URL('./dashboard/app.js',import.meta.url),'utf8');
 for(const button of ['prepare-loaded','load-situation']){
  const line=source.split('\n').find(row=>row.includes(`$('#${button}').addEventListener`));
  let click,payload;
  const scenario={value:'weather-challenge'},situation={value:'test.sit'};
  const context={
   $:selector=>selector==='#scenario'?scenario:selector==='#situation'?situation:{addEventListener:(_,fn)=>{click=fn;}},
   showSetupStarting:()=>{scenario.value='';},
   request:async(_,options)=>{payload=JSON.parse(options.body);return {job:{pid:123}};},
   status:()=>{},refresh:async()=>{},showStage:()=>{}
  };
  vm.runInNewContext(line,context);
  await click();
  assert.equal(payload.scenarioId,'weather-challenge');
 }
});

test('preparation clears prior evaluation error before starting the setup child',()=>{
 const source=fs.readFileSync(new URL('./dashboard.mjs',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('function startJob('),source.indexOf('function runConfig('));
 for(const kind of ['setup','prepare-loaded']){
  const writes=[];let operator;
  const context={path,ROOT:'/test',HERE:'/test',process:{execPath:'node'},crypto:{randomUUID:()=> 'test-id'},
   writeJson:(file,value)=>writes.push({file,value}),updateOperator:value=>{operator=value;},
   spawn:()=>{
    assert.equal(writes[0].value.status,'idle');
    assert.equal(operator.phase,'WAITING_FOR_SIMULATOR');
    assert.equal(operator.ready,false);
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.pid=123;return child;
   }};
  vm.runInNewContext(fn+`;startJob('${kind}',[]);`,context);
  assert.equal(writes[1].value.status,'running');
 }
});
