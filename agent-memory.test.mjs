import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentMemory,compactObservation,compactOutcome} from './agent-memory.mjs';
test('flight history keeps timed progress and mode changes with fixed bounds',()=>{
 const m=new AgentMemory();
 for(let t=0;t<=500;t++)m.ingest({state:{simTime:t,altitudeIndicatedFt:3000-t,iasKts:230-t/10,headingMag:270,vsiFpm:-600,gsMode:t<495?2:0}});
 assert.equal(m.samples.length,6);assert.equal(m.samples[0].time,450);
 assert.match(m.render(),/495 .*gsMode:2>0/);
 assert.match(m.render(),/450 2550 185 270 -600/);
 m.ingest({state:{simTime:100,gsMode:2}});assert.equal(m.lastFlightSample.time,500);
 for(let t=501;t<600;t++)m.ingest({state:{simTime:t,gsMode:t%2}});
 assert.equal(m.flightEvents.length,4);assert.equal(m.samples.length,6);
});
test('clearance survives removal from live messages and hundreds of later actions',()=>{
 const memory=new AgentMemory();
 const message={id:'change',simTime:20,text:'Use runway 28L.',acknowledged:false};
 memory.ingest({messages:[message]});memory.ingest({messages:[{...message,acknowledged:true}]});
 for(let step=1;step<=500;step++)memory.record({step,observation:{messages:[]},latestBeforeExecution:{state:{simTime:step},messages:[]},discardedFor:[],decision:{assessment:'Monitor.',actions:[{action:'heading',value:270}]},results:[{accepted:true,outcome:{status:'satisfied'}}]});
 const text=memory.render();assert.match(text,/id=change.*acknowledged: Use runway 28L/);
 assert.equal(text.match(/Use runway 28L/g).length,1);assert.equal(memory.recent.length,12);assert.equal(memory.latest.size,1);
 assert.match(text,/heading:satisfied=500/);
});
test('compaction retains unknowns, warnings, units and useful precision without mutating raw state',()=>{
 const o={state:{lat:45.123456789,iasKts:160.12345,warning:1,missing:['nav1'],nav1:null,throttles:[.53,.53,0,0],reversers:[0,0,0],windSpeedKts:[0,8,-1],windDirectionDeg:[0,280,0]},budget:{decisionsRemaining:9}};
 const text=compactObservation(o);assert.match(text,/lat=45.123457/);assert.match(text,/iasKts=160.12/);assert.match(text,/warning=1/);assert.match(text,/nav1=null/);assert.match(text,/missing=\["nav1"\]/);assert.match(text,/"speedKts":0/);assert.equal(o.state.throttles.length,4);
 const result={accepted:true,outcome:{status:'satisfied',observation:o}};
 assert.deepEqual(compactOutcome(result),{accepted:true,status:'satisfied'});assert.equal(result.outcome.observation,o);
});
