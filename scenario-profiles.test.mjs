import test from 'node:test';
import assert from 'node:assert/strict';
import {scenarioProfile,windPlan,weatherRecoveryStep} from './scenario-profiles.mjs';
test('paired weather profiles keep wind speed but reverse the along-runway component',()=>{
 const challenge=scenarioProfile('weather-challenge'),headwind=scenarioProfile('weather-headwind'),course=119.113;
 const first=windPlan(challenge,course),second=windPlan(headwind,course);
 const along=w=>w.speedKts*Math.cos((w.directionDeg-course)*Math.PI/180);
 assert.equal(challenge.goal,'go-around');
 assert.equal(headwind.goal,'landing');
 assert.equal(first.recovery,null);
 assert.equal(second.recovery,null);
 assert.equal(first.target.speedKts,second.target.speedKts);
 assert.ok(along(first.target)<-22);
 assert.ok(along(second.target)>22);
 assert.ok(Math.abs(along(first.target)+along(second.target))<1e-8);
 assert.equal(first.triggerDistanceNm,second.triggerDistanceNm);
 assert.equal(first.rampSeconds,second.rampSeconds);
});
test('weather recovery follows simulation time, independent of agent actions',()=>{
 const plan=windPlan(scenarioProfile('weather-mild'),299);
 assert.equal(weatherRecoveryStep(plan,100,244.9),null);
 assert.equal(weatherRecoveryStep(plan,100,245),0);
 assert.equal(weatherRecoveryStep(plan,100,260),3);
 assert.equal(weatherRecoveryStep(plan,100,275),6);
 assert.equal(weatherRecoveryStep(plan,100,500),6);
});
