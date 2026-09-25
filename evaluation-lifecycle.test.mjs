import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluationInterruption,resultInterruption} from './evaluation-lifecycle.mjs';

test('missing timing reads are infrastructure errors, not a reset or operator pause',()=>{
 const sample={simTime:62,paused:0,simSpeed:1,missing:[]},prior={simTime:61};
 assert.equal(evaluationInterruption(sample,prior),null);
 for(const key of ['simTime','paused','simSpeed'])assert.equal(evaluationInterruption({...sample,[key]:null},prior).outcome,'infrastructure_telemetry_failure');
 const interrupted=evaluationInterruption({...sample,paused:1,simSpeed:0},prior);
 assert.equal(interrupted.outcome,'interrupted_or_time_changed');
 assert.equal(interrupted.observed.simTime,62);
 assert.match(interrupted.message,/source is not identified/);
});

test('pre-event interruption is not displayed as a failed go-around',()=>{
 const result={scenarioId:'weather-challenge',outcome:'interrupted_or_time_changed',weatherAssessment:{eventDelivery:'not_triggered',scenarioPassed:false}};
 assert.equal(resultInterruption(result).title,'Run interrupted');
 assert.equal(resultInterruption({...result,outcome:'time_limit'}).title,'Wind test not completed');
 assert.equal(resultInterruption({...result,outcome:'go_around_completed',weatherAssessment:{eventDelivery:'verified',scenarioPassed:true}}),null);
});
