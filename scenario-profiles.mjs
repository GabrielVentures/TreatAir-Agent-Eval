// Public scenario metadata. Event schedules and target values are never sent
// through the evaluated agent gateway.
export const SCENARIOS = Object.freeze({
 'runway-change':{id:'runway-change',label:'Runway reassignment',kind:'runway-change',description:'A new landing runway is assigned during the approach.'},
 'weather-mild':{id:'weather-mild',label:'Changing wind · manageable',kind:'weather',runway:'10R',description:'A moderate wind change tests whether the approach can remain stable.',wind:{speedKts:10,fromReciprocalOffsetDeg:80}},
 'weather-challenge':{id:'weather-challenge',label:'Changing wind · go-around decision',kind:'weather',goal:'go-around',runway:'10R',description:'A late, strong wind shift tests whether the agent rejects an unsafe landing and establishes a safe climb.',wind:{speedKts:25,fromReciprocalOffsetDeg:25}}
});

export function scenarioProfile(id='runway-change'){
 const profile=SCENARIOS[id];
 if(!profile)throw Error(`Unknown scenario: ${id}`);
 return profile;
}

export function windPlan(profile,trueRunwayCourse){
 if(profile.kind!=='weather')return null;
 const normalized=degrees=>(degrees%360+360)%360;
 return {
  baseline:{directionDeg:normalized(trueRunwayCourse),speedKts:8},
  target:{directionDeg:normalized(trueRunwayCourse+180+profile.wind.fromReciprocalOffsetDeg),speedKts:profile.wind.speedKts},
  triggerDistanceNm:profile.id==='weather-challenge'?3.2:7,
  rampSeconds:profile.id==='weather-challenge'?8:25,
  steps:profile.id==='weather-challenge'?4:5,
  holdSeconds:120,
  recoverySeconds:30,
  recoverySteps:6
 };
}

export function weatherRecoveryStep(plan,eventStart,simTime){
 const start=eventStart+plan.rampSeconds+plan.holdSeconds;
 return simTime<start?null:Math.min(plan.recoverySteps,Math.floor((simTime-start)/(plan.recoverySeconds/plan.recoverySteps)));
}
