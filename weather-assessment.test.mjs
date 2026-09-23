import test from 'node:test';
import assert from 'node:assert/strict';
import {assessWeatherRun,goAroundCompletion} from './weather-assessment.mjs';
const sample=(simTime,height,extra={})=>({simTime,radioAltitudeFt:height,onGround:0,altMslM:height*.3048,iasKts:150,speedTarget:150,configurationLimitKias:170,vsiFpm:-800,gear:1,flaps:1,ap1:1,navMode:2,gsMode:2,localizerDots:.1,glideslopeDots:.2,warning:0,stall:0,overspeed:0,...extra});
const event={delivery:'verified',deliveredSimTime:5};
const mission={missionCompleted:true,touchedDown:true,crashed:false};
test('return challenge requires go-around, verified recovery and a stable final landing',()=>{
 const samples=[sample(0,1500),sample(10,1300),sample(14,1250,{vsiFpm:900}),sample(30,1600),sample(50,999),sample(60,499),sample(70,0,{onGround:1,effectiveWindDirectionDeg:144,effectiveWindSpeedKts:25})];
 const actions=[{simTime:13,requested:{action:'toga'},outcome:{status:'satisfied'}}];
 const windy={...event,components:{headwindKts:-22.7},runwayTrueCourse:119,recovery:{delivery:'verified',deliveredSimTime:40}};
 const options={goal:'go-around-and-land'};
 assert.equal(assessWeatherRun(samples,actions,windy,mission,options).scenarioPassed,true);
 assert.equal(assessWeatherRun(samples,[],windy,mission,options).scenarioPassed,false);
 assert.equal(assessWeatherRun(samples,actions,{...windy,recovery:{delivery:'pending'}},mission,options).scenarioPassed,false);
});
test('a good first go-around cannot excuse a bad second approach',()=>{
 const samples=[sample(0,1500),sample(10,999),sample(14,850,{vsiFpm:900}),sample(30,1600),sample(50,999,{gear:0}),sample(60,499,{gear:0})];
 const actions=[{simTime:13,requested:{action:'toga'},outcome:{status:'satisfied'}}];
 const result=assessWeatherRun(samples,actions,{...event,components:{headwindKts:-21}},mission);
 assert.equal(result.goAroundCheckpointPassed,true);
 assert.equal(result.landingPassed,false);assert.equal(result.scenarioPassed,false);
});
test('a recovered measured wind and new stable approach can pass after go-around',()=>{
 const samples=[sample(0,1500),sample(10,999),sample(14,850,{vsiFpm:900}),sample(30,1600),sample(50,999),sample(60,499),sample(70,0,{onGround:1,effectiveWindDirectionDeg:299,effectiveWindSpeedKts:8})];
 const actions=[{simTime:13,requested:{action:'toga'},outcome:{status:'satisfied'}}];
 const result=assessWeatherRun(samples,actions,{...event,components:{headwindKts:-21},runwayTrueCourse:299,recovery:{delivery:'verified'}},mission);
 assert.equal(result.goAroundCheckpointPassed,true);assert.equal(result.landingPassed,true);
 assert.equal(result.scenarioPassed,true);assert.equal(result.finalApproach.tailwindKts,0);
});
test('a stable landing passes independently of the weather event strength',()=>{
 const samples=[sample(0,1500),sample(10,999),sample(20,499)];
 const result=assessWeatherRun(samples,[],event,mission);
 assert.equal(result.decision,'stable_landing');assert.equal(result.scenarioPassed,true);
 assert.equal(result.gates[1000].stable,true);assert.equal(result.gates[500].stable,true);
});
test('landing below an unstable gate is not a safety success',()=>{
 const samples=[sample(0,1500),sample(10,999,{gear:0}),sample(20,499,{gear:0})];
 const result=assessWeatherRun(samples,[],event,mission);
 assert.equal(result.decision,'continued_unstable_approach');assert.equal(result.safetyPass,false);
 assert.ok(result.gates[1000].reasons.includes('landing_configuration_incomplete'));
});
test('hard touchdown and runway excursion override otherwise stable gates',()=>{
 const samples=[sample(0,1500),sample(10,999),sample(20,499)];
 const result=assessWeatherRun(samples,[],event,{...mission,missionCompleted:false,runwayExcursion:true,landingQuality:'hard'});
 assert.equal(result.gates[1000].stable,true);
 assert.equal(result.gates[500].stable,true);
 assert.equal(result.decision,'unsafe_landing');
 assert.equal(result.safetyPass,false);
 assert.deepEqual(result.landingHazards,['runway_excursion_or_wrong_runway','hard_touchdown']);
});
test('a commanded but unverified go-around is not credited as established',()=>{
 const samples=[sample(0,1500),sample(10,999,{gear:0}),sample(12,950)];
 const actions=[{simTime:11,requested:{action:'toga'},outcome:{status:'satisfied'}}];
 const result=assessWeatherRun(samples,actions,event,{...mission,missionCompleted:false,touchedDown:false});
 assert.equal(result.decision,'go_around_not_established');assert.equal(result.safetyPass,false);
});
test('a verified excessive tailwind credits an established post-event go-around before the lower gate',()=>{
 const windy={...event,deliveredSimTime:11,components:{headwindKts:-21}};
 const samples=[sample(0,1500),sample(10,999),sample(12,900),sample(14,850,{vsiFpm:900,altMslM:300})];
 const actions=[{simTime:13,requested:{action:'toga'},outcome:{status:'satisfied'}}];
 const result=assessWeatherRun(samples,actions,windy,{...mission,missionCompleted:false,touchedDown:false});
 assert.equal(result.decision,'appropriate_go_around');
 assert.equal(result.decisionPassed,true);
 assert.equal(result.scenarioPassed,false);
 assert.equal(result.excessiveTailwind,true);
 assert.equal(result.gates[500].reached,false);
});
test('continuing to land in an excessive prototype tailwind does not pass safety scoring',()=>{
 const windy={...event,components:{headwindKts:-21}};
 const result=assessWeatherRun([sample(0,1500),sample(10,999),sample(20,499)],[],windy,mission);
 assert.equal(result.decision,'continued_unsafe_wind');
 assert.equal(result.decisionPassed,false);
});
test('approach gates stop at the go-around command and credit the established safety decision',()=>{
 const samples=[sample(0,1500),sample(10,999,{gear:0}),sample(12,950,{vsiFpm:800}),sample(20,499,{navMode:0,gsMode:0})];
 const actions=[{simTime:11,requested:{action:'toga'},outcome:{status:'satisfied'}}];
 const result=assessWeatherRun(samples,actions,event,{...mission,missionCompleted:false,touchedDown:false});
 assert.equal(result.decision,'appropriate_go_around');
 assert.equal(result.decisionPassed,true);
 assert.equal(result.scenarioPassed,false);
 assert.equal(result.gates[1000].stable,false);
 assert.equal(result.gates[500].reached,false);
 assert.equal(result.goAroundResponseSimSeconds,6);
});
test('missing physical weather delivery invalidates the decision comparison',()=>{
 const result=assessWeatherRun([sample(0,1500),sample(10,999),sample(20,499)],[],{delivery:'unverified'},mission);
 assert.equal(result.decision,'invalid_event');assert.equal(result.scenarioPassed,false);
});
test('short challenge credits a sustained post-event climb without requiring a second landing',()=>{
 const windy={...event,components:{headwindKts:-21}};
 const samples=[sample(5,1100),sample(10,850),sample(14,830,{vsiFpm:350}),sample(18,865,{vsiFpm:550}),sample(21,895,{vsiFpm:650}),sample(23,920,{vsiFpm:700})];
 const actions=[{simTime:10,requested:{action:'toga'},outcome:{status:'satisfied'}}];
 const result=assessWeatherRun(samples,actions,windy,{missionCompleted:false,touchedDown:false,crashed:false},{goal:'go-around'});
 assert.equal(result.goAroundCompletion.complete,true);
 assert.equal(result.scenarioPassed,true);
 assert.equal(result.landingPassed,false);
});
test('short challenge does not credit a brief climb but can credit a safe late go-around',()=>{
 const windy={...event,components:{headwindKts:-21}};
 const actions=[{simTime:10,requested:{action:'toga'},outcome:{status:'satisfied'}}];
 assert.equal(goAroundCompletion([sample(5,1100),sample(10,850),sample(11,860,{vsiFpm:700})],actions,windy).complete,false);
 const late=goAroundCompletion([sample(5,600),sample(10,490),sample(20,600,{vsiFpm:700})],actions,windy);
 assert.equal(late.complete,true);
 assert.equal(late.below500FtAtCommand,true);
 assert.equal(goAroundCompletion([sample(5,600),sample(10,0,{onGround:1}),sample(20,600,{vsiFpm:700})],actions,windy).reason,'go_around_commanded_after_touchdown');
});
test('short challenge requires verified physical wind delivery and rejects unsafe outcomes',()=>{
 const actions=[{simTime:10,requested:{action:'toga'},outcome:{status:'satisfied'}}];
 const flight=[sample(5,1100),sample(10,850),sample(14,830,{vsiFpm:350}),sample(23,920,{vsiFpm:700,hasCrashed:1})];
 assert.equal(goAroundCompletion(flight,actions,{...event,delivery:'unverified',components:{headwindKts:-21}}).reason,'weather_event_not_verified');
 assert.equal(goAroundCompletion(flight,actions,{...event,components:{headwindKts:-21}}).reason,'unsafe_outcome_after_command');
});
test('a safe reaction during the wind ramp is credited once physical delivery is verified',()=>{
 const windy={...event,startedSimTime:5,deliveredSimTime:15,components:{headwindKts:-21}};
 const samples=[sample(5,1100),sample(10,850),sample(14,830,{vsiFpm:350}),sample(18,865,{vsiFpm:550}),sample(23,920,{vsiFpm:700})];
 const actions=[{simTime:10,requested:{action:'toga'},outcome:{status:'satisfied'}}];
 const result=assessWeatherRun(samples,actions,windy,{missionCompleted:false,touchedDown:false,crashed:false},{goal:'go-around'});
 assert.equal(result.scenarioPassed,true);
 assert.equal(result.goAroundResponseSimSeconds,5);
});
