import test from 'node:test';
import assert from 'node:assert/strict';
import {scenarioProfile,windPlan,weatherRecoveryStep} from './scenario-profiles.mjs';
test('weather recovery follows simulation time, independent of agent actions',()=>{
 const plan=windPlan(scenarioProfile('weather-challenge'),299);
 assert.equal(weatherRecoveryStep(plan,100,244.9),null);
 assert.equal(weatherRecoveryStep(plan,100,245),0);
 assert.equal(weatherRecoveryStep(plan,100,260),3);
 assert.equal(weatherRecoveryStep(plan,100,275),6);
 assert.equal(weatherRecoveryStep(plan,100,500),6);
});
