import test from 'node:test';
import assert from 'node:assert/strict';
import {scenarioProfile,windPlan} from './scenario-profiles.mjs';
import {interpolateWind,windComponents,changedWindLayers,windDelivered,setWind,snapshotWeather,restoreWeather} from './weather-controller.mjs';

test('weather profiles derive a runway-relative wind without changing the mission',()=>{
 const plan=windPlan(scenarioProfile('weather-challenge'),299);
 assert.equal(plan.baseline.directionDeg,299);
 assert.equal(plan.target.directionDeg,144);
 assert.equal(plan.target.speedKts,25);
 assert.equal(plan.triggerDistanceNm,5.5);
 assert.equal(plan.rampSeconds,25);
 assert.throws(()=>scenarioProfile('not-a-scenario'));
});
test('wind interpolation takes the short circular turn and scoring uses actual aircraft wind',()=>{
 assert.equal(interpolateWind({directionDeg:350,speedKts:8},{directionDeg:10,speedKts:18},.5).directionDeg,0);
 const components=windComponents({directionDeg:179,speedKts:17},299);
 assert.ok(components.headwindKts<0&&components.crosswindKts<0);
 assert.equal(windDelivered({directionDeg:181,speedKts:16},{directionDeg:299,speedKts:8},{directionDeg:179,speedKts:17}),true);
 assert.equal(windDelivered({directionDeg:299,speedKts:8},{directionDeg:299,speedKts:8},{directionDeg:179,speedKts:17}),false);
 assert.equal(windDelivered({directionDeg:355,speedKts:21.6},{directionDeg:119,speedKts:8},{directionDeg:324,speedKts:25}),false);
});
test('only lower weather layers change and the original settings can be restored',async()=>{
 assert.deepEqual(changedWindLayers([0,1000,4000],[1,2,3],7,30),[7,7,3]);
 const values=new Map([
  ['sim/weather/region/wind_direction_degt',[299,299,299]],
  ['sim/weather/region/wind_speed_msc',[4,4,4]],
  ['sim/weather/region/wind_altitude_msl_m',[0,1000,4000]],
  ['sim/weather/region/variability_pct',.4],
  ['sim/weather/region/change_mode',3],
  ['sim/weather/region/update_immediately',0],
  ['sim/weather/region/weather_source',0]
 ]);
 const api={get:async key=>structuredClone(values.get(key)),set:async(key,value)=>{values.set(key,structuredClone(value));}};
 const backup=await snapshotWeather(api);
 await setWind(api,backup,{directionDeg:179,speedKts:17},30);
 assert.deepEqual(values.get('sim/weather/region/wind_direction_degt'),[179,179,299]);
 assert.equal(values.get('sim/weather/region/update_immediately'),1);
 await restoreWeather(api,backup);
 assert.deepEqual(values.get('sim/weather/region/wind_direction_degt'),[299,299,299]);
 assert.equal(values.get('sim/weather/region/update_immediately'),0);
});
