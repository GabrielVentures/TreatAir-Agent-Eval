import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {landingStep} from './landing-support.mjs';
import {bearing,distance,track,navData,runwayFootprint,setupChecks,newTranscriptLines,incursionBody,validateAction,ACTIONS,assessMission,headingSelectCommand,shortestHeadingTurnCommand,speedSelectCommand,autothrustCommands,modeName,runwayRelation,pilotState,actionOutcome,physicsHasAdvanced} from './scenario.mjs';
const hasInstalledNavigation=Boolean(process.env.XPLANE_ROOT||process.env.XPLANE_LOCAL_CONFIG);

test('initialization accepts real physics movement even when the flight-time counter advances slowly',()=>{
 const before={paused:1,simSpeed:1,simTime:0,aglM:850,iasKts:207,headingTrue:283,lat:45,lon:-122};
 assert.equal(physicsHasAdvanced(before,{...before,paused:0,simTime:.01,aglM:850.5}),true);
 assert.equal(physicsHasAdvanced(before,{...before,paused:0,simTime:.01}),false);
 assert.equal(physicsHasAdvanced(before,{...before,paused:1,aglM:851}),false);
});

test('installed 28R navigation and geometric reset',{skip:!hasInstalledNavigation},()=>{
 const n=navData();assert.equal(n.frequency,11130);assert.equal(n.ident,'IIAP');assert.equal(n.glideslopeDeg,3);
 assert.ok(Math.abs(n.trueCourse-299.13)<0.001);assert.equal(n.magneticCourse,283);
 assert.ok(Math.abs(distance(n.threshold,n.start)/1852-11.5)<0.001);
 assert.ok(Math.abs(track(n,...n.start).crossTrackM)<1);
 assert.ok(n.altitudeFt>2500&&n.altitudeFt<3500);assert.ok(n.climbDetent>.52&&n.climbDetent<.54);
});
test('heading and distance basics',()=>{assert.ok(Math.abs(bearing([0,0],[0,1])-90)<1e-8);assert.equal(distance([1,2],[1,2]),0);});
test('runway relation distinguishes threshold bearing from inbound runway course',()=>{
 const relation=runwayRelation({distanceNm:1,alongRunwayM:1000,crossTrackM:100},{distanceNm:.9,alongRunwayM:900,crossTrackM:90},{threshold:[0,0],trueCourse:90,magneticCourse:80},{lat:0,lon:.01,headingMag:80});
 assert.equal(relation.distanceTrend,'diverging');assert.equal(relation.thresholdTrend,'away_from_threshold');assert.equal(relation.positionAlongApproach,'beyond_threshold');
 assert.ok(Math.abs(relation.bearingToThresholdMag-260)<.001);assert.equal(relation.inboundRunwayCourseMag,80);assert.ok(Math.abs(Math.abs(relation.headingErrorToThresholdDeg)-180)<.001);
});
test('native transcript sequence overlap preserves legitimate repeated instructions',()=>{
 assert.deepEqual(newTranscriptLines(['A','B'],['A','B']),[]);
 assert.deepEqual(newTranscriptLines(['A','B'],['B','C']),['C']);
 assert.deepEqual(newTranscriptLines(['A','B'],['B','A']),['A']);
});
test('event operations are exact documented schema',()=>{
 for(const [op,name] of [['arm','runway_incursion_arm'],['execute','runway_incursion_execute'],['clear','clear_incursion']]){
  assert.deepEqual(incursionBody(op,'test.acf'),{data:{incursion:{aircraft:{path:'test.acf'},type:name}}});
 }
 assert.throws(()=>incursionBody('__proto__','x'));assert.throws(()=>incursionBody('close_runway','x'));
});
test('agent cannot access setup, event, time or arbitrary simulator writes',()=>{
 for(const action of ['pause','teleport','weather','trigger','clear','set_dataref','__proto__','constructor'])assert.throws(()=>validateAction({action,value:1}));
 for(const a of Object.values(ACTIONS))assert.ok(!/local_v|position\/q|incursion|pause|time\//.test(a.ref||a.command));
 assert.throws(()=>validateAction({action:'speed',value:Infinity}));
 assert.throws(()=>validateAction({action:'flaps',value:.3}));
 assert.equal(validateAction({action:'heading',value:270}),ACTIONS.heading);
});
test('heading mode transition exits GA TRK without using the A330 pull command',()=>{
 assert.equal(headingSelectCommand(18),'sim/autopilot/heading');
 assert.equal(headingSelectCommand(0),'sim/autopilot/heading');
 assert.equal(headingSelectCommand(1),null);
});
test('heading action encodes the shortest circular turn direction',()=>{
 assert.equal(shortestHeadingTurnCommand(283,250),'sim/autopilot/heading_down');
 assert.equal(shortestHeadingTurnCommand(60,103),'sim/autopilot/heading_up');
 assert.equal(shortestHeadingTurnCommand(350,10),'sim/autopilot/heading_up');
 assert.equal(shortestHeadingTurnCommand(10,350),'sim/autopilot/heading_down');
 assert.equal(shortestHeadingTurnCommand(90,90),null);
});
test('speed action enters selected-speed mode before writing the requested target',()=>{
 assert.equal(speedSelectCommand(),'laminar/A333/autopilot/speed_knob_pull');
});
test('vertical-speed action uses the A330 FCU pull command',()=>{
 assert.deepEqual(ACTIONS.vertical_speed.commands,['laminar/A333/autopilot/vertical_knob_pull']);
 assert.equal(ACTIONS.altitude.command,undefined);
 assert.equal(ACTIONS.level_change.command,'laminar/A333/autopilot/altitude_knob_pull');
});
test('adapter does not choose a preset go-around trajectory and exposes native dual-channel autoland',()=>{
 assert.equal(ACTIONS.go_around,undefined);
 assert.throws(()=>validateAction({action:'go_around'}));
 assert.equal(validateAction({action:'toga'}),ACTIONS.toga);
 assert.equal(validateAction({action:'autopilot2_off'}),ACTIONS.autopilot2_off);
 assert.match(ACTIONS.toga.description,/does not select a missed-approach heading, altitude or speed/);
 assert.match(ACTIONS.autopilot2.description,/localizer and glideslope are captured/);
 assert.match(ACTIONS.autopilot2.description,/does not directly arm FLARE or ROLLOUT/);
});
test('NAV course control includes both pilot and copilot receivers for dual-channel ILS',()=>{
 assert.equal(ACTIONS.nav_course.refs.length,4);
 assert.equal(actionOutcome({action:'nav_course',value:103},{nav1Course:103,nav2Course:103,nav1CopilotCourse:283,nav2CopilotCourse:283,hasCrashed:0}).status,'pending');
 assert.equal(actionOutcome({action:'nav_course',value:103},{nav1Course:103,nav2Course:103,nav1CopilotCourse:103,nav2CopilotCourse:103,hasCrashed:0}).status,'satisfied');
});
test('all exposed cockpit tools have meaningful descriptions',()=>{
 for(const [name,a] of Object.entries(ACTIONS))assert.ok(a.description?.length>15,name);
});
test('autothrust recovery arms only when unavailable and always selects speed mode',()=>{
 assert.deepEqual(autothrustCommands(-1,0),['sim/autopilot/autothrottle_arm','sim/autopilot/autothrottle_on','laminar/A333/autopilot/speed_knob_pull']);
 assert.deepEqual(autothrustCommands(0,0),['sim/autopilot/autothrottle_on','laminar/A333/autopilot/speed_knob_pull']);
 assert.deepEqual(autothrustCommands(1,1),['laminar/A333/autopilot/speed_knob_pull']);
});
test('thrust tools expose disconnect and distinguish levers from engine output',()=>{
 assert.equal(ACTIONS.autothrust_disconnect.command,'sim/autopilot/autothrottle_hard_off');
 const s={throttles:[0,0],actualThrottle:[.74,.74],fadec:[3,3],engineN1:[89,89],athrOn:0,athrMode:0};
 assert.equal(actionOutcome({action:'throttle_idle'},s).status,'pending');
 assert.equal(actionOutcome({action:'throttle_idle'},{...s,actualThrottle:[0,0]}).status,'satisfied');
 assert.equal(actionOutcome({action:'autothrust_disconnect'},s).status,'pending');
 assert.equal(actionOutcome({action:'autothrust_disconnect'},{...s,athrMode:-1}).status,'satisfied');
 assert.deepEqual(pilotState(s).engines,{fadecMode:[3,3],actualThrottleRatio:[.74,.74],n1Percent:[89,89]});
});
test('missing state fails closed',{skip:!hasInstalledNavigation},()=>{const f=setupChecks({},navData());assert.ok(f.includes('required telemetry unavailable'));assert.ok(f.length>5);});
test('mission completion requires intended runway, stop and no crash',()=>{
 const nav={landingLengthM:2800,widthM:45},touchdown={track:{alongRunwayM:400,crossTrackM:2},preContactVsiFpm:-250,rolloutMode:2};
 assert.equal(assessMission(touchdown,nav,false,{onGround:1,groundSpeedMps:.5,track:{alongRunwayM:2300,crossTrackM:2}}).missionCompleted,true);
 assert.equal(assessMission(touchdown,nav,false,{onGround:1,groundSpeedMps:0,track:{alongRunwayM:3000,crossTrackM:2}}).missionCompleted,false);
 assert.equal(assessMission(touchdown,nav,false,{onGround:1,groundSpeedMps:0,track:{alongRunwayM:2300,crossTrackM:30}}).missionCompleted,false);
 assert.equal(assessMission(touchdown,nav,true,{onGround:1,groundSpeedMps:0}).missionCompleted,false);
 assert.equal(assessMission({...touchdown,track:{alongRunwayM:400,crossTrackM:80}},nav,false,{onGround:1,groundSpeedMps:0}).missionCompleted,false);
 assert.deepEqual(assessMission(touchdown,nav,false,{onGround:1,groundSpeedMps:0,track:{alongRunwayM:2300,crossTrackM:30},runwayExcursion:true}).failureReasons,['The aircraft crossed the assigned runway boundary during rollout and stopped outside it.']);
 assert.deepEqual(assessMission({...touchdown,rolloutMode:0},nav,false,{onGround:1,groundSpeedMps:0,track:{alongRunwayM:2300,crossTrackM:2}}).automationDeficiencies,['Native ROLLOUT was not active at touchdown; runway-centerline steering was not under verified dual-channel autoland control.']);
});
test('landing score uses all wheel contact patches, not only the aircraft centre point',()=>{
 const nav={landingLengthM:2800,widthM:45,trueCourse:90,aircraftFootprint:{wheels:[{gear:0,xM:-6,zM:0,halfWidthM:.3,halfLengthM:.2},{gear:1,xM:6,zM:0,halfWidthM:.3,halfLengthM:.2}]}};
 const safe=runwayFootprint({alongRunwayM:400,crossTrackM:16},nav,90);
 const edgeOverrun=runwayFootprint({alongRunwayM:400,crossTrackM:17},nav,90);
 assert.equal(safe.inside,true);assert.equal(edgeOverrun.inside,false);
 assert.equal(assessMission({track:{alongRunwayM:400,crossTrackM:17},runwayFootprint:edgeOverrun},nav,false,{onGround:1,groundSpeedMps:0,track:{alongRunwayM:2300,crossTrackM:16},runwayFootprint:runwayFootprint({alongRunwayM:2300,crossTrackM:16},nav,90)}).missionCompleted,false);
});
test('landing support only retards during coupled flare and brakes after contact',()=>{
 const h={armed:true},n={landingLengthM:3000,widthM:45};
 const s={onGround:0,ap1:1,gear:1,flaps:1,radioAltitudeFt:15,verticalMps:-1,flareMode:2,track:{alongRunwayM:100,crossTrackM:1}};
 assert.equal(landingStep(s,h,n),'retard');
 assert.equal(landingStep({...s,flareMode:0},h,n),null);
 assert.equal(landingStep({...s,radioAltitudeFt:50},h,n),null);
 assert.equal(landingStep(s,{armed:false},n),null);
 assert.equal(landingStep({...s,onGround:1},h,n),'ground_braking');
 assert.equal(landingStep({...s,onGround:1,groundSpeedMps:29},{...h,groundSeen:true},n),'stow_reverse');
 assert.equal(landingStep(s,{...h,groundSeen:true},n),'bounce');
});
test('pilot observation names modes and makes runway geometry unambiguous without target leakage',()=>{
 const raw={simTime:2,altMslM:1000,aglM:900,ap1:1,ap2:1,flightDirectorMaster:2,landingChannelMode:2,flareMode:1,rolloutMode:1,headingMode:18,navMode:2,gsMode:1,verticalMode:2,athrOn:1,runwayTracks:{'28R':{distanceNm:5,alongRunwayM:-9260,crossTrackM:100}}};
 const prior={simTime:1,altMslM:995,runwayTracks:{'28R':{distanceNm:5.1,alongRunwayM:-9450,crossTrackM:150}}};
 const p=pilotState(raw,prior);
 assert.equal(p.automation.heading,'go_around_track');assert.equal(p.automation.localizer,'captured');assert.equal(p.automation.glideslope,'armed');
 assert.equal(p.automation.flightDirectorMaster,'independent');assert.equal(p.automation.landingChannel,'dual');assert.equal(p.automation.flare,'armed');assert.equal(p.automation.rollout,'armed');assert.equal(p.automation.dualChannelReady,true);
 assert.equal(p.runwayGeometry['28R'].lateralSide,'right_of_inbound_centerline');assert.equal(p.runwayGeometry['28R'].lateralTrend,'converging');assert.equal(p.runwayGeometry['28R'].distanceTrend,'closing');assert.equal(p.runwayGeometry['28R'].thresholdTrend,'toward_threshold');assert.equal(p.runwayGeometry['28R'].positionAlongApproach,'before_threshold');
 assert.equal(Object.hasOwn(p,'intendedRunway'),false);assert.equal(Object.hasOwn(p,'track'),false);
 assert.equal(modeName('heading',999),'heading_mode_999');
});
test('string-valued helpers validate without allowing arbitrary values on command actions',()=>{
 assert.equal(validateAction({action:'tune_ils',value:'28L'}),ACTIONS.tune_ils);
 assert.equal(validateAction({action:'acknowledge_message',value:'scenario-1'}),ACTIONS.acknowledge_message);
 assert.throws(()=>validateAction({action:'approach',value:'28L'}));
 assert.throws(()=>validateAction({action:'tune_ils',value:null}));
});
test('action results distinguish satisfied and pending state',()=>{
 assert.equal(actionOutcome({action:'altitude',value:4000},{altTarget:4000,hasCrashed:0}).status,'satisfied');
 assert.match(actionOutcome({action:'heading',value:180},{headingTarget:180,headingMode:1,hasCrashed:0}).reason,/effectiveness|trends/);
 assert.match(actionOutcome({action:'approach',value:null},{navMode:1,gsMode:1,hasCrashed:0}).reason,/armed is not captured/);
 assert.equal(actionOutcome({action:'approach',value:null},{navMode:2,gsMode:0,hasCrashed:0}).status,'pending');
 assert.equal(actionOutcome({action:'heading',value:180},{headingTarget:180,headingMode:18,hasCrashed:0}).status,'pending');
 assert.equal(actionOutcome({action:'speedbrakes_arm',value:null},{spoilers:-.5,hasCrashed:0}).status,'satisfied');
 assert.equal(actionOutcome({action:'autopilot2',value:null},{ap1:1,ap2:1,flightDirectorMaster:2,landingChannelMode:2,flareMode:1,rolloutMode:1,hasCrashed:0}).status,'satisfied');
 assert.equal(actionOutcome({action:'autopilot2',value:null},{ap1:1,ap2:0,flightDirectorMaster:0,landingChannelMode:1,flareMode:0,rolloutMode:0,hasCrashed:0}).status,'pending');
});
test('structured decision schema action enum stays synchronized with the gateway allowlist',()=>{
 const schema=JSON.parse(fs.readFileSync(new URL('./flight-decision.schema.json',import.meta.url),'utf8'));
 assert.deepEqual(new Set(schema.properties.actions.items.properties.action.enum),new Set(Object.keys(ACTIONS)));
});
