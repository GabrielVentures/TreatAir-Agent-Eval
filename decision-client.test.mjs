import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {decide,parseDecision,responseOutputText,flightTools} from './decision-client.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const schemaPath=path.join(here,'flight-decision.schema.json');
const sample={assessment:'Continue monitoring.',actions:[],waitSeconds:0,done:false};

test('exhausted API quota reaches the agent as an actionable public error',async()=>{
 const fetchImpl=async()=>({ok:false,status:429,text:async()=>JSON.stringify({error:{code:'insufficient_quota',message:'You exceeded your current quota'}})});
 await assert.rejects(()=>decide({backend:'api',model:'test',prompt:'test',tools:[],env:{OPENAI_API_KEY:'test-only'},fetchImpl}),error=>{
  assert.equal(error.publicFailure.code,'api_quota');assert.match(error.publicFailure.message,/Add credit/);return true;
 });
});

test('split flight context caches only the stable prefix on GPT-5.6+ and preserves live data',async()=>{
 for(const model of ['gpt-5.6-terra','gpt-5.6-sol','gpt-5.6-luna','gpt-6-astra','gpt-5.4-nano','gpt-5.4-mini']){
  const bodies=[];
  const tools=flightTools({heading:{requiresValue:true,description:'Select heading'}});
  const toolHistory=[{type:'function_call',name:'heading',call_id:'test',arguments:'{"value":270,"intent":"Turn"}'},{type:'function_call_output',call_id:'test',output:'{"accepted":true}'}];
  for(const prompt of ['Current altitude: 3000','Current altitude: 2900'])await decide({backend:'api',model,prompt,cacheableInstructions:'Fixed pilot instructions, navigation and references.',tools,toolHistory,env:{OPENAI_API_KEY:'test'},fetchImpl:async(_url,opts)=>{
   bodies.push(JSON.parse(opts.body));return {ok:true,status:200,text:async()=>JSON.stringify({status:'completed',output:[]})};
  }});
  const explicit=!model.startsWith('gpt-5.4');
  assert.deepEqual(bodies[0].input[0],bodies[1].input[0]);
  assert.deepEqual(bodies[0].tools,bodies[1].tools);
  assert.equal(bodies[0].instructions,undefined);
  assert.deepEqual(bodies[0].input.slice(1,-1),toolHistory);
  assert.equal(bodies[1].input.at(-1).content,'Current altitude: 2900');
  assert.equal(bodies[0].prompt_cache_options?.mode,explicit?'explicit':undefined);
  assert.equal(bodies[0].input[0].content[0].prompt_cache_breakpoint?.mode,explicit?'explicit':undefined);
  assert.equal(bodies[0].input.at(-1).prompt_cache_breakpoint,undefined);
 }
});

test('native functions use typed arguments and preserve tool call IDs and results',async()=>{
 const tools=flightTools({heading:{requiresValue:true,valueType:'number',min:0,max:360,description:'Select heading'},approach:{requiresValue:false,description:'Arm approach'}});
 assert.deepEqual(tools[1].parameters.required,['intent']);
 assert.deepEqual(tools[0].parameters.required,['intent','value']);
 assert.equal(tools[0].parameters.properties.value.maximum,360);
 const toolHistory=[{type:'function_call',name:'heading',call_id:'previous',arguments:'{"value":240}'},{type:'function_call_output',call_id:'previous',output:'{"accepted":true}'}];
 let body;
 const result=await decide({backend:'api',model:'test',prompt:'generic pilot instructions',tools,toolHistory,env:{OPENAI_API_KEY:'test'},fetchImpl:async(_url,opts)=>{
  body=JSON.parse(opts.body);
  return {ok:true,status:200,text:async()=>JSON.stringify({status:'completed',output:[{type:'function_call',name:'heading',call_id:'new',arguments:'{"value":270,"intent":"Turn toward the approach intercept."}'}]})};
 }});
 assert.deepEqual(body.input,toolHistory);
 assert.equal(body.text.format,undefined);
 assert.equal(body.tools[0].type,'function');
 assert.equal(result.decision.actions[0].callId,'new');
 assert.equal(result.decision.actions[0].value,270);
 assert.equal(result.decision.assessment,'Turn toward the approach intercept.');
 assert.equal(result.decision.actions[0].intent,result.decision.assessment);
 assert.equal(result.decision.done,false);
});

test('decision JSON parsing accepts plain and fenced output',()=>{
 assert.deepEqual(parseDecision(JSON.stringify(sample)),sample);
 assert.deepEqual(parseDecision('```json\n'+JSON.stringify(sample)+'\n```'),sample);
});
test('Responses output extraction does not assume the first output item',()=>{
 const payload={output:[{type:'reasoning'},{type:'message',content:[{type:'output_text',text:JSON.stringify(sample)}]}]};
 assert.equal(responseOutputText(payload),JSON.stringify(sample));
});
test('API backend sends strict schema, supports none reasoning, and returns usage',async()=>{
 let request;
 const fetchImpl=async(url,options)=>{request={url,options,body:JSON.parse(options.body)};return {ok:true,status:200,text:async()=>JSON.stringify({id:'resp_test',status:'completed',service_tier:'default',output_text:JSON.stringify(sample),usage:{input_tokens:10,output_tokens:4,total_tokens:14}})};};
 const result=await decide({backend:'api',model:'gpt-5.6-luna',reasoning:'none',prompt:'test',schemaPath,fetchImpl,env:{OPENAI_API_KEY:'test-key'}});
 assert.equal(request.url,'https://api.openai.com/v1/responses');assert.equal(request.body.reasoning.effort,'none');assert.equal(request.body.text.format.type,'json_schema');assert.equal(request.body.text.format.strict,true);assert.equal(request.body.store,false);
 assert.deepEqual(result.decision,sample);assert.equal(result.transport.usage.total_tokens,14);
});
test('API backend fails closed on incomplete response and missing credentials',async()=>{
 await assert.rejects(()=>decide({backend:'api',model:'gpt-5.6-luna',reasoning:'none',prompt:'test',schemaPath,env:{}}),/OPENAI_API_KEY/);
 const fetchImpl=async()=>({ok:true,status:200,text:async()=>JSON.stringify({status:'incomplete',incomplete_details:{reason:'max_output_tokens'}})});
 await assert.rejects(()=>decide({backend:'api',model:'gpt-5.6-luna',reasoning:'none',prompt:'test',schemaPath,fetchImpl,env:{OPENAI_API_KEY:'test'}}),/did not complete/);
});
