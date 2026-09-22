#!/usr/bin/env node
// Local-only Flight Control Room. It reads run artefacts written by the
// scenario gateway and starts explicitly requested setup/evaluation processes.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {configureInstallation,installationSummary,loadConfig} from './installation.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const DASH=path.join(HERE,'dashboard');
const ROOT=process.env.XPLANE_SCENARIO_STATE||path.join(HERE,'.state');
let CFG=loadConfig(path.join(HERE,'config.json'),ROOT);
const portIndex=process.argv.indexOf('--port');
const port=Number(portIndex>=0?process.argv[portIndex+1]:8090);
const csrfToken=crypto.randomBytes(24).toString('hex');
const dashboardOrigins=new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`]);
const models=[
 {id:'gpt-5.4-nano',label:'GPT-5.4 nano',reasoning:['none','low','medium','high','xhigh'],estimate:'~$0.12 / 80 decisions'},
 {id:'gpt-5.4-mini',label:'GPT-5.4 mini',reasoning:['none','low','medium','high','xhigh'],estimate:'usage estimate after first run'},
 {id:'gpt-5.6-sol',label:'GPT-5.6 Sol',reasoning:['none','low','medium','high','max'],estimate:'~$1.60 / 80 decisions'},
 {id:'gpt-5.6-terra',label:'GPT-5.6 Terra',reasoning:['none','low','medium','high','max'],estimate:'~$0.81 / 80 decisions'},
 {id:'gpt-5.6-luna',label:'GPT-5.6 Luna',reasoning:['none','low','medium','high','max'],estimate:'~$0.12 / 80 decisions'},
 {id:'gpt-6-astra',label:'GPT-6 Astra',reasoning:['low','medium','high','xhigh','max'],estimate:'likely >$3 / 80 decisions',requiresConfirmation:true}
];
const contextDir=path.join(ROOT,'dashboard-context');
const contextCatalogFile=path.join(contextDir,'catalog.json');
const operatorFile=path.join(ROOT,'operator.json');
const inheritedApiKey=String(process.env.OPENAI_API_KEY||'').trim();
let dashboardApiKey='';
fs.mkdirSync(contextDir,{recursive:true,mode:0o700});

const readJson=file=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
const writeJson=(file,value)=>{const temp=`${file}.tmp-${process.pid}-${crypto.randomUUID()}`;fs.writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(temp,file);};
const safeRun=run=>typeof run==='string'&&path.resolve(run).startsWith(path.resolve(ROOT)+path.sep)?run:null;
function jsonRows(file){try{return fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);}catch{return [];}}
function tailRows(run,name,limit=80){return run?jsonRows(path.join(run,name)).slice(-limit):[];}
function compactDecision(row){return {step:row.step,simTime:row.latestBeforeExecution?.state?.simTime??row.observation?.state?.simTime,wallTime:row.wallTime,model:row.model,reasoning:row.reasoning,latencyMs:row.inferenceLatencyMs,assessment:row.decision?.assessment,actions:row.decision?.actions||[],results:(row.results||[]).map(x=>({requested:x.requested,accepted:x.accepted,outcome:x.outcome})),discardedFor:row.discardedFor||[],done:row.decision?.done};}
function compactTelemetry(row){if(!row)return null;return {simTime:row.simTime,wallTime:row.wallTime,altitudeFt:Number.isFinite(row.altMslM)?Math.round(row.altMslM/.3048):null,aglFt:Number.isFinite(row.aglM)?Math.round(row.aglM/.3048):null,iasKts:row.iasKts,groundSpeedMps:row.groundSpeedMps,headingTrue:row.headingTrue,headingTarget:row.headingTarget,speedTarget:row.speedTarget,altTarget:row.altTarget,vsiFpm:row.vsiFpm,bank:row.bank,pitch:row.pitch,onGround:row.onGround,hasCrashed:row.hasCrashed,ap1:row.ap1,ap2:row.ap2,athrOn:row.athrOn,navMode:row.navMode,gsMode:row.gsMode,headingMode:row.headingMode,verticalMode:row.verticalMode,flaps:row.flaps,flapsActual:row.flapsActual,gear:row.gear,spoilers:row.spoilers,fuelKg:row.fuelKg,warning:row.warning,caution:row.caution,stall:row.stall,overspeed:row.overspeed,windDirectionDeg:row.windDirectionDeg,windSpeedKts:row.windSpeedKts,track:row.track,runwayFootprint:row.runwayFootprint,runwayExcursion:row.runwayExcursion};}
function stateSnapshot(){
 const operator=readJson(path.join(ROOT,'operator.json'))||{};
 const run=safeRun(operator.run),telemetry=tailRows(run,'telemetry.jsonl',120),decisionRows=run?jsonRows(path.join(run,'model-decisions.jsonl')):[],decisions=decisionRows.slice(-40).map(compactDecision),actions=tailRows(run,'agent-actions.jsonl',100),events=tailRows(run,'events.jsonl',50),recordedMessages=tailRows(run,'messages.jsonl',50);
 const messages=[...recordedMessages,...(operator.lastMessages||[]),...(operator.scenarioMessages||[])].sort((a,b)=>(a.simTime??0)-(b.simTime??0)||(a.sequence??0)-(b.sequence??0));
 const uniqueMessages=[...new Map(messages.map(m=>[m.id||`${m.text}:${m.wallTime}`,m])).values()].slice(-30);
 return {serverTime:new Date().toISOString(),operator:{phase:operator.phase,ready:operator.ready,outcome:operator.outcome,run,activeRunway:operator.activeRunway,setupFailure:operator.setupFailure,setupProgress:operator.setupProgress,mission:operator.mission,event:operator.event,atc:operator.atc,landingHelper:operator.landingHelper},runner:readJson(path.join(ROOT,'dashboard-runner.json')),job:readJson(path.join(ROOT,'dashboard-job.json')),telemetry:telemetry.map(compactTelemetry),decisionTotal:decisionRows.length,decisions,actions:actions.slice(-50),events,messages:uniqueMessages,result:run?readJson(path.join(run,'result.json')):null};
}
function listSituations(){if(!CFG.simRoot)return [];const dir=path.join(CFG.simRoot,'Output','situations');if(!fs.existsSync(dir))return [];return fs.readdirSync(dir).filter(name=>name.endsWith('.sit')).sort().map(name=>({name,path:path.join(dir,name),modifiedAt:fs.statSync(path.join(dir,name)).mtime.toISOString()}));}
function contextCatalog(){const raw=readJson(contextCatalogFile);return Array.isArray(raw?.sources)?raw.sources:[];}
function allContextSources(){const file=path.join(HERE,'AIRCRAFT_REFERENCE.md');return [{id:'builtin-aircraft-reference',name:'A330 adapter reference',kind:'text',contextPath:file,viewPath:file,defaultSelected:true},...contextCatalog()];}
function listContext(){return allContextSources().filter(source=>fs.existsSync(source.contextPath)&&fs.existsSync(source.viewPath)).map(source=>({id:source.id,name:source.name,kind:source.kind,defaultSelected:source.defaultSelected===true,contextPath:source.contextPath,viewUrl:`/api/context-file?id=${encodeURIComponent(source.id)}`}));}
function defaultGuidance(){return fs.readFileSync(path.join(HERE,'OPERATING_INSTRUCTIONS.md'),'utf8');}
function body(req,max=2_500_000){return new Promise((resolve,reject)=>{let data='';req.on('data',chunk=>{data+=chunk;if(data.length>max)req.destroy(new Error('Request too large'));});req.once('end',()=>{try{resolve(data?JSON.parse(data):{});}catch{reject(Error('Expected JSON request body'));}});req.once('error',reject);});}
function send(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(payload));}
function requireLocalControl(req){
 const origin=req.headers.origin;
 if(!origin||!dashboardOrigins.has(origin))throw Error('Control requests must originate from this local dashboard.');
 if(req.headers['x-flight-control-token']!==csrfToken)throw Error('Missing or invalid local control token. Refresh the dashboard and retry.');
}
function evaluationBusy(){const snapshot=stateSnapshot();return snapshot.operator.phase==='EVALUATING'||['starting','running'].includes(snapshot.runner?.status)||snapshot.job?.status==='running';}
function safeName(name){const out=String(name||'context').replace(/[^a-zA-Z0-9._-]/g,'_').replace(/^\.+/,'');if(!out)return 'context.txt';return out;}
function updateOperator(patch){writeJson(operatorFile,{...(readJson(operatorFile)||{}),...patch});}
function keychainApiKeyAvailable(){
 if(process.platform!=='darwin')return false;
 try{execFileSync('security',['find-generic-password','-a',process.env.USER||'', '-s','agentakt-openai-api-key'],{stdio:'ignore',timeout:5000});return true;}catch{return false;}
}
function credentialSummary(){
 if(dashboardApiKey)return {configured:true,source:'dashboard session',sessionKey:true};
 if(inheritedApiKey)return {configured:true,source:'server environment',sessionKey:false};
 if(keychainApiKeyAvailable())return {configured:true,source:'macOS Keychain',sessionKey:false};
 return {configured:false,source:null,sessionKey:false};
}
function launchXPlane(situation){
 if(!CFG.simRoot)return {launched:false,reason:'Configure the X-Plane installation folder first.'};
 if(process.platform!=='darwin')return {launched:false,reason:'Start X-Plane manually, then keep this setup request open.'};
 const app=path.join(CFG.simRoot,'X-Plane.app');
 if(!fs.existsSync(app))return {launched:false,reason:'Configured X-Plane application was not found. Start X-Plane manually.'};
 try{
  // Start X-Plane only. The setup process loads the selected situation after
  // the demo prompts are complete and flight controls can first be paused.
  // Passing --load_smo here as well caused a second A330 reload through the
  // plugin and made setup race two simultaneous situation loads.
  const child=spawn('/usr/bin/open',[app,'--args','--start_running'],{detached:true,stdio:'ignore'});
  child.unref();return {launched:true,pid:child.pid};
 }catch(error){return {launched:false,reason:`Could not launch X-Plane: ${error.message}`};}
}
function requestPause(){
 const child=spawn(process.execPath,['scenario.mjs','pause'],{cwd:HERE,detached:true,stdio:'ignore'});
 child.unref();return child.pid;
}
function cancelSetup(){
 const job=readJson(path.join(ROOT,'dashboard-job.json'));
 if(!job||job.status!=='running'||!['setup','prepare-loaded'].includes(job.kind)||!Number.isInteger(job.pid))return false;
 try{process.kill(job.pid,'SIGTERM');}catch{}
 updateOperator({phase:'SETUP_CANCELLED',ready:false,setupFailure:null,setupProgress:{stage:'setup_cancelled',detail:'Preparation stopped. Click Load & prepare to begin again.',updatedAt:new Date().toISOString()}});
 return true;
}
function parseCommandJson(text){try{return JSON.parse(String(text||'').trim());}catch{return null;}}
function liveReadiness(full=false){
 try{
  const output=execFileSync(process.execPath,['scenario.mjs',full?'status':'readiness'],{cwd:HERE,encoding:'utf8',timeout:15_000});
  const check=JSON.parse(output),paused=full?check.telemetry?.paused===1:check.paused===1;
 return {reachable:true,ready:Boolean(check.ready&&paused),paused,phase:check.phase,checks:check.checks||[],message:check.ready&&paused?'Ready: X-Plane is paused.':'X-Plane is not ready for evaluation.'};
 }catch(error){
  // Polling reports availability; it must not overwrite setup progress or its error.
  return {reachable:false,ready:false,paused:false,phase:'SIMULATOR_UNAVAILABLE',checks:['X-Plane local API unavailable'],message:'X-Plane is unavailable. Start it, then load and prepare a situation.'};
 }
}
function startJob(kind,args){
 const jobFile=path.join(ROOT,'dashboard-job.json');const logFile=path.join(ROOT,'dashboard-job.log');
 const id=crypto.randomUUID(),startedAt=new Date().toISOString();
 const child=spawn(process.execPath,args,{cwd:HERE,stdio:['ignore','pipe','pipe']});
 writeJson(jobFile,{id,kind,status:'running',pid:child.pid,startedAt,args});
 if(['setup','prepare-loaded'].includes(kind))updateOperator({phase:'WAITING_FOR_SIMULATOR',run:null,outcome:null,mission:null,ready:false,setupFailure:null,setupProgress:{stage:'opening_simulator',detail:'Waiting for X-Plane flight controls. Complete Use Demo and Understood if shown.',updatedAt:new Date().toISOString()}});
 let stdout='',stderr='';
 child.stdout.on('data',x=>{stdout+=x;fs.appendFileSync(logFile,x,{mode:0o600});});child.stderr.on('data',x=>{stderr+=x;fs.appendFileSync(logFile,x,{mode:0o600});});
 child.on('close',(code,signal)=>{const current=readJson(jobFile);if(current?.id!==id)return;const result=parseCommandJson(stdout),error=parseCommandJson(stderr)?.error||String(stderr).trim().slice(-2000)||undefined;writeJson(jobFile,{id,kind,status:code===0?'finished':'failed',pid:child.pid,code,signal,startedAt,finishedAt:new Date().toISOString(),args,result,error});});
 return {pid:child.pid,kind};
}
function runConfig(input){
 const model=models.find(x=>x.id===input.model);if(!model)throw Error('Unsupported model');
 if(!model.reasoning.includes(input.reasoning))throw Error('Unsupported reasoning setting for selected model');
 if(input.backend!=='api')throw Error('The Control Room currently runs the direct API backend only.');
 if(model.requiresConfirmation!==true&&input.confirmPaid!==true)throw Error('Confirm paid API use before starting an evaluation.');
 if(model.requiresConfirmation===true&&input.confirmPaid!==true)throw Error('GPT-6 Astra may exceed $3. Confirm its estimated cost before starting.');
 const prompt=String(input.prompt||'').trim();if(prompt.length<100||prompt.length>30_000)throw Error('Operating prompt must be between 100 and 30,000 characters.');
 const available=new Map(listContext().map(x=>[x.contextPath,x]));const selected=Array.isArray(input.contextPaths)?input.contextPaths:[];
 const sources=selected.map(p=>available.get(p)).filter(Boolean).map(x=>({name:x.name,path:x.contextPath}));
 const guidanceFile=path.join(ROOT,'dashboard-guidance.md'),contextManifestFile=path.join(ROOT,'dashboard-context-manifest.json');
 fs.writeFileSync(guidanceFile,prompt,{mode:0o600});writeJson(contextManifestFile,{sources});
 const maxDecisions=Number(input.maxDecisions??80);
 if(!Number.isSafeInteger(maxDecisions)||maxDecisions<1)throw Error('Decision limit must be a positive whole number.');
 return {backend:'api',model:model.id,reasoning:input.reasoning,maxDecisions,guidanceFile,contextManifestFile,contextNames:sources.map(x=>x.name)};
}
async function api(req,res,url){
 if(req.method==='GET'&&url.pathname==='/api/catalog')return send(res,200,{models,situations:listSituations(),recommendedSituation:CFG.simRoot?path.join(CFG.simRoot,CFG.situation):null,contexts:listContext(),defaultPrompt:defaultGuidance(),installation:installationSummary(CFG),credentials:credentialSummary(),csrfToken});
 if(req.method==='GET'&&url.pathname==='/api/snapshot')return send(res,200,stateSnapshot());
 if(req.method==='GET'&&url.pathname==='/api/readiness')return send(res,200,liveReadiness());
 if(req.method==='GET'&&url.pathname==='/api/report'){
  try{const output=execFileSync(process.execPath,['scenario.mjs','report'],{cwd:HERE,encoding:'utf8',timeout:20_000});return send(res,200,JSON.parse(output));}catch(error){return send(res,500,{error:error.message});}
 }
 if(req.method==='POST'&&url.pathname==='/api/context'){
  requireLocalControl(req);
  const input=await body(req);const name=safeName(input.name);let content,viewPath,contextPath,kind='text';
  if(input.encoding==='base64-pdf'){
   viewPath=path.join(contextDir,name.endsWith('.pdf')?name:`${name}.pdf`);fs.writeFileSync(viewPath,Buffer.from(String(input.content||''),'base64'),{mode:0o600});
   contextPath=viewPath.replace(/\.pdf$/i,'.extracted.txt');try{execFileSync('pdftotext',[viewPath,contextPath],{timeout:20_000});}catch{throw Error('PDF extraction failed. Upload a text/Markdown export instead.');}content=fs.readFileSync(contextPath,'utf8');kind='pdf';
  }else {content=String(input.content||'');viewPath=path.join(contextDir,name);contextPath=viewPath;}
  if(content.length<1||content.length>250_000)throw Error('Context must contain 1 to 250,000 characters after extraction.');
  if(kind==='text')fs.writeFileSync(contextPath,content,{mode:0o600});
  const id=crypto.randomUUID(),catalog=contextCatalog();catalog.push({id,name,kind,viewPath,contextPath,addedAt:new Date().toISOString()});writeJson(contextCatalogFile,{sources:catalog});return send(res,201,{saved:{id,name,kind}});
 }
 if(req.method==='POST'&&url.pathname==='/api/configure'){
  requireLocalControl(req);if(evaluationBusy())throw Error('Stop the active setup or evaluation before changing the X-Plane installation.');
  const input=await body(req),result=configureInstallation(String(input.simRoot||'').trim(),CFG,{stateRoot:ROOT});
  if(!result.valid)return send(res,400,{error:result.errors.join('; '),installation:result});
  CFG=loadConfig(path.join(HERE,'config.json'),ROOT);
  return send(res,200,{configured:true,installation:installationSummary(CFG),installed:result.assets});
 }
 if(req.method==='POST'&&url.pathname==='/api/credentials'){
  requireLocalControl(req);if(evaluationBusy())throw Error('Stop the active setup or evaluation before changing provider credentials.');
  const input=await body(req);
  if(input.clear===true){dashboardApiKey='';return send(res,200,{credentials:credentialSummary()});}
  const key=String(input.apiKey||'').trim();
  if(key.length<20||key.length>500||/\s/.test(key))throw Error('Enter a valid API key without spaces.');
  dashboardApiKey=key;return send(res,200,{credentials:credentialSummary()});
 }
 if(req.method==='GET'&&url.pathname==='/api/context-file'){
  const source=listContext().find(item=>item.id===url.searchParams.get('id'));if(!source)return send(res,404,{error:'Context source not found'});
  const entry=allContextSources().find(item=>item.id===source.id),extension=path.extname(entry.viewPath).toLowerCase();const type=extension==='.pdf'?'application/pdf':extension==='.json'?'application/json; charset=utf-8':'text/plain; charset=utf-8';
  res.writeHead(200,{'Content-Type':type,'Content-Disposition':`inline; filename="${entry.name.replace(/"/g,'') }"`,'Cache-Control':'no-store'});return fs.createReadStream(entry.viewPath).pipe(res);
 }
 if(req.method==='POST'&&url.pathname==='/api/setup'){
  requireLocalControl(req);if(evaluationBusy())throw Error('Cannot load a situation while setup or an evaluation is active.');
  const installation=installationSummary(CFG);if(!installation.automaticLoadAvailable)throw Error(`Automatic situation loading is unavailable: situation ${installation.assets?.situation?.status||'missing'}, loader ${installation.assets?.loader?.status||'missing'}. Load the saved flight in X-Plane, then choose Use current flight.`);
  const input=await body(req);const situations=listSituations(),found=situations.find(x=>x.path===input.situation);if(!found)throw Error('Select a situation from the catalog.');
  const launch=launchXPlane(found.path);
  return send(res,202,{accepted:true,launch,job:startJob('setup',['scenario.mjs','setup','--sit',found.path,'--watch-xplane-process'])});
 }
 if(req.method==='POST'&&url.pathname==='/api/prepare-loaded'){
  requireLocalControl(req);if(evaluationBusy())throw Error('Cannot prepare a situation while setup or an evaluation is active.');
  const installation=installationSummary(CFG);if(!installation.manualLoadAvailable)throw Error('Configure a valid X-Plane installation and install the bundled situation first.');
  return send(res,202,{accepted:true,job:startJob('prepare-loaded',['scenario.mjs','setup','--reuse-loaded','--watch-xplane-process'])});
 }
 if(req.method==='POST'&&url.pathname==='/api/run'){
  requireLocalControl(req);
  const prior=readJson(path.join(ROOT,'dashboard-runner.json'));if(['starting','running'].includes(prior?.status))throw Error('An evaluation is already running. Stop it or wait for it to finish.');
  const readiness=liveReadiness(true);if(!readiness.ready||!readiness.paused)throw Error(`Evaluation is locked: ${readiness.checks.join('; ')||readiness.message}`);
  if(!credentialSummary().configured)throw Error('Add an OpenAI API key in Settings before starting an evaluation.');
  const config=runConfig(await body(req)),file=path.join(ROOT,'dashboard-run-config.json');writeJson(file,config);
  const child=spawn(process.execPath,['dashboard-runner.mjs',file],{cwd:HERE,detached:true,stdio:'ignore',env:{...process.env,...(dashboardApiKey?{OPENAI_API_KEY:dashboardApiKey}:{})}});child.unref();return send(res,202,{accepted:true,pid:child.pid,model:config.model,reasoning:config.reasoning});
 }
 if(req.method==='POST'&&url.pathname==='/api/stop'){
  requireLocalControl(req);
  const setupCancelled=cancelSetup();
  const runner=readJson(path.join(ROOT,'dashboard-runner.json'))||{};for(const pid of [runner.agentPid,runner.scenarioPid]){if(Number.isInteger(pid))try{process.kill(pid,'SIGTERM');}catch{}}
  const pausePid=requestPause();return send(res,202,{accepted:true,setupCancelled,pausePid});
 }
 return false;
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,`http://${req.headers.host}`);if(url.pathname.startsWith('/api/')){const done=await api(req,res,url);if(done!==false)return;return send(res,404,{error:'Unknown API endpoint'});}const requested=url.pathname==='/'?'index.html':url.pathname.slice(1);const file=path.resolve(DASH,requested);if(!file.startsWith(path.resolve(DASH)+path.sep))return send(res,403,{error:'Forbidden'});if(!fs.existsSync(file)||!fs.statSync(file).isFile())return send(res,404,{error:'Not found'});res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);}catch(error){send(res,400,{error:error.message});}});
server.listen(port,'127.0.0.1',()=>console.log(`Flight Control Room: http://127.0.0.1:${port}`));
