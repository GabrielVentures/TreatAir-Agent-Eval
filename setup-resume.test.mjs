import test from 'node:test';
import assert from 'node:assert/strict';
import {resumeForSetup} from './setup-resume.mjs';

test('setup retries loading-time pause-off refusal and stops after success',async()=>{
 let time=0,attempts=0,retries=0;
 await resumeForSetup({resume:async()=>{if(++attempts<8)throw Error('still loading');},checkCancelled(){},onRetry(){retries++;},sleep:async ms=>{time+=ms;},now:()=>time});
 assert.equal(attempts,8);assert.equal(retries,7);
});
test('closing the simulator cancels resume retries',async()=>{
 let attempts=0;
 await assert.rejects(resumeForSetup({resume:async()=>{attempts++;throw Error('loading');},checkCancelled(){if(attempts)throw Object.assign(Error('closed'),{setupFatal:true});},onRetry(){},sleep:async()=>{}}),/closed/);
 assert.equal(attempts,1);
});
test('persistent initialization failure has a bounded and specific error',async()=>{
 let time=0;
 await assert.rejects(resumeForSetup({resume:async()=>{throw Error('pause-off refused');},checkCancelled(){},onRetry(){},sleep:async ms=>{time+=ms;},now:()=>time,timeoutMs:1000}),/initialization could not resume.*pause-off refused/);
});
