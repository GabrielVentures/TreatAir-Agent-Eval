import test from 'node:test';
import assert from 'node:assert/strict';
import {observationWakeReasons as wake} from './observation-wake.mjs';
const base={communicationRevision:'a',state:{simTime:1,onGround:0,radioAltitudeFt:120,iasKts:160,flareMode:1,rolloutMode:1,warning:0,localizerDots:.1,glideslopeDots:.1}};
const next=state=>({...base,state:{...base.state,simTime:2,...state}});
test('landing thresholds and flare changes wake before ground contact',()=>{
 assert.deepEqual(wake(base,next({radioAltitudeFt:99})),['descending_through_100ft']);
 assert.deepEqual(wake(base,next({flareMode:2})),['flareMode_changed']);
 assert.deepEqual(wake(base,next({warning:1})),['warning_changed']);
});
test('small fluctuations do not wake; worsening deviations and speed changes do',()=>{
 assert.deepEqual(wake(base,next({iasKts:159,localizerDots:.3})),[]);
 assert.deepEqual(wake(base,next({localizerDots:1.2})),['localizerDots_deviation_increased']);
 assert.deepEqual(wake(base,next({iasKts:149})),['airspeed_changed_10kt']);
 assert.deepEqual(wake({...base,state:{...base.state,localizerDots:2}},next({localizerDots:1})),[]);
});
test('weather changes and higher stabilization gates wake a waiting model',()=>{
 const before={...base,state:{...base.state,radioAltitudeFt:1100,effectiveWindSpeedKts:8,effectiveWindDirectionDeg:299}};
 const after={...before,state:{...before.state,simTime:2,radioAltitudeFt:990,effectiveWindSpeedKts:15,effectiveWindDirectionDeg:180}};
 assert.deepEqual(wake(before,after),['wind_speed_changed_5kt','wind_direction_changed_30deg','descending_through_1000ft']);
});
