import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreEvaluation} from './evaluation-score.mjs';

const action=(name,time,value,altitude=1200)=>({simTime:time,requested:{action:name,value},outcome:{status:'satisfied'},after:{radioAltitudeFt:altitude}});
const clearance={id:'scenario-1',simTime:100};
const landing={missionCompleted:true,touchedDown:true,onIntendedRunway:true,stopped:true,touchdownVerticalFpm:-250,runwayExcursion:false,crashed:false};

test('runway clearance, retune, and safe landing score all points',()=>{
 const score=scoreEvaluation({scenarioId:'runway-change',result:landing,messages:[clearance],actions:[action('acknowledge_message',105,'scenario-1'),action('tune_ils',110,'28L')]});
 assert.equal(score.score,100);
 assert.deepEqual(score.components,{decision:40,timing:20,execution:25,quality:15});
});

test('runway excursion is capped even after good decisions and touchdown',()=>{
 const score=scoreEvaluation({scenarioId:'runway-change',result:{...landing,missionCompleted:false,runwayExcursion:true},messages:[clearance],actions:[action('acknowledge_message',105,'scenario-1'),action('tune_ils',110,'28L')]});
 assert.equal(score.uncapped,85);
 assert.equal(score.score,25);
});

test('late but physically complete tailwind go-around receives no timing points',()=>{
 const result={touchedDown:false,crashed:false,weatherEvent:{startedSimTime:100},weatherAssessment:{goal:'go-around',eventDelivery:'verified',excessiveTailwind:true,goAroundCompletion:{complete:true}}};
 const score=scoreEvaluation({scenarioId:'weather-challenge',result,actions:[action('toga',135,null,84)]});
 assert.equal(score.score,80);
 assert.equal(score.responseAltitudeFt,84);
});

test('hard headwind touchdown is capped below a clean landing',()=>{
 const result={...landing,touchdownVerticalFpm:-1206,weatherEvent:{startedSimTime:100},weatherAssessment:{goal:'landing',eventDelivery:'verified',tailwindKts:-22,gates:{1000:{stable:true},500:{stable:true}}}};
 const score=scoreEvaluation({scenarioId:'weather-headwind',result,actions:[action('acknowledge_message',110,'scenario-1',1420)]});
 assert.equal(score.score,50);
 assert.equal(score.cap,50);
});

test('missing event delivery is unscored rather than failed',()=>{
 const score=scoreEvaluation({scenarioId:'weather-headwind',result:{weatherAssessment:{eventDelivery:'pending'}}});
 assert.equal(score.score,null);
 assert.equal(score.reason,'weather_event_not_verified');
});

test('unknown touchdown speed receives no quality credit',()=>{
 const score=scoreEvaluation({scenarioId:'runway-change',result:{...landing,touchdownVerticalFpm:null},messages:[clearance],actions:[action('acknowledge_message',105,'scenario-1'),action('tune_ils',110,'28L')]});
 assert.equal(score.components.quality,0);
 assert.equal(score.score,85);
});
