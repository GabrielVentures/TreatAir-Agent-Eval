#!/usr/bin/env node
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

export function parseDecision(text){
 const cleaned=String(text??'').trim().replace(/^```json\s*/,'').replace(/\s*```$/,'');
 if(!cleaned)throw new Error('Decision response contained no output text');
 return JSON.parse(cleaned);
}

export function responseOutputText(response){
 if(typeof response?.output_text==='string'&&response.output_text.trim())return response.output_text;
 const parts=[];
 for(const item of response?.output||[])for(const content of item?.content||[])if(content?.type==='output_text'&&typeof content.text==='string')parts.push(content.text);
 return parts.join('');
}

export function flightTools(controls){
 return Object.entries(controls).map(([name,c])=>{
  const value={type:c.valueType||'number'};
  if(c.values)value.enum=c.values;
  if(c.min!==undefined)value.minimum=c.min;
  if(c.max!==undefined)value.maximum=c.max;
  const intent={type:'string',minLength:1,maxLength:240,description:'Brief operator-facing statement of the immediate purpose of this action. One short sentence, not detailed reasoning.'};
  return {type:'function',name,description:c.description||name,strict:true,parameters:{type:'object',properties:c.requiresValue?{intent,value}:{intent},required:c.requiresValue?['intent','value']:['intent'],additionalProperties:false}};
 });
}
export async function decide({backend='codex',model,reasoning='low',prompt,cacheableInstructions,tools,toolHistory=[],schemaPath,cwd=process.cwd(),timeoutMs=120000,fetchImpl=globalThis.fetch,env=process.env}){
 if(backend==='codex'){
  const executable=env.CODEX_BIN||'codex';
  const run=spawnSync(executable,['exec','--ephemeral','--ignore-user-config','--ignore-rules','--skip-git-repo-check','--sandbox','read-only','--model',model,'-c',`model_reasoning_effort="${reasoning}"`,'--output-schema',schemaPath,'-'],{cwd,input:prompt,encoding:'utf8',timeout:timeoutMs,maxBuffer:4*1024*1024});
  if(run.status!==0)throw new Error(`Codex decision failed (${run.status}): ${run.error?.message||run.stderr||run.stdout}`);
  return {decision:parseDecision(run.stdout),transport:{backend:'codex',status:'completed',usage:null,responseId:null}};
 }
 if(backend!=='api')throw new Error(`Unsupported decision backend: ${backend}`);
 if(!env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is required for --backend api');
 const schema=tools?null:JSON.parse(fs.readFileSync(schemaPath,'utf8'));
 // GPT-5.6+ caches at message boundaries. Keep the changing flight state
 // outside the reusable developer prefix and avoid writing transient suffixes.
 const version=/^gpt-(\d+)(?:\.(\d+))?(?:-|$)/.exec(model);
 const explicitCache=Boolean(tools&&cacheableInstructions&&version&&(Number(version[1])>5||(Number(version[1])===5&&Number(version[2])>=6)));
 const nativeContext=cacheableInstructions?{
  ...(explicitCache?{prompt_cache_options:{mode:'explicit'}}:{}),
  input:[{role:'developer',content:[{type:'input_text',text:cacheableInstructions,...(explicitCache?{prompt_cache_breakpoint:{mode:'explicit'}}:{})}]},...toolHistory,{role:'user',content:prompt}]
 }:{instructions:prompt,input:toolHistory.length?toolHistory:[{role:'user',content:'Continue the mission using the current observation.'}]};
 const started=Date.now();
 const request={
  method:'POST',
  headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
  body:JSON.stringify({model,reasoning:{effort:reasoning},...(tools?{...nativeContext,tools,tool_choice:'auto',parallel_tool_calls:false,include:['reasoning.encrypted_content'],text:{verbosity:'low'}}:{input:prompt,text:{verbosity:'low',format:{type:'json_schema',name:'flight_decision',strict:true,schema}}}),max_output_tokens:4096,service_tier:'default',store:false})
 };
 let response,lastTransportError;
 for(let attempt=0;attempt<2;attempt++){
  try{
   response=await fetchImpl('https://api.openai.com/v1/responses',{...request,signal:AbortSignal.timeout(timeoutMs)});
   if(response.ok||![429,500,502,503,504].includes(response.status))break;
   if(attempt===0){await new Promise(resolve=>setTimeout(resolve,500));continue;}
  }catch(error){
   lastTransportError=error;
   if(attempt===0){await new Promise(resolve=>setTimeout(resolve,500));continue;}
   throw error;
  }
 }
 if(!response)throw lastTransportError||new Error('Responses API transport failed');
 const raw=await response.text();let payload;
 try{payload=raw?JSON.parse(raw):null;}catch{throw new Error(`Responses API returned non-JSON HTTP ${response.status}`);}
 if(!response.ok)throw new Error(`Responses API HTTP ${response.status}: ${payload?.error?.message||raw}`);
 if(payload?.status!=='completed')throw new Error(`Responses API did not complete: ${payload?.status||'unknown'} ${payload?.incomplete_details?.reason||payload?.error?.message||''}`.trim());
 const calls=(payload.output||[]).filter(x=>x.type==='function_call');
 const actions=tools?calls.map(c=>{const args=JSON.parse(c.arguments);return {action:c.name,value:args.value??null,intent:args.intent??'',callId:c.call_id};}):[];
 const decision=tools?{assessment:actions.map(a=>a.intent).filter(Boolean).join(' ')||responseOutputText(payload),actions,waitSeconds:0,done:false}:parseDecision(responseOutputText(payload));
 return {decision,responseItems:payload.output||[],transport:{backend:'api',status:payload.status,responseId:payload.id??null,serviceTier:payload.service_tier??null,usage:payload.usage??null,latencyMs:Date.now()-started}};
}
