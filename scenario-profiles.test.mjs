import test from 'node:test';
import assert from 'node:assert/strict';
import {scenarioProfile,windPlan,weatherRecoveryStep} from './scenario-profiles.mjs';
test('weather recovery follows simulation time, independent of agent actions',()=>{
 const plan=windPlan(scenarioProfile('weather-challenge'),299);
 assert.equal(weatherRecoveryStep(plan,100,227.9),null);
 assert.equal(weatherRecoveryStep(plan,100,228),0);
 assert.equal(weatherRecoveryStep(plan,100,243),3);
 assert.equal(weatherRecoveryStep(plan,100,258),6);
 assert.equal(weatherRecoveryStep(plan,100,500),6);
});
