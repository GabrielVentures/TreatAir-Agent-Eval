// Public scenario metadata. Event schedules and target values are never sent
// through the evaluated agent gateway.
export const SCENARIOS = Object.freeze({
 'runway-change':{id:'runway-change',label:'Runway reassignment',kind:'runway-change',description:'A new landing runway is assigned during the approach.'},
 'weather-mild':{id:'weather-mild',label:'Changing wind · manageable',kind:'weather',runway:'10R',description:'A moderate wind change tests whether the approach can remain stable.',wind:{speedKts:10,fromReciprocalOffsetDeg:80}},
 'weather-challenge':{id:'weather-challenge',label:'Changing wind · tailwind go-around',kind:'weather',goal:'go-around',runway:'10R',description:'Reject an approach after a strong tailwind develops.',wind:{speedKts:25,fromReciprocalOffsetDeg:25},recover:false},
 'weather-headwind':{id:'weather-headwind',label:'Changing wind · headwind landing',kind:'weather',goal:'landing',runway:'10R',description:'Land safely when the same wind speed develops from a favorable direction.',wind:{speedKts:25,fromCourseOffsetDeg:25},recover:false}
});

export function scenarioProfile(id='runway-change'){
 const profile=SCENARIOS[id];
 if(!profile)throw Error(`Unknown scenario: ${id}`);
 return profile;
}

export function windPlan(profile,trueRunwayCourse){
 if(profile.kind!=='weather')return null;
 const normalized=degrees=>(degrees%360+360)%360;
 const targetOffset=Number.isFinite(profile.wind.fromCourseOffsetDeg)?profile.wind.fromCourseOffsetDeg:180+profile.wind.fromReciprocalOffsetDeg;
 return {
  baseline:{directionDeg:normalized(trueRunwayCourse),speedKts:8},
  target:{directionDeg:normalized(trueRunwayCourse+targetOffset),speedKts:profile.wind.speedKts},
  recovery:profile.recover===false?null:{directionDeg:normalized(trueRunwayCourse),speedKts:8},
  triggerDistanceNm:['weather-challenge','weather-headwind'].includes(profile.id)?5.5:7,
  rampSeconds:25,
  steps:5,
  holdSeconds:120,
  recoverySeconds:30,
  recoverySteps:6
 };
}

export function weatherRecoveryStep(plan,eventStart,simTime){
 if(!plan.recovery)return null;
 const start=eventStart+plan.rampSeconds+plan.holdSeconds;
 return simTime<start?null:Math.min(plan.recoverySteps,Math.floor((simTime-start)/(plan.recoverySeconds/plan.recoverySteps)));
}
