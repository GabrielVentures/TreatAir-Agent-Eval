#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {withinRunway,landingStep} from './landing-support.mjs';
import {loadConfig} from './installation.mjs';
import {resumeForSetup} from './setup-resume.mjs';
import {resetSetupOrientation} from './setup-orientation.mjs';
import {scenarioProfile,windPlan,weatherRecoveryStep} from './scenario-profiles.mjs';
import {snapshotWeather,setWind,restoreWeather,interpolateWind,windDelivered,windComponents,angularDifference} from './weather-controller.mjs';
import {assessWeatherRun,goAroundCompletion} from './weather-assessment.mjs';
import {scoreEvaluation} from './evaluation-score.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
const flag=(name, fallback=null)=>{let i=args.indexOf(name);return i<0?fallback:args[i+1];};
const ROOT=process.env.XPLANE_SCENARIO_STATE||path.join(HERE,'.state');
fs.mkdirSync(ROOT,{recursive:true,mode:0o700});
const CFG=loadConfig(flag('--config',path.join(HERE,'config.json')),ROOT);
const runningAsCommand=process.argv[1]&&path.resolve(process.argv[1] )===path.resolve(fileURLToPath(import.meta.url));
if(!CFG.simRoot&&runningAsCommand)throw Error('X-Plane installation is not configured. Open Flight Control Room and save the X-Plane 12 installation folder first.');
const stateFile=path.join(ROOT,'operator.json');
const json=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const save=(p,x)=>{const temp=`${p}.tmp-${process.pid}-${crypto.randomUUID()}`;fs.writeFileSync(temp,JSON.stringify(x,null,2),{mode:0o600});fs.renameSync(temp,p);};
const state=()=>fs.existsSync(stateFile)?json(stateFile):{};
const chosenScenario=()=>scenarioProfile(flag('--scenario',state().scenarioId||'runway-change'));
const update=x=>save(stateFile,{...state(),...x});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const stamp=sim=>({wallTime:new Date().toISOString(),simTime:sim??null});
const append=(file,x)=>fs.appendFileSync(file,JSON.stringify(x)+'\n',{mode:0o600});
let currentRun=null;
const watchXPlaneProcess=args.includes('--watch-xplane-process');
const suppressScenarioEvent=args.includes('--no-scenario-event');
let observedXPlaneProcess=false;
function log(kind,x){if(currentRun)append(path.join(currentRun,kind+'.jsonl'),x);}
function runDir(){const d=path.join(ROOT,'runs',new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(d,{recursive:true});currentRun=d;return d;}

export function bearing(a,b){const d=Math.PI/180, la=a[0]*d,lb=b[0]*d,dl=(b[1]-a[1])*d;return (Math.atan2(Math.sin(dl)*Math.cos(lb),Math.cos(la)*Math.sin(lb)-Math.sin(la)*Math.cos(lb)*Math.cos(dl))/d+360)%360;}
export function distance(a,b){const d=Math.PI/180,x=Math.sin((b[0]-a[0])*d/2)**2+Math.cos(a[0]*d)*Math.cos(b[0]*d)*Math.sin((b[1]-a[1])*d/2)**2;return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
function destination(a,course,metres){const d=Math.PI/180,t=metres/6371000,l=a[0]*d,c=course*d;const lat=Math.asin(Math.sin(l)*Math.cos(t)+Math.cos(l)*Math.sin(t)*Math.cos(c));return [lat/d,a[1]+Math.atan2(Math.sin(c)*Math.sin(t)*Math.cos(l),Math.cos(t)-Math.sin(l)*Math.sin(lat))/d];}
export function track(nav,lat,lon){const p=[lat,lon], d=distance(nav.threshold,p),angle=(bearing(nav.threshold,p)-nav.trueCourse)*Math.PI/180;return {distanceNm:d/1852,alongRunwayM:d*Math.cos(angle),crossTrackM:d*Math.sin(angle)};}
function acfGearFootprint(acf){
 const feetToM=.3048, wheels=[];
 for(let i=0;i<12;i++){
  const value=name=>Number(acf.match(new RegExp(`^P _gear/${i}/${name}\\s+([-+.\\deE]+)\\s*$`,'m'))?.[1]);
  const xFt=value('_gear_x'),zFt=value('_gear_z'),widthFt=value('_tire_swidth'),radiusFt=value('_tire_radius');
  if([xFt,zFt,widthFt,radiusFt].every(Number.isFinite)){
   // The contact patch is deliberately modest: tyre width plus a conservative
   // fore/aft patch, not the full wheel radius or the aircraft fuselage.
   wheels.push({gear:i,xM:xFt*feetToM,zM:zFt*feetToM,halfWidthM:Math.max(.08,widthFt*feetToM/2),halfLengthM:Math.min(.7,Math.max(.15,radiusFt*feetToM*.22))});
  }
 }
 if(!wheels.length)throw Error('Landing-gear geometry missing in aircraft definition');
 return {units:'metres',wheels};
}
export function runwayFootprint(t,nav,headingTrue){
 if(!t||!nav?.aircraftFootprint?.wheels?.length||!Number.isFinite(headingTrue))return null;
 const delta=((headingTrue-nav.trueCourse+540)%360-180)*Math.PI/180,points=[];
 for(const wheel of nav.aircraftFootprint.wheels){
  for(const [dx,dz] of [[-wheel.halfWidthM,-wheel.halfLengthM],[-wheel.halfWidthM,wheel.halfLengthM],[wheel.halfWidthM,wheel.halfLengthM],[wheel.halfWidthM,-wheel.halfLengthM]]){
   // Project each wheel-contact corner from aircraft body coordinates into the
   // runway-aligned coordinate system. The runway is a rectangle from its
   // threshold to landingLengthM, widthM wide.
   points.push({gear:wheel.gear,alongRunwayM:t.alongRunwayM+(wheel.zM+dz)*Math.cos(delta)-(wheel.xM+dx)*Math.sin(delta),crossTrackM:t.crossTrackM+(wheel.xM+dx)*Math.cos(delta)+(wheel.zM+dz)*Math.sin(delta)});
  }
 }
 const along=points.map(p=>p.alongRunwayM),cross=points.map(p=>p.crossTrackM);
 const margins=points.flatMap(p=>[p.alongRunwayM,nav.landingLengthM-p.alongRunwayM,nav.widthM/2-p.crossTrackM,nav.widthM/2+p.crossTrackM]);
 return {method:'landing_gear_contact_polygon',headingTrue,headingRelativeRunwayDeg:((headingTrue-nav.trueCourse+540)%360-180),points,alongRangeM:[Math.min(...along),Math.max(...along)],crossRangeM:[Math.min(...cross),Math.max(...cross)],minimumRunwayMarginM:Math.min(...margins),inside:margins.every(m=>m>=0)};
}
const MODE_NAMES={
 heading:{0:'off',1:'heading_select',18:'go_around_track'},
 lateral:{0:'off',1:'armed',2:'captured'},
 glideslope:{0:'off',1:'armed',2:'captured'},
 vertical:{0:'off',1:'armed',2:'vertical_speed'},
 autothrust:{'-1':'unavailable',0:'armed_or_inactive',1:'active'},
 flightDirectorMaster:{0:'captain',1:'copilot',2:'independent'},
 landingChannel:{0:'none',1:'single',2:'dual'},
 autoland:{0:'off',1:'armed',2:'active'}
};
export function modeName(group,value){return MODE_NAMES[group]?.[String(value)]??`${group}_mode_${value??'unknown'}`;}
const signedAngle=(target,current)=>((target-current+540)%360)-180;
export function runwayRelation(t,previous=null,nav=null,aircraft=null){
 if(!t)return null;
 const abs=Math.abs(t.crossTrackM),prior=previous&&Number.isFinite(previous.crossTrackM)?Math.abs(previous.crossTrackM):null;
 const priorDistance=previous&&Number.isFinite(previous.distanceNm)?previous.distanceNm:null;
 const distanceTrend=priorDistance===null?'unknown':t.distanceNm<priorDistance-.003?'closing':t.distanceNm>priorDistance+.003?'diverging':'steady';
 const priorAlong=previous&&Number.isFinite(previous.alongRunwayM)?Math.abs(previous.alongRunwayM):null;
 const thresholdTrend=priorAlong===null?'unknown':Math.abs(t.alongRunwayM)<priorAlong-5?'toward_threshold':Math.abs(t.alongRunwayM)>priorAlong+5?'away_from_threshold':'steady';
 const relation={...t,lateralSide:abs<5?'centerline':t.crossTrackM>0?'right_of_inbound_centerline':'left_of_inbound_centerline',lateralTrend:prior===null?'unknown':abs<prior-3?'converging':abs>prior+3?'diverging':'steady',distanceTrend,thresholdTrend,positionAlongApproach:t.alongRunwayM<0?'before_threshold':t.alongRunwayM<=100?'threshold_zone':'beyond_threshold'};
 if(nav&&aircraft&&Number.isFinite(aircraft.lat)&&Number.isFinite(aircraft.lon)){
  const bearingTrue=bearing([aircraft.lat,aircraft.lon],nav.threshold);
  const magneticVariation=signedAngle(nav.trueCourse,nav.magneticCourse);
  const bearingMag=(bearingTrue-magneticVariation+360)%360;
  Object.assign(relation,{bearingToThresholdMag:bearingMag,bearingToThresholdTrue:bearingTrue,inboundRunwayCourseMag:nav.magneticCourse,inboundRunwayCourseTrue:nav.trueCourse,headingErrorToThresholdDeg:Number.isFinite(aircraft.headingMag)?signedAngle(bearingMag,aircraft.headingMag):null});
 }
 return relation;
}
export function pilotState(s,previous=null){
 const scalar=['wallTime','simTime','lat','lon','altMslM','aglM','iasKts','groundSpeedMps','headingTrue','headingMag','headingTarget','pitch','bank','vsiFpm','onGround','hasCrashed','fuelKg','ap1','ap2','flightDirectorMaster','fdMasterPilot','fdMasterCopilot','flightDirectorMode','flightDirector2Mode','landingChannelMode','bankAngleMode','athrOn','athrMode','verticalMode','verticalTarget','navMode','gsMode','headingMode','speedTarget','altTarget','flaps','flapsActual','slatsActual','gear','spoilers','throttles','reversers','leftBrake','rightBrake','autobrake','nav1','nav2','nav1Power','nav2Power','nav1Id','nav2Id','nav1Course','nav2Course','nav1CopilotCourse','nav2CopilotCourse','com1','warning','caution','stall','overspeed','airframeOverspeed','lowSpeedProtection','effectiveWindDirectionDeg','effectiveWindSpeedKts'];
 const out=Object.fromEntries([...scalar,'massKg','fullFlapLimitKias','configurationLimitKias','nextFlapLimitKias','localizerDots','glideslopeDots','localizerSignal','glideslopeSignal'].map(k=>[k,s[k]??null]));
 if(out.nextFlapLimitKias===9999)out.nextFlapLimitKias=null;
 Object.assign(out,{radioAltitudeFt:s.radioAltitudeFt,flareMode:s.flareMode,rolloutMode:s.rolloutMode,landingHelper:state().landingHelper||{armed:false}});
 out.altitudeIndicatedFt=Number.isFinite(s.altMslM)?s.altMslM/0.3048:null;
 out.engines={fadecMode:s.fadec?.slice(0,2)??null,actualThrottleRatio:s.actualThrottle?.slice(0,2)??null,n1Percent:s.engineN1?.slice(0,2)??null};
 out.terrainClearanceFt=Number.isFinite(s.aglM)?s.aglM/0.3048:null;
 out.automation={heading:modeName('heading',s.headingMode),localizer:modeName('lateral',s.navMode),glideslope:modeName('glideslope',s.gsMode),vertical:modeName('vertical',s.verticalMode),autothrust:modeName('autothrust',s.athrOn),flightDirectorMaster:modeName('flightDirectorMaster',s.flightDirectorMaster),landingChannel:modeName('landingChannel',s.landingChannelMode),flare:modeName('autoland',s.flareMode),rollout:modeName('autoland',s.rolloutMode),dualChannelReady:s.ap1===1&&s.ap2===1&&s.flightDirectorMaster===2&&s.landingChannelMode===2};
 const navigation=state().navigation||[];
 out.runwayGeometry=Object.fromEntries(Object.entries(s.runwayTracks||{}).map(([runway,t])=>[runway,runwayRelation(t,previous?.runwayTracks?.[runway],navigation.find(n=>n.runway===runway),s)]));
 if(previous&&Number.isFinite(previous.simTime)&&s.simTime>previous.simTime){const dt=s.simTime-previous.simTime;out.trends={sampleSeconds:dt,altitudeFpm:Number.isFinite(s.altMslM)&&Number.isFinite(previous.altMslM)?(s.altMslM-previous.altMslM)/0.3048*60/dt:null,airspeedKtsPerSecond:Number.isFinite(s.iasKts)&&Number.isFinite(previous.iasKts)?(s.iasKts-previous.iasKts)/dt:null,headingDegPerSecond:Number.isFinite(s.headingMag)&&Number.isFinite(previous.headingMag)?(((s.headingMag-previous.headingMag+540)%360)-180)/dt:null};}
 else out.trends={sampleSeconds:null,altitudeFpm:null,airspeedKtsPerSecond:null,headingDegPerSecond:null};
 out.approachGeometry=Object.fromEntries(navigation.map(nav=>{const t=s.runwayTracks?.[nav.runway];const pathAltitudeFt=t&&t.alongRunwayM<0?nav.elevationFt+Math.tan(nav.glideslopeDeg*Math.PI/180)*(-t.alongRunwayM)/.3048:null;return [nav.runway,{pathAltitudeFt,abovePathFt:pathAltitudeFt===null?null:s.altMslM/.3048-pathAltitudeFt}];}));
 out.missing=(s.missing||[]).map(x=>x.field);
 return out;
}
export function navData(runwayName=CFG.runway){
  const navPath=['Custom Data/user_nav.dat','Custom Data/earth_nav.dat','Resources/default data/earth_nav.dat'].map(p=>path.join(CFG.simRoot,p));
  let loc,gs,source;
  for(const file of navPath.filter(fs.existsSync)){
    const rows=fs.readFileSync(file,'utf8').split(/\r?\n/).map(s=>s.trim().split(/\s+/)).filter(a=>a[8]===CFG.airport&&a[10]===runwayName);
    loc=rows.find(a=>a[0]==='4');gs=rows.find(a=>a[0]==='6');if(loc&&gs){source=file;break;}
  }
  if(!loc||!gs)throw Error('Installed matching localizer/glideslope not found');
  const apt=path.join(CFG.simRoot,'Global Scenery/Global Airports/Earth nav data/apt.dat');
  const lines=fs.readFileSync(apt,'utf8').split(/\r?\n/);let active=false,runway,tower;
  for(const line of lines){const a=line.trim().split(/\s+/);if(['1','16','17'].includes(a[0])){if(active)break;active=a[4]===CFG.airport;}if(!active)continue;if(a[0]==='54')tower=Number(a[1])*10;if(a[0]==='1054')tower=Number(a[1]);if(a[0]==='100'&&(a[8]===runwayName||a[17]===runwayName))runway=a;}
  if(!runway)throw Error('Runway geometry missing');
  const end=runway[8]===runwayName?8:17, other=end===8?17:8;
  const physical=[Number(runway[end+1]),Number(runway[end+2])];
  const opposite=[Number(runway[other+1]),Number(runway[other+2])];
  const trueCourse=Number(loc[6])%360;
  const threshold=destination(physical,trueCourse,Number(runway[end+3]));
  const pos=destination(threshold,(trueCourse+180)%360,CFG.distanceNm*1852);
  const angle=Math.floor(Number(gs[6])/1000)/100;
  const gsHeightAtStartFt=Number(gs[3])+Math.tan(angle*Math.PI/180)*distance(pos,[Number(gs[1]),Number(gs[2])])/0.3048;
  const acf=fs.readFileSync(path.join(CFG.simRoot,CFG.aircraft),'utf8');
  const climb=Number(acf.match(/P acf\/_fadec_tla\/2\s+([\d.]+)/)?.[1]);
  if(!Number.isFinite(climb))throw Error('CLB detent not found in aircraft definition');
  return {source,aptSource:apt,navHash:hash(source),airport:CFG.airport,runway:runwayName,ident:loc[7],category:loc.slice(11).join(' '),frequency:Number(loc[4]),magneticCourse:Math.floor(Number(loc[6])/360),trueCourse,glideslopeDeg:angle,threshold,physical,opposite,widthM:Number(runway[1]),landingLengthM:distance(physical,opposite)-Number(runway[end+3]),elevationFt:Number(gs[3]),towerKhz:tower,start:pos,altitudeFt:Math.floor((gsHeightAtStartFt-CFG.glideslopeMarginFt)/100)*100,climbDetent:climb,aircraftFootprint:acfGearFootprint(acf)};
}
class API {
  refs=new Map();commands=new Map();
  reset(){this.refs.clear();this.commands.clear();}
  async call(route,method='GET',body){const r=await fetch(CFG.api+route,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});const text=await r.text();let j;try{j=text?JSON.parse(text):null;}catch{throw Error('Non-JSON API response '+r.status);}if(!r.ok||(j?.error_code&&j.error_code!=='success'))throw Error(`API ${method} ${route}: ${r.status} ${text}`);return j;}
  async resource(name,command=false){const cache=command?this.commands:this.refs;if(!cache.has(name)){let j=await this.call(`/${command?'commands':'datarefs'}?filter[name]=${encodeURIComponent(name)}`);if(!j.data?.length)throw Error('Missing '+name);cache.set(name,j.data[0]);}return cache.get(name);}
  async get(name){const r=await this.resource(name);const j=await this.call(`/datarefs/${r.id}/value`);return r.value_type==='data'?Buffer.from(j.data,'base64').toString('utf8').replace(/\0.*$/s,''):j.data;}
  async set(name,value,index){const r=await this.resource(name);if(r.is_writable===false)throw Error('Read-only '+name);if(index!==undefined){const full=await this.get(name);if(!Array.isArray(full)||index<0||index>=full.length)throw Error('Invalid array index');full[index]=Array.isArray(value)?value[0]:value;value=full;}const body={data:r.value_type==='data'?Buffer.from(value).toString('base64'):value};const result=await this.call(`/datarefs/${r.id}/value`,'PATCH',body);log('actions',{...stamp(await this.get('sim/time/total_flight_time_sec')),name,value,index,result});return this.get(name);}
  async command(name,duration=0){const c=await this.resource(name,true);const result=await this.call(`/command/${c.id}/activate`,'POST',{duration});log('actions',{...stamp(),command:name,result});return result;}
  async pause(){await this.command('sim/operation/pause_on');for(let i=0;i<10;i++){if(await this.get('sim/time/paused')===1)return;await sleep(150);}throw Error('Unable to confirm pause');}
  async resume(){await this.command('sim/operation/pause_off');await sleep(150);if(await this.get('sim/time/paused')===0&&await this.get('sim/time/sim_speed')===1)return;await this.set('sim/time/sim_speed',1);await this.command('sim/operation/pause_off');for(let i=0;i<10;i++){if(await this.get('sim/time/paused')===0&&await this.get('sim/time/sim_speed')===1)return;await sleep(150);}throw Error('Unable to resume simulation after pause-off and real-time reset');}
}
const api=new API();
async function powerNavReceivers(){
 for(const ref of [F.nav1Power,F.nav2Power])if(await api.get(ref)!==1)await api.set(ref,1);
}
const F={
 simTime:'sim/time/total_flight_time_sec',paused:'sim/time/paused',replay:'sim/time/is_in_replay',simSpeed:'sim/time/sim_speed',
 radioAltitudeFt:'sim/cockpit2/gauges/indicators/radio_altimeter_height_ft_pilot',flareMode:'sim/cockpit2/autopilot/flare_status',rolloutMode:'sim/cockpit2/autopilot/rollout_status',
 aircraft:'sim/aircraft/view/acf_relative_path',lat:'sim/flightmodel/position/latitude',lon:'sim/flightmodel/position/longitude',altMslM:'sim/flightmodel/position/elevation',aglM:'sim/flightmodel/position/y_agl',localX:'sim/flightmodel/position/local_x',localY:'sim/flightmodel/position/local_y',localZ:'sim/flightmodel/position/local_z',iasKts:'sim/flightmodel/position/indicated_airspeed',tasMps:'sim/flightmodel/position/true_airspeed',groundSpeedMps:'sim/flightmodel/position/groundspeed',headingTrue:'sim/flightmodel/position/psi',headingMag:'sim/flightmodel/position/mag_psi',pitch:'sim/flightmodel/position/theta',bank:'sim/flightmodel/position/phi',vsiFpm:'sim/cockpit2/gauges/indicators/vvi_fpm_pilot',verticalMps:'sim/flightmodel/position/local_vy',onGround:'sim/flightmodel/failures/onground_any',hasCrashed:'sim/flightmodel2/misc/has_crashed',fuelKg:'sim/flightmodel/weight/m_fuel_total',massKg:'sim/flightmodel/weight/m_total',
 ap1:'sim/cockpit2/autopilot/servos_on',ap2:'sim/cockpit2/autopilot/servos2_on',flightDirectorMaster:'sim/cockpit2/autopilot/master_flight_director',fdMasterPilot:'sim/cockpit2/autopilot/flight_director_master_pilot',fdMasterCopilot:'sim/cockpit2/autopilot/flight_director_master_copilot',flightDirectorMode:'sim/cockpit2/autopilot/flight_director_mode',flightDirector2Mode:'sim/cockpit2/autopilot/flight_director2_mode',landingChannelMode:'laminar/A333/PFD/FMAs/landing_single_dual',bankAngleMode:'sim/cockpit2/autopilot/bank_angle_mode',athrOn:'sim/cockpit2/autopilot/autothrottle_on',athrMode:'sim/cockpit2/autopilot/autothrottle_enabled',altMode:'sim/cockpit2/autopilot/altitude_hold_status',altitudeModeCode:'sim/cockpit2/autopilot/altitude_mode',verticalMode:'sim/cockpit2/autopilot/vvi_status',verticalTarget:'sim/cockpit2/autopilot/vvi_dial_fpm',fmaAltitudeMode:'laminar/A333/FMAs/alt_mode_enum',navMode:'sim/cockpit2/autopilot/nav_status',gsMode:'sim/cockpit2/autopilot/glideslope_status',headingMode:'sim/cockpit2/autopilot/heading_mode',headingTarget:'sim/cockpit2/autopilot/heading_dial_deg_mag_pilot',speedTarget:'sim/cockpit2/autopilot/airspeed_dial_kts',altTarget:'sim/cockpit2/autopilot/altitude_dial_ft',flaps:'sim/cockpit2/controls/flap_ratio',gear:'sim/cockpit2/controls/gear_handle_down',spoilers:'sim/cockpit2/controls/speedbrake_ratio',throttles:'sim/cockpit2/engine/actuators/throttle_ratio',fadec:'sim/flightmodel/engine/ENGN_fadec_pow_req',
 nav1:'sim/cockpit2/radios/actuators/nav1_frequency_hz',nav2:'sim/cockpit2/radios/actuators/nav2_frequency_hz',nav1Power:'sim/cockpit2/radios/actuators/nav1_power',nav2Power:'sim/cockpit2/radios/actuators/nav2_power',nav1Id:'sim/cockpit2/radios/indicators/nav1_nav_id',nav2Id:'sim/cockpit2/radios/indicators/nav2_nav_id',nav1Course:'sim/cockpit2/radios/actuators/nav1_obs_deg_mag_pilot',nav2Course:'sim/cockpit2/radios/actuators/nav2_obs_deg_mag_pilot',nav1CopilotCourse:'sim/cockpit2/radios/actuators/nav1_obs_deg_mag_copilot',nav2CopilotCourse:'sim/cockpit2/radios/actuators/nav2_obs_deg_mag_copilot',com1:'sim/cockpit2/radios/actuators/com1_frequency_hz_833',radioRx:'sim/atc/com1_rx',facility:'sim/atc/com1_tuned_facility',windDirectionDeg:'sim/weather/aircraft/wind_direction_degt',windSpeedKts:'sim/weather/aircraft/wind_speed_kts',effectiveWindDirectionDeg:'sim/weather/aircraft/wind_now_direction_degt',effectiveWindSpeedKts:'sim/weather/aircraft/wind_now_speed_msc',leftBrake:'sim/cockpit2/controls/left_brake_ratio',rightBrake:'sim/cockpit2/controls/right_brake_ratio',autobrake:'sim/cockpit2/switches/auto_brake_level',reversers:'sim/cockpit2/annunciators/reverser_on',mouse:'sim/joystick/mouse_is_joystick',pitchInput:'sim/joystick/yoke_pitch_ratio',rollInput:'sim/joystick/yoke_roll_ratio',yawInput:'sim/joystick/yoke_heading_ratio',hardware:'sim/joystick/joy_mapped_axis_avail',override:'sim/operation/override/override_joystick',warning:'sim/cockpit2/annunciators/master_warning',caution:'sim/cockpit2/annunciators/master_caution',stall:'sim/cockpit2/annunciators/stall_warning',overspeed:'sim/cockpit2/annunciators/airspeed_warning'
};
F.overspeed='sim/flightmodel/failures/over_vfe';
F.actualThrottle='sim/flightmodel/engine/ENGN_thro_use';
F.engineN1='sim/cockpit2/engine/indicators/N1_percent';
F.radioAltitudeFt='sim/cockpit2/gauges/indicators/radio_altimeter_height_ft_pilot';
F.flareMode='sim/cockpit2/autopilot/flare_status';
F.rolloutMode='sim/cockpit2/autopilot/rollout_status';
F.lowSpeedProtection='sim/flightmodel2/controls/airbus_speed_warn_thro_0';
F.airframeOverspeed='sim/flightmodel/failures/over_vne';
F.flaps='sim/cockpit2/controls/flap_handle_request_ratio';
F.flapsActual='sim/cockpit2/controls/flap_handle_deploy_ratio';
F.slatsActual='sim/flightmodel2/controls/slat1_deploy_ratio';
Object.assign(F,{configurationLimitKias:'laminar/A333/PFD/airspeed_ind/vmo_mmo',nextFlapLimitKias:'laminar/A333/PFD/airspeed_ind/next_flap_speed',fullFlapLimitKias:'sim/aircraft/view/acf_Vfe',localizerDots:'sim/cockpit2/radios/indicators/nav1_hdef_dots_pilot',glideslopeDots:'sim/cockpit2/radios/indicators/nav1_vdef_dots_pilot',localizerSignal:'sim/cockpit2/radios/indicators/nav1_display_horizontal',glideslopeSignal:'sim/cockpit2/radios/indicators/nav1_display_vertical'});
async function tuneILS(n){
 await powerNavReceivers();
 await api.set(F.nav1,n.frequency);await api.set(F.nav2,n.frequency);
 for(const ref of [F.nav1Course,F.nav2Course,F.nav1CopilotCourse,F.nav2CopilotCourse])await api.set(ref,n.magneticCourse);
}
async function observe(){const s={wallTime:new Date().toISOString(),missing:[]};await Promise.all(Object.entries(F).map(async([k,n])=>{try{s[k]=await api.get(n);}catch(e){s[k]=null;s.missing.push({field:k,error:e.message});}}));if(Number.isFinite(s.effectiveWindSpeedKts))s.effectiveWindSpeedKts*=1.94384449;const op=state(),n=op.activeNav||op.nav;if(n&&Number.isFinite(s.lat)&&Number.isFinite(s.lon)){s.intendedRunway=n.runway;s.track=track(n,s.lat,s.lon);s.runwayFootprint=runwayFootprint(s.track,n,s.headingTrue);s.runwayTracks=Object.fromEntries((op.navigation||[n]).map(r=>[r.runway,track(r,s.lat,s.lon)]));}return s;}
function protect(){const files=[];for(const sub of ['situations','replays']){const dir=path.join(CFG.simRoot,'Output',sub);if(fs.existsSync(dir))for(const f of fs.readdirSync(dir)){const p=path.join(dir,f);if(/\.(sit|rep)$/.test(f))files.push({path:p,sha256:hash(p)});}}return files;}
function checkProtected(){return (state().protectedFiles||[]).map(f=>({...f,unchanged:fs.existsSync(f.path)&&hash(f.path)===f.sha256}));}
export function setupChecks(s,n){
 const failures=[], fail=(c,x)=>{if(c)failures.push(x);};
 const required=['simTime','paused','replay','iasKts','altMslM','lat','lon','vsiFpm','verticalMps','bank','pitch','ap1','athrOn','athrMode','headingMode','verticalMode','verticalTarget','fmaAltitudeMode','lowSpeedProtection','airframeOverspeed','flapsActual','speedTarget','gear'];
 fail(required.some(k=>!Number.isFinite(s[k])),'required telemetry unavailable');
 fail(s.aircraft!==CFG.aircraft,'wrong aircraft');fail(s.replay!==0,'replay or replay status unavailable');
 fail(s.mouse!==0,'mouse joystick active or unavailable');
 fail(Math.max(Math.abs(s.pitchInput??1),Math.abs(s.rollInput??1),Math.abs(s.yawInput??1))>0.05,'nonneutral control input');
 fail(!Array.isArray(s.hardware)||s.hardware.some(x=>x!==0),'hardware axes present or unavailable: operator verification required');
 fail(s.override!==0,'joystick override enabled');fail(s.ap1!==1,'AP1 not engaged');fail(s.fdMasterPilot!==1,'AP1 is not the controlling flight-director master');
 fail(s.athrOn!==1||s.athrMode!==1,'autothrust speed mode not verified');
 fail(s.verticalMode!==2||Math.abs(s.verticalTarget)>1||s.fmaAltitudeMode!==10||s.headingMode!==1,'intended V/S 0 and HDG modes not captured');
 fail(Math.abs(s.iasKts-CFG.speedKts)>CFG.maxSpeedErrorKts||Math.abs(s.speedTarget-CFG.speedKts)>1,'speed outside setup band');
 // local_vy is an OpenGL/world-axis component, not a vertical-rate reading. Use the
 // aircraft's indicated VSI for the flight-path gate and retain local_vy only in logs.
 fail(Math.abs(s.vsiFpm)>CFG.maxVerticalSpeedFpm,'unexpected vertical speed');
 fail(Math.abs(s.bank)>CFG.maxBankDeg||Math.abs(s.pitch)>CFG.maxPitchDeg,'attitude outside setup band');
 fail(['warning','caution','stall','overspeed','airframeOverspeed','lowSpeedProtection'].some(k=>s[k]!==0),'warning/caution/protection or unavailable annunciator');
 fail(s.nav1!==n.frequency||s.nav2!==n.frequency||s.nav1Power!==1||s.nav2Power!==1,'ILS frequencies or receiver power mismatch');
 fail([s.nav1Course,s.nav2Course,s.nav1CopilotCourse,s.nav2CopilotCourse].some(course=>!Number.isFinite(course)||Math.abs(((course-n.magneticCourse+540)%360)-180)>1),'pilot/copilot ILS course mismatch');
 // A330 airborne CONF 1 extends slats without necessarily extending the trailing-edge flaps.
 const configDeployed=CFG.flapsRatio===0.25?s.slatsActual>0.25:Math.abs(s.flapsActual-CFG.flapsRatio)<=0.03;
 fail(s.gear!==(CFG.gearDown?1:0)||s.flaps!==CFG.flapsRatio||!configDeployed,'aircraft configuration not deployed');
 // Setup begins at 11.5 NM. A 30-second live verification at about 200 KIAS
 // naturally advances roughly 1.7 NM before the final paused readback.
 fail(!s.track||s.track.distanceNm<9.5||s.track.distanceNm>12.5||Math.abs(s.track.crossTrackM)>250,'approach geometry outside band');
 fail(Math.abs(s.altMslM/0.3048-n.altitudeFt)>150,'setup altitude mismatch');
 fail(!s.fadec||s.fadec[0]!==1||s.fadec[1]!==1,'CLB thrust-lever detents not verified');return failures;
}
function pocChecks(s,n){
 const failures=[],fail=(c,x)=>{if(c)failures.push(x);};
 fail(s.aircraft!==CFG.aircraft,'wrong aircraft');
 fail(s.replay!==0,'replay active or unavailable');
 fail(!Number.isFinite(s.iasKts)||s.iasKts<140||s.iasKts>280,'airspeed outside broad POC envelope');
 fail(!Number.isFinite(s.aglM)||s.aglM<300,'aircraft too low for handoff');
 fail(!s.track||s.track.distanceNm<8||s.track.distanceNm>14||Math.abs(s.track.crossTrackM)>1000,'aircraft outside broad approach area');
 fail(!Number.isFinite(s.headingTrue)||Math.abs(((s.headingTrue-n.trueCourse+540)%360)-180)>15,'aircraft not aligned with approach runway');
 fail(['warning','stall','overspeed','airframeOverspeed','hasCrashed'].some(k=>s[k]!==0),'critical warning, crash state or unavailable annunciator');
 fail(s.ap1!==1||s.fdMasterPilot!==1||s.athrOn!==1,'basic automation unavailable');
 return failures;
}
function verifyXPlaneProcess(){
 if(!watchXPlaneProcess||process.platform!=='darwin')return;
 let active=false;
 try{active=Boolean(execFileSync('/usr/bin/pgrep',['-x','X-Plane'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim());}catch{}
 if(active){observedXPlaneProcess=true;return;}
 if(observedXPlaneProcess){const error=Error('X-Plane closed during preparation. Click Load & prepare to start a new setup.');error.setupFatal=true;throw error;}
}
async function waitFor(test,timeout=20000){const t=Date.now();while(Date.now()-t<timeout){try{verifyXPlaneProcess();const v=await test();if(v)return v;}catch(error){if(error?.setupFatal)throw error;}await sleep(250);}throw Error('Timed out waiting for simulator state');}
function setupProgress(stage,detail){update({setupProgress:{stage,detail,updatedAt:new Date().toISOString()}});}
async function waitForSimulator(){
 const endpoint=new URL(CFG.api).origin+'/api/capabilities';let lastStage='';
 // There is deliberately no startup deadline here. On the demo build an
 // operator may leave the Use Demo or Understood screen open for several
 // minutes. The dashboard's Stop control and the X-Plane process watcher are
 // the cancellation mechanisms, so waiting for a human cannot become a false
 // setup failure.
 while(true){
  verifyXPlaneProcess();
  let apiAvailable=false;
  try{
   const response=await fetch(endpoint,{signal:AbortSignal.timeout(2000)});
   apiAvailable=response.ok;
   if(response.ok){
    try{
     // The web server starts before flight commands exist at the demo/menu screens.
     // Wait for usable controls, then secure the pause before setup proceeds.
     await api.resource('sim/operation/pause_on',true);
     await api.get(F.paused);
     await api.pause();
     return;
    }catch{}
   }
  }catch{}
  const stage=apiAvailable?'waiting_for_controls':'opening_simulator';
  if(stage!==lastStage){setupProgress(stage,apiAvailable?'X-Plane is open. Complete Use Demo and Understood; the flight will pause as soon as controls become available.':'Opening X-Plane or waiting for its local API');lastStage=stage;}
  await sleep(1000);
 }
}
async function pauseDuringSetup(stage,detail){
 setupProgress(stage,detail);
 await api.pause();
 if(await api.get(F.paused)!==1)throw Error(`Could not verify X-Plane is paused after ${detail.toLowerCase()}`);
}
async function keepPausedDuringSetup(){
 if(await api.get(F.paused)!==1)await pauseDuringSetup('securing_pause','an unexpected simulator resume');
}
export function physicsHasAdvanced(before,after){
 if(after.paused!==0||after.simSpeed!==1)return false;
 const changed=(key,tolerance)=>Number.isFinite(before[key])&&Number.isFinite(after[key])&&Math.abs(after[key]-before[key])>=tolerance;
 return changed('simTime',.05)||changed('aglM',.25)||changed('iasKts',.02)||changed('headingTrue',.02)||changed('lat',1e-7)||changed('lon',1e-7);
}
function unsafeInitialization(s){
 return s.hasCrashed||s.stall||s.overspeed||s.airframeOverspeed||!Number.isFinite(s.aglM)||s.aglM<250||Math.abs(s.bank)>20||Math.abs(s.pitch)>20;
}
async function setup(){
 update({landingHelper:{armed:false},ready:false,setupFailure:null});
 const profile=scenarioProfile(flag('--scenario','runway-change'));
 const run=runDir(), original=path.resolve(CFG.simRoot,flag('--sit',CFG.situation));
 if(!fs.existsSync(original)||path.extname(original)!=='.sit')throw Error('Configure an existing .sit file');
 if(!original.startsWith(path.join(CFG.simRoot,'Output/situations')+path.sep))throw Error('Loader accepts .sit files under Output/situations only; originals elsewhere are not moved');
 const n=navData(profile.runway||CFG.runway),navigation=[n,...(profile.kind==='runway-change'&&CFG.scenario?.alternateRunway?[navData(CFG.scenario.alternateRunway)]:[])];
 if(profile.kind==='weather'&&!/ILS-cat-III/i.test(n.category))throw Error(`Weather autoland scenario requires a CAT III ILS; installed ${n.airport} ${n.runway} is ${n.category}`);
 update({phase:'WAITING_FOR_SIMULATOR',run,scenarioId:profile.id,nav:n,activeNav:n,activeRunway:n.runway,navigation,scenarioMessages:[],scenarioMessageSequence:0,scenarioApplied:false,weatherBackup:null,weatherEvent:null,protectedFiles:protect(),ready:false,atc:{verified:false,reason:'No post-load native communication verified'},event:{state:'clear',delivery:'unverified'}});
 setupProgress('opening_simulator','Opening X-Plane or waiting for its local API');
 save(path.join(run,'manifest.json'),{...stamp(),config:CFG,scenario:profile,nav:n,sourceSituation:original,sourceHash:hash(original),codeHash:hash(fileURLToPath(import.meta.url))});
 let simulatorAvailable=false;
 try {
  await waitForSimulator();simulatorAvailable=true;
  update({phase:'SETTING_UP'});
  await pauseDuringSetup('securing_pause','securing an initial pause');
  const reuse=args.includes('--reuse-loaded');
  if(reuse){
   const existing=await observe();
   if(existing.aircraft!==CFG.aircraft||existing.replay!==0)throw Error('--reuse-loaded requires the configured A330 in normal flight mode');
   log('setup-decisions',{...stamp(existing.simTime),reuseLoaded:true,reason:'Avoid repeated scenery and Metal texture rebuilds during controlled iteration'});
  }else if(CFG.pocMode&&(CFG.nativeFlightInit||profile.kind==='weather')){
   await api.call('/flight','POST',{data:{aircraft:{path:CFG.aircraft},runway_start:{airport_id:CFG.airport,runway:n.runway,final_distance_in_nautical_miles:CFG.distanceNm},engine_status:{all_engines:{running:true}}}});
   await waitFor(async()=>await api.get(F.aircraft)===CFG.aircraft,60000);
   // A native flight reset initially reports the aircraft path while its
   // velocity and A330 systems are still zeroed. Retry the first real-time
   // frame while scenery is loading, then wait for observable flight state
   // below instead of using a fixed startup delay.
   let resumed=false;
   for(let attempt=0;attempt<20&&!resumed;attempt++){
    try{await api.resume();resumed=true;}catch{await sleep(1000);}
   }
   if(!resumed)throw Error('Native flight initialization never became runnable');
   await waitFor(async()=>{const s=await observe();return s.iasKts>50&&s.tasMps>50&&s.aglM>250;},20000);
   await pauseDuringSetup('pausing_after_load','native flight initialization');
   log('setup-decisions',{...stamp(),nativeFlightInit:true,reason:'Use X-Plane native final-approach initialization for a coherent POC state'});
  }else{
   setupProgress('waiting_for_loader','Waiting for X-Plane flight controls');
   await waitFor(async()=>{await keepPausedDuringSetup();return api.resource('agentakt/scenario/load_path');},120000);
   setupProgress('loading_situation','Loading the selected situation');
   await api.set('agentakt/scenario/load_path',path.relative(CFG.simRoot,original));
   await api.command('agentakt/scenario/load_situation');
   // XPLMLoadDataFile reloads aircraft plugins, including our loader. Its
   // in-memory sequence/status datarefs therefore reset and cannot be used as
   // durable completion markers. Discard cached numeric IDs and wait for the
   // post-reload API, pause command and configured aircraft instead.
   const loadRequestedAt=Date.now();let reloadObserved=false;
   api.reset();
   await waitFor(async()=>{
    try{
     const response=await fetch(new URL(CFG.api).origin+'/api/capabilities',{signal:AbortSignal.timeout(2000)});
     if(!response.ok){reloadObserved=true;return false;}
     api.reset();
     await api.resource('sim/operation/pause_on',true);
     const aircraft=await api.get(F.aircraft);
     // Some machines keep the web server reachable during reload. A small
     // minimum delay prevents the pre-reload A330 state from satisfying this
     // gate before the load request has taken effect.
     return aircraft===CFG.aircraft&&(reloadObserved||Date.now()-loadRequestedAt>=10000);
    }catch{reloadObserved=true;api.reset();return false;}
   },180000);
   await pauseDuringSetup('pausing_after_load','loading the situation');
   // The loader sequence advances before the A330 has rebuilt all derived
   // state. Wait for live aircraft telemetry instead of relying on a blind
   // delay. This is intentionally a broad POC check, not a full calibration.
   setupProgress('initializing_aircraft','Waiting for the loaded aircraft to report live state');
   await waitFor(async()=>{await keepPausedDuringSetup();const s=await observe();return s.aircraft===CFG.aircraft&&Number.isFinite(s.iasKts)&&s.iasKts>50&&Number.isFinite(s.aglM)&&s.aglM>250;},30000);
  }
  // Xlua flight_start and sensor initialization run on the first physics frames.
  // Run them before configuring automation; this is not the stability proof.
  const boot=await observe();log('telemetry',{phase:'initialization_before',...boot});
  if(boot.mouse!==0||boot.replay!==0)throw Error('Unsafe initialization input/replay state');
  if(!reuse){
   try{
    setupProgress('initializing_aircraft','Allowing the aircraft systems to initialize briefly');
    await resumeForSetup({resume:()=>api.resume(),checkCancelled:verifyXPlaneProcess,sleep,onRetry:error=>{
     setupProgress('initializing_aircraft','X-Plane is finishing loading. Waiting for aircraft initialization to become runnable.');
     log('setup-resume-wait',{...stamp(),error:error.message});
     api.reset();
    }});
    const wall=Date.now(),maxWarmupMs=30000;let advanced=false;
    while(Date.now()-wall<maxWarmupMs){
     verifyXPlaneProcess();await sleep(100);const b=await observe();log('telemetry',{phase:'initialization',...b});
     if(unsafeInitialization(b))throw Error('Initialization safety stop');
     if(physicsHasAdvanced(boot,b)){advanced=true;break;}
    }
    if(!advanced)throw Error('X-Plane reported pause off and real time, but no aircraft or simulation state changed within 30 seconds');
   }finally{await pauseDuringSetup('pausing_after_initialization','aircraft initialization');}
  }
  const loaded=await observe();log('telemetry',{phase:'loaded',...loaded});
  if(profile.kind==='weather'){
   setupProgress('configuring_aircraft','Establishing repeatable approach weather');
   const backup=await snapshotWeather(api),plan=windPlan(profile,n.trueCourse);
   update({weatherBackup:backup,weatherPlan:plan});
   await setWind(api,backup,plan.baseline,n.elevationFt);
   log('events',{...stamp(loaded.simTime),type:'weather_baseline_requested',wind:plan.baseline});
  }
  // Paused, setup-only relocation keeps the saved aircraft systems. Verify after physics resumes.
  if(loaded.mouse!==0||Math.max(Math.abs(loaded.pitchInput??1),Math.abs(loaded.rollInput??1),Math.abs(loaded.yawInput??1))>0.05||(loaded.hardware||[]).some(x=>x!==0))throw Error('Input interference detected; disable mouse control/center or disconnect hardware, then retry');
  if((!Number.isFinite(loaded.iasKts)||loaded.iasKts<50)&&(!CFG.pocMode||!Number.isFinite(loaded.tasMps)||loaded.tasMps<50))throw Error('Invalid loaded airspeed');
  // Dual-channel AP is for a coupled final approach. Leaving AP2 engaged
  // during vectoring or a go-around makes this A330 keep only a tiny bank and
  // ignore commanded descent profiles even while its mode datarefs claim the
  // selections are active. Begin every trial on AP1 only.
  if(loaded.ap2===1)await api.command('sim/autopilot/servos2_toggle');
  if(CFG.pocMode&&CFG.preserveSituationState&&!reuse&&n.runway===CFG.runway){
   // The saved approach is already dynamically coherent. For the POC, retain
   // its position, velocity, attitude and aircraft modes rather than creating
   // a synthetic state that needs time to settle.
   if(n.towerKhz)await api.set(F.com1,n.towerKhz);
   await tuneILS(n);
   if(await api.get(F.headingMode)!==1)await api.command('sim/autopilot/heading');
   await api.set(F.headingTarget,n.magneticCourse);
   await api.set('sim/cockpit2/autopilot/airspeed_is_mach',0);await api.command('laminar/A333/autopilot/speed_knob_pull');await api.set(F.speedTarget,CFG.speedKts);
   if(await api.get('sim/cockpit2/autopilot/flight_director_mode')===0)await api.command('sim/autopilot/fdir_on');
   if(loaded.ap1!==1)await api.command('sim/autopilot/servos_on');
   await api.command('sim/autopilot/autothrottle_arm');await api.command('sim/autopilot/autothrottle_on');
   await api.command('laminar/A333/autopilot/speed_knob_pull');
   await pauseDuringSetup('configuring_aircraft','configuring the preserved approach');
   log('setup-decisions',{...stamp(loaded.simTime),preserveSituationState:true,reason:'Use the saved, aerodynamically coherent approach for the POC'});
   update({phase:'CONFIGURED_UNVERIFIED',configuredAt:new Date().toISOString(),setupFailure:null});
  }else{
  // Nearby setup relocation through writable local coordinates. The evaluated
  // agent never receives these privileged controls.
  const radiansPerDegree=Math.PI/180,earth=6371000;
  const north=(n.start[0]-loaded.lat)*radiansPerDegree*earth;
  const east=(n.start[1]-loaded.lon)*radiansPerDegree*earth*Math.cos((n.start[0]+loaded.lat)*radiansPerDegree/2);
  await api.set(F.localX,loaded.localX+east);
  await api.set(F.localY,loaded.localY+(n.altitudeFt*0.3048-loaded.altMslM));
  await api.set(F.localZ,loaded.localZ-north);
  const relocationToleranceM=CFG.pocMode?250:100;
  // Local coordinates are a flat projection. Over a runway-direction change
  // across the airport, one geodesic-to-local estimate can miss by hundreds
  // of metres. Correct from the actual paused position before checking it.
  for(let attempt=0;attempt<4;attempt++){
   await sleep(150);
   const position=[await api.get(F.lat),await api.get(F.lon)];
   if(distance(n.start,position)<relocationToleranceM)break;
   const northCorrection=(n.start[0]-position[0])*radiansPerDegree*earth;
   const eastCorrection=(n.start[1]-position[1])*radiansPerDegree*earth*Math.cos((n.start[0]+position[0])*radiansPerDegree/2);
   await api.set(F.localX,(await api.get(F.localX))+eastCorrection);
   await api.set(F.localZ,(await api.get(F.localZ))-northCorrection);
  }
  await waitFor(async()=>distance(n.start,[await api.get(F.lat),await api.get(F.lon)])<relocationToleranceM,5000);
  for(let i=0;i<3;i++){
   const elevation=await api.get(F.altMslM),error=n.altitudeFt*0.3048-elevation;
   if(Math.abs(error)<3)break;
   await api.set(F.localY,(await api.get(F.localY))+error);
   await sleep(100);
  }
  // Match target air-relative velocity while accounting for the measured wind vector.
  const currentTrueKts=loaded.tasMps/0.514444;
  // A repeated paused setup may see the IAS indicator still filtered from the
  // source save even though true speed already matches the target. Keep a
  // near-target true speed instead of scaling it a second time.
  const speed=Math.abs(currentTrueKts-CFG.speedKts)<20?loaded.tasMps:loaded.tasMps*CFG.speedKts/loaded.iasKts, radians=n.trueCourse*Math.PI/180;
  // Preserve the save's approximate angle of attack when removing its descent.
  // Keeping its nose attitude alone would sharply reduce lift at the new level flight path.
  // Reuse can follow a failed or interrupted trial whose current pitch is not
  // representative of the saved approach. Use one deterministic POC attitude
  // so successive model runs do not inherit the previous model's maneuver.
  const pitchDeg=reuse?(CFG.initialPitchDeg??5.5):Math.max(1,Math.min(10,loaded.pitch-Math.atan2(loaded.verticalMps,loaded.groundSpeedMps)*180/Math.PI));
  await resetSetupOrientation(api,n.trueCourse,pitchDeg);
  log('setup-decisions',{...stamp(loaded.simTime),initialPitchDeg:pitchDeg,reason:'Preserve approximate loaded angle of attack during setup-only level-flight reset'});
  for(const [axis,v] of [['x',speed*Math.sin(radians)],['z',-speed*Math.cos(radians)]]){
   const wind=await api.get(`sim/weather/aircraft/wind_now_${axis}_msc`);
   await api.set(`sim/flightmodel/position/local_v${axis}`,v+wind);
  }
  // Remove the loaded save's descent. This is setup-only world velocity, not a
  // flight control exposed to the evaluated agent.
  await api.set('sim/flightmodel/position/local_vy',0);
  // Derived latitude/IAS may stay stale while paused. The stabilization gate checks them live.
  await tuneILS(n);
  await api.set('sim/cockpit2/radios/actuators/HSI_source_select_pilot',0);
  await api.set('sim/cockpit2/autopilot/airspeed_is_mach',0);await api.command('laminar/A333/autopilot/speed_knob_pull');await api.set(F.speedTarget,CFG.speedKts);
  await api.set(F.throttles,[n.climbDetent],0);await api.set(F.throttles,[n.climbDetent],1);
  await api.command('sim/autopilot/autothrottle_arm');await api.command('sim/autopilot/autothrottle_on');
  await api.set(F.flaps,CFG.flapsRatio);await api.set(F.gear,CFG.gearDown?1:0);await api.set(F.spoilers,0);
  if(await api.get(F.headingMode)!==1)await api.command('sim/autopilot/heading');
  await api.set(F.headingTarget,n.magneticCourse);
  const qnh=await api.get('sim/weather/aircraft/qnh_pas');
  for(const side of ['pilot','copilot']){await api.set(`sim/cockpit2/gauges/actuators/barometer_setting_is_std_${side}`,0);await api.set(`sim/cockpit2/gauges/actuators/barometer_setting_in_hg_${side}`,qnh/3386.389);}
  await api.set(F.altTarget,n.altitudeFt);
  // Use the aircraft-native selected V/S mode at zero. Generic ALT capture
  // develops a long-period oscillation after the paused physics reset.
  await api.set(F.verticalTarget,0);if(await api.get(F.verticalMode)!==2)await api.command('sim/autopilot/vertical_speed_pre_sel');
  if(await api.get('laminar/A333/autopilot/capt_FD_bars_bypass')!==1)await api.command('sim/autopilot/fdir_command_bars_toggle');
  if(await api.get(F.ap1)!==1)await api.command('sim/autopilot/servos_on');
  if(n.towerKhz)await api.set(F.com1,n.towerKhz);
  await pauseDuringSetup('configuring_aircraft','configuring the approach');
  update({phase:'CONFIGURED_UNVERIFIED',configuredAt:new Date().toISOString(),setupFailure:null});
  }
  // A paused synthetic reset leaves several derived A330 values on their
  // pre-reset frame and can retain a transient master warning. Advance a
  // minimal amount of real simulation time so every benchmark trial begins
  // from computed state rather than a frozen initialization frame.
  {
   const warm=await observe();
   try{
    setupProgress('initializing_aircraft','Waiting for the A330 avionics, then verifying the flight director and automation');
    await resumeForSetup({resume:()=>api.resume(),checkCancelled:verifyXPlaneProcess,sleep,onRetry:error=>{
     setupProgress('initializing_aircraft','X-Plane is finishing aircraft initialization. Waiting for live physics.');
     log('setup-resume-wait',{...stamp(),error:error.message});api.reset();
    }});
    // A restored A330 begins with the captain-side AHARS gyro below the
    // aircraft's 0.95 flight-director readiness threshold. AP commands issued
    // before that threshold are silently ignored. The flight director is
    // enabled only after the gyro is ready, so an initially-off FD cannot
    // create a circular readiness condition.
    const fdReadyAt=Date.now(),fdReadySim=warm.simTime;let gyroReady=false;
    while(Date.now()-fdReadyAt<60000){
     verifyXPlaneProcess();
     await sleep(100);
     const gyro=await api.get('sim/cockpit/gyros/gyr_spin');
     if(Array.isArray(gyro)&&gyro[0]>.95){gyroReady=true;break;}
     const s=await observe();
     if(unsafeInitialization(s))throw Error('Flight-director initialization safety stop');
     if(Number.isFinite(s.simTime)&&s.simTime-fdReadySim>=30)break;
    }
    if(!gyroReady)throw Error('Captain gyro did not become ready within 60 seconds or 30 seconds of simulation time');
    for(let attempt=0;attempt<3;attempt++){
     const mode=await api.get(F.flightDirectorMode);
     const bars=await api.get('sim/cockpit2/autopilot/flight_director_command_bars_pilot');
     if(mode!==0&&bars===1)break;
     await api.command('sim/autopilot/fdir_on');await sleep(300);
    }
    if(await api.get(F.flightDirectorMode)===0||await api.get('sim/cockpit2/autopilot/flight_director_command_bars_pilot')!==1)throw Error('Captain flight director could not be enabled after gyro initialization');
    // Re-establish selected-speed autothrust after the restored avionics have
    // initialized. A saved FMA can display SPEED while the restored thrust
    // state is not yet responding to the selected target.
    const automation=await observe();
    // The A330 may restore NAV frequencies while leaving both receiver power
    // switches off. A selected frequency alone is not a received ILS.
    await powerNavReceivers();
    await api.set(F.throttles,[n.climbDetent],0);await api.set(F.throttles,[n.climbDetent],1);
    for(const command of autothrustCommands(automation.athrMode,automation.athrOn))await api.command(command);
    await api.set(F.speedTarget,CFG.speedKts);
    // A situation can restore both AP channels, then leave the copilot flight
    // director as master after AP2 is removed. Reset the servo channel so AP1
    // is genuinely controlling rather than merely illuminated.
    if(await api.get(F.ap1)===1||await api.get(F.ap2)===1){await api.command('sim/autopilot/servos_off_any');await sleep(150);}
    // Re-engage AP1 only after the flight director is genuinely available.
    // A freshly reloaded A330 can ignore the first AP1 press while its xlua
    // systems are still completing their first live frames. Retry the normal
    // cockpit command briefly instead of declaring the benchmark unready.
    for(let attempt=0;attempt<3&&await api.get(F.ap1)!==1;attempt++){
     await api.command('sim/autopilot/servos_on');
     await sleep(500);
    }
    if(await api.get(F.fdMasterPilot)!==1)throw Error('AP1 engaged without becoming the controlling flight-director master');
    // Servo-channel changes can clear selected modes on the A330. Restore the
    // complete handoff state after AP1 is confirmed as the controlling side.
    if(await api.get(F.headingMode)!==1)await api.command('sim/autopilot/heading');
    await api.set(F.headingTarget,n.magneticCourse);
    await api.set(F.verticalTarget,0);
    if(await api.get(F.verticalMode)!==2)await api.command('sim/autopilot/vertical_speed_pre_sel');
    await api.command('laminar/A333/autopilot/speed_knob_pull');
    await api.set(F.speedTarget,CFG.speedKts);
    // Situation reloads can retain a master-warning latch after all measured
    // critical conditions have cleared. Acknowledge the latch once; a real
    // active condition will immediately reassert and fail the gate below.
    const beforeClear=await observe();
    if(!beforeClear.hasCrashed&&!beforeClear.stall&&!beforeClear.overspeed&&!beforeClear.airframeOverspeed){
     if(beforeClear.warning)await api.command('sim/annunciator/clear_master_warning');
     if(beforeClear.caution)await api.command('sim/annunciator/clear_master_caution');
    }
    const wall=Date.now();let settled=false;
    while(Date.now()-wall<30000){
     verifyXPlaneProcess();await sleep(100);const s=await observe();log('telemetry',{phase:'automation_warmup',...s});
     if(unsafeInitialization(s))throw Error('Automation warmup safety stop');
     if(s.simTime-warm.simTime>=1&&s.warning===0){settled=true;break;}
    }
    if(!settled)throw Error('Automation warmup did not reach a warning-free computed frame within 30 seconds');
   }finally{await pauseDuringSetup('pausing_after_initialization','the restored aircraft initialization');}
  }
  if(args.includes('--stabilize'))await stabilize();
  await pauseDuringSetup('verifying_ready','verifying the handoff state');
  const check=await status();
  if(!check.ready)throw Error(`Setup readback did not meet the POC handoff checks: ${check.checks.join('; ')||'unknown readiness failure'}`);
  if(profile.kind==='weather'){
   const baseline=state().weatherPlan.baseline,measured=check.telemetry;
   if(measured.nav1Power!==1||measured.nav2Power!==1||measured.nav1Id!==n.ident||measured.nav2Id!==n.ident||measured.localizerSignal!==1||measured.glideslopeSignal!==1)throw Error(`Weather approach has no verified ${n.ident} ILS on both NAV radios. Check receiver power and X-Plane Map > Approach; select ${n.airport} ${n.runway} ILS if non-approach ILS signals are disabled.`);
   if([measured.nav1Course,measured.nav2Course,measured.nav1CopilotCourse,measured.nav2CopilotCourse].some(course=>!nearHeading(course,n.magneticCourse)))throw Error(`Pilot and copilot ILS courses must both read ${n.magneticCourse}° before dual-channel autoland.`);
   if(!Number.isFinite(measured.effectiveWindSpeedKts)||Math.abs(measured.effectiveWindSpeedKts-baseline.speedKts)>5||angularDifference(measured.effectiveWindDirectionDeg,baseline.directionDeg)>35)throw Error(`Weather baseline did not reach the aircraft: requested ${Math.round(baseline.directionDeg)}°/${baseline.speedKts} kt, measured ${Math.round(measured.effectiveWindDirectionDeg)}°/${Math.round(measured.effectiveWindSpeedKts)} kt`);
   log('events',{...stamp(measured.simTime),type:'weather_baseline_verified',measured:{directionDeg:measured.effectiveWindDirectionDeg,speedKts:measured.effectiveWindSpeedKts}});
  }
  update({phase:'READY',ready:true,setupFailure:null});
  setupProgress('ready','Ready: X-Plane is paused and the evaluation handoff is available');
 }catch(e){
  const closedDuringSetup=Boolean(e?.setupFatal);
  update({phase:closedDuringSetup?'SETUP_CANCELLED':'SETUP_FAILED',ready:false,setupFailure:e.message});
  setupProgress(closedDuringSetup?'setup_cancelled':'failed',e.message);
  if(state().weatherBackup&&simulatorAvailable)try{await restoreWeather(api,state().weatherBackup);}catch(restoreError){log('events',{...stamp(),type:'weather_restore_failed',error:restoreError.message});}
  throw e;
 }
 finally{
  if(simulatorAvailable){try{await api.pause();}catch(pauseError){log('setup-pause-failure',{...stamp(),error:pauseError.message});}}
  log('preservation',{...stamp(),files:checkProtected()});
 }
 return status();
}
async function stabilize(){
 currentRun=state().run||runDir();const n=state().nav;if(!n)throw Error('Run setup first');
 const first=await observe();if(first.mouse!==0)throw Error('Mouse control active');
 const begin=Date.now();let previous=first, samples=[], captured=false;
 update({phase:'STABILIZING',ready:false});
 try{
  await api.set(F.verticalTarget,0);
  await api.command('sim/autopilot/vertical_speed_pre_sel');
  captured=await api.get(F.verticalMode)===2;
  await api.resume();
  while(Date.now()-begin<CFG.stabilizeWallTimeoutSeconds*1000){
   await sleep(CFG.sampleIntervalMs);const s=await observe();samples.push(s);log('telemetry',{phase:'stabilize',...s});
   if(!captured&&s.simTime-first.simTime>=0.5){await api.set(F.verticalTarget,0);await api.command('sim/autopilot/vertical_speed_pre_sel');captured=await api.get(F.verticalMode)===2;}
   const dt=s.simTime-previous.simTime;
   // IAS is filtered and initially reflects the loaded save, not the setup velocity.
   // Permit only monotonic convergence during the short settling window, while
   // retaining broad speed, attitude, warning and vertical-rate safety gates.
   const measuredAcceleration=dt>0?(s.iasKts-previous.iasKts)/dt:0;
   const converging=Math.abs(s.iasKts-CFG.speedKts)<Math.abs(previous.iasKts-CFG.speedKts);
   const expectedSettling=s.simTime-first.simTime<15&&converging&&Math.abs(measuredAcceleration)<60;
   const acceleration=expectedSettling?0:measuredAcceleration;
 const critical=['iasKts','vsiFpm','bank','pitch','ap1','athrOn','warning','caution','stall','overspeed','simTime','verticalMps','lowSpeedProtection','airframeOverspeed'];
   if(critical.some(k=>!Number.isFinite(s[k])))throw Error('Required telemetry missing');
   const settling=s.simTime-first.simTime<15;
   const speedUnsafe=settling?(s.iasKts<150||s.iasKts>230):Math.abs(s.iasKts-CFG.speedKts)>CFG.maxSpeedErrorKts;
   // The panel VSI has its own lag from the loaded save. During settling, also
   // require the actual world vertical velocity to stay within a tight bound.
   const verticalUnsafe=settling?(Math.abs(s.verticalMps)>6||Math.abs(s.vsiFpm)>1500):Math.abs(s.vsiFpm)>CFG.maxVerticalSpeedFpm;
   if(!s.ap1||!s.athrOn||s.warning||s.caution||s.stall||s.overspeed||s.lowSpeedProtection||s.airframeOverspeed||verticalUnsafe||Math.abs(s.bank)>CFG.maxBankDeg||Math.abs(s.pitch)>CFG.maxPitchDeg||speedUnsafe||(!settling&&Math.abs(acceleration)>CFG.maxAccelerationKtsPerSecond))throw Error('Stabilization safety stop: '+JSON.stringify({ias:s.iasKts,vsi:s.vsiFpm,vertical:s.verticalMps,bank:s.bank,ap:s.ap1,athr:s.athrOn,warning:s.warning,caution:s.caution,acceleration}));
   if(s.simTime-first.simTime>=CFG.stabilizeSimSeconds)break;previous=s;
  }
  const last=samples.at(-1);if(!last||last.simTime-first.simTime<CFG.stabilizeSimSeconds)throw Error('Insufficient simulation time to validate stability');
  const tail=samples.filter(s=>s.simTime>=last.simTime-10), failures=setupChecks(last,n);
  if(Math.max(...tail.map(s=>s.iasKts))-Math.min(...tail.map(s=>s.iasKts))>4)failures.push('speed not stable over final 10 seconds');
  if(failures.length)throw Error(failures.join('; '));
  update({phase:'FLIGHT_STATE_VERIFIED',flightVerifiedAt:new Date().toISOString(),flightVerifiedSim:last.simTime,ready:false});
 }catch(e){update({phase:'SETUP_FAILED',setupFailure:e.message,ready:false});throw e;}
 finally{await api.pause();}
}
async function captureATC(){
 if(!CFG.atc.windowId||!CFG.atc.roi)throw Error('ATC OCR blocked: configure verified X-Plane windowId and transcript-only ROI');
 const dir=state().run||ROOT,file=path.join(dir,`atc-${Date.now()}.png`);
 execFileSync(path.join(HERE,'bin/capture'),['capture',String(CFG.atc.windowId),file],{timeout:10000});
 const result=JSON.parse(execFileSync(path.join(HERE,'bin/capture'),[file],{timeout:10000,encoding:'utf8'}));
 const [x,y,w,h]=CFG.atc.roi;
 const lines=result.filter(r=>r.confidence>=CFG.atc.minimumConfidence&&r.box[0]>=x&&r.box[1]>=y&&r.box[0]+r.box[2]<=x+w&&r.box[1]+r.box[3]<=y+h).sort((a,b)=>b.box[1]-a.box[1]);
 if(!lines.length)throw Error('ATC transcript crop has no confidently recognized text');
 const s=state(), prior=s.ocrLines||[];
 // Sequence overlap, not global text deduplication: legitimate repeated instructions remain possible.
 const texts=lines.map(l=>l.text);
 const sim=await api.get(F.simTime), messages=newTranscriptLines(prior,texts).map((text,i)=>{const sequence=(s.messageSequence||0)+i+1;return {...stamp(sim),id:`native-${sequence}`,timestampMeaning:'first observed, not transmission time',sequence,text,source:'native-window-ocr',recognition:'OCR, not guaranteed verbatim; inspect screenshot',screenshot:file,acknowledged:false};});
 for(const m of messages)log('messages',m);
 update({ocrLines:texts,messageSequence:(s.messageSequence||0)+messages.length,lastMessages:[...(s.lastMessages||[]),...messages].slice(-100),lastOcrAt:new Date().toISOString()});
 return messages;
}
async function atcVerify(){currentRun=state().run;const messages=await captureATC();const all=state().lastMessages||[];const match=all.find(m=>Date.parse(m.wallTime)>=Date.parse(state().configuredAt||'2999-01-01')&&/cleared (?:to land|.*approach)|runway.*cleared/i.test(m.text));
 // OCR cannot authenticate recipient or distinguish stale UI history on its own.
 update({atc:{verified:false,reason:match?'Clearance candidate captured; operator must verify recipient and post-load freshness':'No post-load clearance candidate',candidate:match||null}});
 if(args.includes('--confirm-current-clearance')&&match){update({atc:{verified:true,method:'native-window-ocr + operator recipient/freshness confirmation',evidence:match,verifiedAt:new Date().toISOString()}});}
 return {messages,atc:state().atc};}
async function status(){const s=await observe(),op=state(),failures=op.nav?setupChecks(s,op.nav):['no setup'];const fresh=op.flightVerifiedAt&&Date.now()-Date.parse(op.flightVerifiedAt)<15*60*1000;
 const activeFailures=CFG.pocMode&&op.nav?pocChecks(s,op.nav):failures;
 const configured=['CONFIGURED_UNVERIFIED','FLIGHT_STATE_VERIFIED','READY'].includes(op.phase);
 const ready=CFG.pocMode
  ?Boolean(configured&&s.paused===1&&!activeFailures.length&&checkProtected().every(x=>x.unchanged))
  :Boolean(op.phase==='FLIGHT_STATE_VERIFIED'&&fresh&&op.atc?.verified&&s.paused===1&&!activeFailures.length&&checkProtected().every(x=>x.unchanged));
 update({ready});return {mode:CFG.pocMode?'POC':'STRICT',phase:ready?'READY':op.phase||'NOT_CONFIGURED',ready,setupFailure:op.setupFailure,checks:activeFailures,strictChecks:CFG.pocMode?failures:undefined,flightCheckFresh:Boolean(fresh),atc:op.atc,event:op.event,saves:checkProtected(),telemetry:s};}
// Used by the dashboard's frequent polling. It deliberately avoids a full
// observation, navigation calculation, and protected-file hashing pass. The
// full status check still runs immediately before an evaluation begins.
async function readiness(){
 const op=state(),[paused,aircraft,crashed]=await Promise.all([api.get(F.paused),api.get(F.aircraft),api.get(F.hasCrashed)]);
 const checks=[];
 if(paused!==1)checks.push('X-Plane is not paused');
 if(aircraft!==CFG.aircraft)checks.push('configured aircraft is not loaded');
 if(crashed!==0)checks.push('aircraft is in a crash state');
 const ready=Boolean(op.ready&&checks.length===0);
 return {mode:CFG.pocMode?'POC':'STRICT',phase:ready?'READY':op.phase||'NOT_CONFIGURED',ready,paused,aircraft,checks,message:ready?'Ready: X-Plane is paused.':'X-Plane is not ready for evaluation.'};
}
export function newTranscriptLines(prior,texts){let overlap=0;for(let n=1;n<=Math.min(prior.length,texts.length);n++)if(prior.slice(-n).join('\n')===texts.slice(0,n).join('\n'))overlap=n;return texts.slice(overlap);}
export function incursionBody(type,aircraft){const names={arm:'runway_incursion_arm',execute:'runway_incursion_execute',clear:'clear_incursion'};if(!Object.hasOwn(names,type))throw Error('Unknown event operation');return {data:{incursion:{aircraft:{path:aircraft},type:names[type]}}};}
async function applyRunwayChange(simTime=null){
 const alternate=(state().navigation||[]).find(x=>x.runway===CFG.scenario?.alternateRunway);if(!alternate)throw Error('Alternate runway navigation unavailable');
 const deliveredAt=simTime??await api.get(F.simTime),sequence=(state().scenarioMessageSequence||0)+1;
 const message={...stamp(deliveredAt),id:`scenario-${sequence}`,sequence,source:'simulated-atc',sender:`${CFG.airport} Tower`,text:`Runway ${CFG.runway} is unavailable. Cancel the approach to runway ${CFG.runway}. Cleared for the approach and landing on runway ${alternate.runway}. Acknowledge and reconfigure.`,acknowledged:false};
 const messages=[...(state().scenarioMessages||[]),message];update({scenarioMessages:messages,scenarioMessageSequence:sequence,scenarioApplied:true,scenarioAppliedAt:message.simTime,activeNav:alternate,activeRunway:alternate.runway});log('messages',message);log('events',{...message,type:'runway_change_delivered',from:CFG.runway,to:alternate.runway});return message;
}
async function advanceWeatherScenario(s,profile){
 const op=state(),plan=op.weatherPlan||windPlan(profile,op.nav.trueCourse);
 let event=op.weatherEvent;
 if(!event){
  if(!Number.isFinite(s.track?.distanceNm)||s.track.distanceNm>plan.triggerDistanceNm)return;
  event={status:'ramping',delivery:'pending',startedSimTime:s.simTime,startedWallTime:new Date().toISOString(),distanceNm:s.track.distanceNm,radioAltitudeFt:s.radioAltitudeFt,lastStep:0,baseline:plan.baseline,target:plan.target,runwayTrueCourse:op.nav.trueCourse};
  update({weatherEvent:event});log('events',{...stamp(s.simTime),type:'weather_shift_started',distanceNm:event.distanceNm,radioAltitudeFt:event.radioAltitudeFt});
 }
 const recoveryStart=event.startedSimTime+plan.rampSeconds+plan.holdSeconds;
 const recoveryStep=weatherRecoveryStep(plan,event.startedSimTime,s.simTime);
 if(recoveryStep!==null){
  const recoveryWind=plan.recovery||plan.baseline;
  const step=recoveryStep;
  if(!event.recovery){event={...event,status:'recovering',recovery:{startedSimTime:recoveryStart,lastStep:-1,delivery:'pending'}};update({weatherEvent:event});}
  if(step>event.recovery.lastStep){
   const requested=interpolateWind(plan.target,recoveryWind,step/plan.recoverySteps);
   await setWind(api,state().weatherBackup,requested,state().nav.elevationFt);
   event={...event,recovery:{...event.recovery,lastStep:step,requested,finalRequestedSimTime:step===plan.recoverySteps?s.simTime:event.recovery.finalRequestedSimTime}};update({weatherEvent:event});
   log('events',{...stamp(s.simTime),type:'weather_recovery_step',step,requested});
   if(step===plan.recoverySteps)return;
  }
  if(step===plan.recoverySteps&&s.simTime>event.recovery.finalRequestedSimTime&&event.recovery.delivery!=='verified'&&angularDifference(s.effectiveWindDirectionDeg,recoveryWind.directionDeg)<=8&&Math.abs(s.effectiveWindSpeedKts-recoveryWind.speedKts)<=2){
   const sequence=(state().scenarioMessageSequence||0)+1;
   const message={...stamp(s.simTime),id:`scenario-${sequence}`,sequence,source:'simulated-weather-report',sender:`${CFG.airport} weather`,text:`Updated approach-area wind: from ${Math.round(s.effectiveWindDirectionDeg)} degrees true at ${Math.round(s.effectiveWindSpeedKts)} knots.`,acknowledged:false};
   event={...event,status:'recovered',recovery:{...event.recovery,delivery:'verified',deliveredSimTime:s.simTime}};
   update({weatherEvent:event,scenarioMessages:[...(state().scenarioMessages||[]),message],scenarioMessageSequence:sequence});log('messages',message);log('events',{...stamp(s.simTime),type:'weather_recovery_verified'});
  }
  return;
 }
 if(event.delivery==='verified'||event.delivery==='unverified')return;
 const elapsed=s.simTime-event.startedSimTime,step=Math.min(plan.steps,Math.floor(elapsed/(plan.rampSeconds/plan.steps)));
 if(step>event.lastStep){
  const requested=interpolateWind(plan.baseline,plan.target,step/plan.steps);
  await setWind(api,state().weatherBackup,requested,state().nav.elevationFt);
  event={...event,lastStep:step,requested,finalRequestedSimTime:step===plan.steps?s.simTime:event.finalRequestedSimTime};
  update({weatherEvent:event});log('events',{...stamp(s.simTime),type:'weather_ramp_step',step,requested,measured:{directionDeg:s.effectiveWindDirectionDeg,speedKts:s.effectiveWindSpeedKts}});
  // This sample predates the write. Verify delivery from a later aircraft
  // observation, never from the wind measured before the final ramp step.
  if(step===plan.steps)return;
 }
 if(event.lastStep!==plan.steps)return;
 if(s.simTime<=event.finalRequestedSimTime)return;
 const measured={directionDeg:s.effectiveWindDirectionDeg,speedKts:s.effectiveWindSpeedKts};
 if(windDelivered(measured,plan.baseline,plan.target)){
  const sequence=(state().scenarioMessageSequence||0)+1;
  const message={...stamp(s.simTime),id:`scenario-${sequence}`,sequence,source:'simulated-weather-report',sender:`${CFG.airport} weather`,text:`Updated approach-area wind: from ${Math.round(measured.directionDeg)} degrees true at ${Math.round(measured.speedKts)} knots.`,acknowledged:false};
  event={...event,status:'delivered',delivery:'verified',deliveredSimTime:s.simTime,measured,components:windComponents(measured,state().nav.trueCourse)};
  update({weatherEvent:event,scenarioMessages:[...(state().scenarioMessages||[]),message],scenarioMessageSequence:sequence});
  log('messages',message);log('events',{...stamp(s.simTime),type:'weather_shift_delivered',measured,components:event.components});
 }else if(s.simTime-event.finalRequestedSimTime>15){
  event={...event,status:'delivery_unverified',delivery:'unverified',measured};
  update({weatherEvent:event});log('events',{...stamp(s.simTime),type:'weather_delivery_unverified',measured,target:plan.target});
 }
}
export function assessMission(touchdown,nav,crashed,final){
 const t=touchdown?.track,onIntendedRunway=withinRunway(t,nav,touchdown?.runwayFootprint);
 const stoppedOnRunway=withinRunway(final?.track,nav,final?.runwayFootprint);
 const stopped=Boolean(final?.onGround&&final?.groundSpeedMps<1);
 const touchdownVerticalFpm=Number.isFinite(touchdown?.preContactVerticalMps)?touchdown.preContactVerticalMps*196.850394:touchdown?.preContactVsiFpm??null;
 const runwayExcursion=Boolean(final?.runwayExcursion||(stopped&&!stoppedOnRunway)),failureReasons=[],automationDeficiencies=[];
 if(crashed)failureReasons.push('The aircraft crashed.');
 if(!touchdown)failureReasons.push('The aircraft did not touch down.');
 else if(!onIntendedRunway)failureReasons.push('The aircraft did not touch down on the assigned runway.');
 if(touchdown&&!stopped)failureReasons.push('The aircraft did not come to a stop.');
 if(stopped&&!stoppedOnRunway)failureReasons.push('The aircraft crossed the assigned runway boundary during rollout and stopped outside it.');
 else if(runwayExcursion)failureReasons.push('The aircraft crossed the assigned runway boundary during rollout.');
 if(touchdown&&touchdown.rolloutMode!==2)automationDeficiencies.push('Native ROLLOUT was not active at touchdown; runway-centerline steering was not under verified dual-channel autoland control.');
 return {missionCompleted:Boolean(touchdown&&onIntendedRunway&&stopped&&stoppedOnRunway&&!runwayExcursion&&!crashed),crashed:Boolean(crashed),touchedDown:Boolean(touchdown),onIntendedRunway,stopped,stoppedOnRunway,runwayExcursion,failureReasons,automationDeficiencies,autolandRolloutActiveAtTouchdown:touchdown?touchdown.rolloutMode===2:null,touchdownVerticalFpm,landingQuality:touchdownVerticalFpm===null?'unknown':Math.abs(touchdownVerticalFpm)<=360?'smooth':Math.abs(touchdownVerticalFpm)<=600?'firm':'hard'};
}
async function trafficEvidence(){const t={...stamp(await api.get(F.simTime))};for(const [k,n] of Object.entries({ids:'modeS_id',lat:'position/lat',lon:'position/lon',altM:'position/ele',onGround:'position/weight_on_wheels'})){try{t[k]=await api.get('sim/cockpit2/tcas/targets/'+n);}catch(e){t[k]={unavailable:e.message};}}return t;}
async function trigger(type){const body=incursionBody(type,CFG.event.aircraft);currentRun=state().run;const before=await observe(),trafficBefore=await trafficEvidence();
 const response=await api.call('/flight','PATCH',body);
 const evidence={...stamp(before.simTime),operation:type,response,trafficBefore,trafficAfter:await trafficEvidence(),aircraftAppearance:'unverified',nativeATCResponse:'unverified',note:'TCAS snapshots alone do not establish ATC participation or runway obstruction'};
 log('events',evidence);update({event:{state:type==='clear'?'clear':type,delivery:'unverified',evidence}});return evidence;}
export const ACTIONS={
 landing_support_arm:{description:'Requires airborne, gear down, landing flaps at least .75, AP1 engaged and both localizer and glideslope captured. Arm simulator pilot assistance: idle thrust at 20 ft radio height ONLY in active flare; at ground contact select idle, deploy spoilers and reverse; stow reverse below 30 m/s. Does NOT apply wheel brakes or select autobrake: select the desired autobrake mode separately and monitor deceleration. Does not steer, activate autoland, or choose a flight path. Cancels on go-around.'},
 landing_support_disarm:{description:'Cancel armed landing assistance.'},
 autobrake_mode:{valueType:'string',values:['off','low','medium'],description:'Select the A330 named autobrake mode through its native cockpit button; verify selected state. Numeric level 3 means LOW, 4 means MEDIUM.'},
 heading:{ref:'sim/cockpit2/autopilot/heading_dial_deg_mag_pilot',min:0,max:360,description:'Select a magnetic heading and idempotently engage HDG mode, including a verified exit path from GA TRK'},
 altitude:{ref:F.altTarget,min:0,max:40000,description:'Select an altitude only. This does not silently change the active vertical mode.'},
 speed:{ref:F.speedTarget,min:100,max:300,command:'laminar/A333/autopilot/speed_knob_pull'},
 vertical_speed:{ref:'sim/cockpit2/autopilot/vvi_dial_fpm',min:-3000,max:3000,commands:['laminar/A333/autopilot/vertical_knob_pull'],description:'Select and engage the A330 vertical-speed profile through its aircraft-native FCU pull command'},
 level_change:{command:'laminar/A333/autopilot/altitude_knob_pull',description:'Engage an altitude-changing mode toward the already selected altitude. Select altitude first.'},
 level_off:{description:'Command selected vertical speed zero while retaining the selected altitude target.'},
 flaps:{ref:F.flaps,values:[0,0.25,0.5,0.75,1]},gear:{ref:F.gear,values:[0,1]},
 nav1:{ref:F.nav1,min:10800,max:11795},nav2:{ref:F.nav2,min:10800,max:11795},
 nav_course:{refs:[F.nav1Course,F.nav2Course,F.nav1CopilotCourse,F.nav2CopilotCourse],min:0,max:360},
 tune_ils:{valueType:'string',description:'Power and tune both navigation receivers, including pilot and copilot ILS courses, for a named runway from the supplied navigation data. Verify received station IDs and signals separately.'},
 com1:{ref:F.com1,min:118000,max:136990},
 approach:{command:'sim/autopilot/approach',description:'Idempotently arm coupled localizer/glideslope approach; repeated requests do not toggle an already armed/captured approach off'},
 localizer:{command:'sim/autopilot/NAV',description:'Idempotently arm localizer/navigation capture; repeated requests do not toggle an already armed/captured mode off'},
 autopilot1:{description:'Idempotently engage the verified AP1 control channel for vectoring and coupled approach tracking'},
 autopilot2:{description:'Engage the native A330 AP2 channel for dual-channel autoland only after AP1 and both localizer and glideslope are captured. Configures independent flight directors, but does not directly arm FLARE or ROLLOUT. Verify dualChannelReady and the reported FLARE/ROLLOUT states; go around if required modes do not arm.'},
 autopilot2_off:{description:'Disengage the second autopilot channel when leaving a dual-channel approach. Verify AP1 and the active guidance modes afterward; this does not choose a new trajectory.'},
 toga:{description:'Move both A330 thrust levers to the TOGA detent and request native takeoff/go-around guidance. This does not select a missed-approach heading, altitude or speed. Verify thrust, guidance modes and an actual climb; later return thrust levers to CLB as appropriate.'},
 autothrust:{description:'Engage selected-speed autothrust and place both A330 thrust levers in the CLB detent required for normal airborne A/THR control'},
 autothrust_disconnect:{command:'sim/autopilot/autothrottle_hard_off',description:'Press the native autothrust disconnect control: disengage and disarm A/THR. Does not select thrust lever position or a flight path. Can clear a retained thrust state, but low-speed protection may reactivate if unsafe conditions persist. Check airspeed, engine output and guidance; use autothrust separately to re-arm/re-engage when appropriate.'},
 acknowledge_message:{valueType:'string',description:'Acknowledge a received communication by its exact message id. Native messages use the verified ATC readback command.'},atc_window:{command:'sim/operation/contact_atc'}
};
// Normal cockpit controls needed for rollout; no joystick or physics override access.
Object.assign(ACTIONS,{throttle_idle:{command:'sim/engines/throttle_idle'},reverse_toggle:{command:'sim/engines/thrust_reverse_toggle'},wheel_brakes:{refs:['sim/cockpit2/controls/left_brake_ratio','sim/cockpit2/controls/right_brake_ratio'],min:0,max:1},speedbrakes_arm:{description:'Arm ground spoilers for landing.'},speedbrakes_retract:{description:'Retract speedbrakes.'},speedbrakes_deploy:{description:'Fully deploy speedbrakes for rollout only.'},autobrake:{ref:'sim/cockpit2/switches/auto_brake_level',values:[0,1,2,3,4,5]}});

for(const [name,description] of Object.entries({"speed":"Select airspeed in KIAS and selected-speed mode. Requires working autothrust to control speed. Verify speedTarget and actual iasKts; setting a target is not reaching it.","flaps":"Set flap handle: 0 clean, .25 configuration 1, .5 configuration 2, .75 configuration 3, 1 full. Observe actual deployment and speed limits.","gear":"Set landing gear handle: 0 up, 1 down. Respect aircraft extension and retraction limits.","nav1":"Power and tune NAV1 in 10 kHz units, e.g. 11130 means 111.30 MHz. Does not select a course or engage approach.","nav2":"Power and tune NAV2 in 10 kHz units. Does not select a course or engage approach.","nav_course":"Set pilot and copilot navigation receiver courses in magnetic degrees; both sides must agree for dual-channel autoland.","com1":"Tune COM1 in kHz. Tuning alone does not establish clearance.","atc_window":"Open native ATC window. This tool does not obtain or invent a clearance.","throttle_idle":"Command engine throttles to idle. This changes thrust; monitor autothrust behavior and airspeed.","reverse_toggle":"Toggle reverse thrust. Inspect reversers first: repeated calls can turn reverse off. Intended for ground rollout.","wheel_brakes":"Apply equal left and right wheel brakes: 0 released, 1 full braking. Does not steer or manage deceleration automatically.","autobrake":"Set raw simulator autobrake selector 0 through 5. Prefer autobrake_mode with named modes; raw values are simulator-specific.","altitude":"Set selected indicated altitude in feet. Does not engage a climb or descent mode; inspect altTarget and active vertical mode.","vertical_speed":"Select and engage vertical speed in feet/minute: positive climb, negative descent. Verify actual vertical mode, rate and altitude progress.","level_change":"Request native altitude-changing mode toward selected altitude. No fallback vertical rate is chosen. Verify mode engagement; a request can remain pending."}))ACTIONS[name].description=description;
export function validateAction(body){const a=Object.hasOwn(ACTIONS,body.action)?ACTIONS[body.action]:null;if(!a)throw Error('Action not allowed');if(a.valueType==='string'){if(typeof body.value!=='string'||!body.value.trim())throw Error('Invalid action value');}else if((a.ref||a.refs)&&(!Number.isFinite(body.value)||(a.values?!a.values.includes(body.value):body.value<a.min||body.value>a.max))){throw Error('Invalid action value');}else if(!(a.ref||a.refs)&&body.value!==undefined&&body.value!==null)throw Error('Action does not accept a value');return a;}
export function headingSelectCommand(headingMode){return headingMode===1?null:'sim/autopilot/heading';}
export function shortestHeadingTurnCommand(current,target){
 const delta=((target-current+540)%360)-180;
 if(Math.abs(delta)<0.5)return null;
 return delta>0?'sim/autopilot/heading_up':'sim/autopilot/heading_down';
}
export function speedSelectCommand(){return 'laminar/A333/autopilot/speed_knob_pull';}
export function autothrustCommands(athrMode,athrOn){const commands=[];if(athrMode<0)commands.push('sim/autopilot/autothrottle_arm');if(athrOn!==1)commands.push('sim/autopilot/autothrottle_on');commands.push('laminar/A333/autopilot/speed_knob_pull');return commands;}
const near=(a,b,tolerance)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tolerance;
const nearHeading=(a,b,tolerance=1)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(((a-b+540)%360)-180)<=tolerance;
export function actionOutcome(body,s){
 if(s.hasCrashed)return {status:'failed',reason:'aircraft crash state detected'};
 let ok=false,pendingReason='command was sent but no verified state signal is available yet',successReason='requested control or mode state verified; flight-path effectiveness is not verified';
 switch(body.action){
  case 'landing_support_arm':ok=state().landingHelper?.armed===true;break;
  case 'landing_support_disarm':ok=!state().landingHelper?.armed;break;
  case 'autobrake_mode':ok=s.autobrake===({off:1,low:3,medium:4}[body.value]);break;
  case 'heading':ok=nearHeading(s.headingTarget,body.value)&&s.headingMode===1;pendingReason=`selected heading ${s.headingTarget}, active ${modeName('heading',s.headingMode)}`;successReason='selected heading and HDG mode verified; confirm distance, threshold and cross-track trends in later observations';break;
  case 'altitude':ok=near(s.altTarget,body.value,10);pendingReason=`selected altitude ${s.altTarget}`;break;
  case 'speed':ok=near(s.speedTarget,body.value,1)&&s.athrOn===1;pendingReason=`selected speed ${s.speedTarget}, autothrust ${modeName('autothrust',s.athrOn)}`;break;
  case 'vertical_speed':ok=near(s.verticalTarget,body.value,50)&&s.verticalMode===2;pendingReason=`selected vertical speed ${s.verticalTarget}, active ${modeName('vertical',s.verticalMode)}`;break;
  case 'level_off':ok=near(s.verticalTarget,0,50)&&s.verticalMode===2;pendingReason=`selected vertical speed ${s.verticalTarget}, active ${modeName('vertical',s.verticalMode)}`;break;
  case 'level_change':ok=s.ap1===1&&s.verticalMode!==0;pendingReason=`AP1 ${s.ap1}, vertical ${modeName('vertical',s.verticalMode)}`;break;
  case 'approach':ok=s.navMode>0&&s.gsMode>0;pendingReason=`localizer ${modeName('lateral',s.navMode)}, glideslope ${modeName('glideslope',s.gsMode)}`;successReason=`approach modes verified as localizer ${modeName('lateral',s.navMode)} and glideslope ${modeName('glideslope',s.gsMode)}; armed is not captured`;break;
  case 'localizer':ok=s.navMode>0;pendingReason=`localizer ${modeName('lateral',s.navMode)}`;successReason=`localizer mode verified as ${modeName('lateral',s.navMode)}; armed is not captured`;break;
  case 'autopilot1':ok=s.ap1===1&&s.fdMasterPilot===1;pendingReason=`AP1 ${s.ap1}, pilot master ${s.fdMasterPilot}`;break;
  case 'autopilot2':ok=s.ap1===1&&s.ap2===1&&s.flightDirectorMaster===2&&s.landingChannelMode===2;pendingReason=`AP1/AP2 ${s.ap1}/${s.ap2}, FD master ${modeName('flightDirectorMaster',s.flightDirectorMaster)}, landing channel ${modeName('landingChannel',s.landingChannelMode)}, FLARE/ROLLOUT ${modeName('autoland',s.flareMode)}/${modeName('autoland',s.rolloutMode)}`;break;
  case 'autopilot2_off':ok=s.ap2===0;pendingReason=`AP2 ${s.ap2}`;break;
  case 'toga':ok=Array.isArray(s.throttles)&&s.throttles.slice(0,2).every(x=>x>=.95);pendingReason=`thrust levers ${JSON.stringify(s.throttles)}, heading ${modeName('heading',s.headingMode)}; confirm positive climb in subsequent observations`;successReason='TOGA thrust lever positions verified; guidance and actual climb require subsequent confirmation';break;
  case 'autothrust':ok=s.athrOn===1;pendingReason=`autothrust ${modeName('autothrust',s.athrOn)}, FADEC modes ${JSON.stringify(s.fadec?.slice(0,2))}, actual throttle ${JSON.stringify(s.actualThrottle?.slice(0,2))}`;break;
  case 'autothrust_disconnect':ok=s.athrOn===0&&s.athrMode===-1;pendingReason=`autothrust on=${s.athrOn}, mode=${s.athrMode}; protection may reactivate`;successReason='Autothrust disengaged and disarmed; monitor engine output and aircraft state';break;
  case 'go_around':ok=s.ap1===1&&s.fdMasterPilot===1&&s.athrOn===1&&s.headingMode===1&&s.verticalMode===2&&s.verticalTarget>0;pendingReason='go-around targets are selected but one or more control modes are not active';break;
  case 'flaps':ok=near(s.flaps,body.value,.01);pendingReason=`flap handle ${s.flaps}`;break;
  case 'gear':ok=s.gear===body.value;pendingReason=`gear handle ${s.gear}`;break;
  case 'nav1':ok=s.nav1===body.value&&s.nav1Power===1;pendingReason=`NAV1 ${s.nav1}, receiver power ${s.nav1Power}`;break;
  case 'nav2':ok=s.nav2===body.value&&s.nav2Power===1;pendingReason=`NAV2 ${s.nav2}, receiver power ${s.nav2Power}`;break;
  case 'nav_course':ok=[s.nav1Course,s.nav2Course,s.nav1CopilotCourse,s.nav2CopilotCourse].every(course=>nearHeading(course,body.value));pendingReason=`NAV courses ${s.nav1Course}/${s.nav2Course}, copilot ${s.nav1CopilotCourse}/${s.nav2CopilotCourse}`;break;
  case 'com1':ok=s.com1===body.value;pendingReason=`COM1 ${s.com1}`;break;
  case 'tune_ils':{const runway=(state().navigation||[]).find(n=>n.runway.toUpperCase()===body.value.toUpperCase());ok=Boolean(runway&&s.nav1Power===1&&s.nav2Power===1&&s.nav1===runway.frequency&&s.nav2===runway.frequency&&[s.nav1Course,s.nav2Course,s.nav1CopilotCourse,s.nav2CopilotCourse].every(course=>nearHeading(course,runway.magneticCourse)));pendingReason=`NAV ${s.nav1}/${s.nav2}, receiver power ${s.nav1Power}/${s.nav2Power}, pilot/copilot courses ${s.nav1Course}/${s.nav2Course}/${s.nav1CopilotCourse}/${s.nav2CopilotCourse}`;break;}
  case 'acknowledge_message':{const op=state(),message=[...(op.lastMessages||[]),...(op.scenarioMessages||[])].find(m=>m.id===body.value);ok=Boolean(message?.acknowledged);pendingReason='message acknowledgment was not recorded';break;}
  case 'speedbrakes_arm':ok=near(s.spoilers,-.5,.05);pendingReason=`speedbrake ratio ${s.spoilers}`;break;
  case 'speedbrakes_retract':ok=near(s.spoilers,0,.05);pendingReason=`speedbrake ratio ${s.spoilers}`;break;
  case 'speedbrakes_deploy':ok=near(s.spoilers,1,.05);pendingReason=`speedbrake ratio ${s.spoilers}`;break;
  case 'wheel_brakes':ok=near(s.leftBrake,body.value,.05)&&near(s.rightBrake,body.value,.05);pendingReason=`brakes ${s.leftBrake}/${s.rightBrake}`;break;
  case 'autobrake':ok=s.autobrake===body.value;pendingReason=`autobrake ${s.autobrake}`;break;
  case 'throttle_idle':ok=Array.isArray(s.throttles)&&s.throttles.slice(0,2).every(x=>x<=.05)&&Array.isArray(s.actualThrottle)&&s.actualThrottle.slice(0,2).every(x=>x<=.05);pendingReason=`lever positions ${JSON.stringify(s.throttles?.slice(0,2))}, actual throttle ${JSON.stringify(s.actualThrottle?.slice(0,2))}, FADEC modes ${JSON.stringify(s.fadec?.slice(0,2))}; idle lever selection alone does not verify reduced engine output`;successReason='Idle levers and low actual throttle verified; engine spool-down and deceleration require monitoring';break;
  case 'reverse_toggle':ok=Array.isArray(s.reversers)&&s.reversers.some(Boolean);pendingReason=`reversers ${JSON.stringify(s.reversers)}`;break;
 }
 return ok?{status:'satisfied',reason:successReason}:{status:'pending',reason:pendingReason};
}
export async function agentAction(body){const a=validateAction(body);
 const before=await observe();if(before.paused)throw Error('Evaluation not running');
 if(body.action==='landing_support_arm'){
  if(before.onGround||before.gear!==1||before.flaps<.75||before.ap1!==1||before.navMode!==2||before.gsMode!==2)throw Error('Arm landing support when airborne, gear down, landing flaps, AP1 and localizer/glideslope captured');
  update({landingHelper:{armed:true,idleIssued:false,groundSeen:false,reverseStowed:false}});
 }
 if(body.action==='landing_support_disarm')update({landingHelper:{armed:false}});
 if(body.action==='autopilot2_off'&&before.ap2===1)await api.command('sim/autopilot/servos2_toggle');
 if(body.action==='toga'){
  if(before.onGround)throw Error('TOGA go-around is available only while airborne');
  update({landingHelper:{armed:false}});
  await api.set(F.throttles,[1],0);await api.set(F.throttles,[1],1);
  await api.command('sim/autopilot/take_off_go_around');
 }
 if(body.action==='autobrake_mode'){
  const target={off:1,low:3,medium:4}[body.value];if(target===undefined)throw Error('Unknown autobrake mode');
  if(before.autobrake!==target){if(target===1)await api.set(F.autobrake,1);else await api.command(body.value==='low'?'sim/flight_controls/brakes_1_auto':'sim/flight_controls/brakes_2_auto');}
 }
 const alreadyActive=(body.action==='approach'&&before.navMode>0&&before.gsMode>0)||(body.action==='localizer'&&before.navMode>0);
 // The A330's heading-knob pull performs heading sync when heading_mode is 18
 // (GA TRK) or 1 (HDG). That overwrites the requested selector value and can
 // leave the aircraft trapped in GA TRK. The underlying X-Plane heading-select
 // command is what the aircraft's own handler uses to enter HDG from other
 // modes, so call it directly only when HDG is not already active.
 const headingCommand=body.action==='heading'?headingSelectCommand(before.headingMode):null;
 // Enter HDG before writing the selected target. The mode-transition command
 // itself synchronizes the selector to present track, so writing first loses
 // the requested value even though heading_mode changes successfully.
 if(headingCommand)await api.command(headingCommand);
 if(body.action==='heading'){
  // A direct circular-dial write can retain X-Plane's previous turn direction
  // and send the aircraft through the long arc. Sync to present heading, give
  // the FCU one explicit clockwise/counter-clockwise step, then apply the
  // requested target so equivalent trials receive deterministic vectoring.
  await api.command('sim/autopilot/heading_sync');await sleep(100);
  const turn=shortestHeadingTurnCommand(before.headingMag,body.value);
  if(turn){await api.command(turn);await sleep(100);}
 }
 // Pulling the A330 speed knob opens selected-speed mode by invoking X-Plane's
 // speed-intervention command. When the window is closed, that transition
 // synchronizes the dial to the current managed speed. Perform it before the
 // requested write so the transition cannot overwrite the agent's target.
 if(body.action==='speed')await api.command(speedSelectCommand());
 if(body.action==='level_off'){await api.set(F.verticalTarget,0);await api.command('laminar/A333/autopilot/vertical_knob_pull');}
 if(['nav1','nav2','tune_ils'].includes(body.action))await powerNavReceivers();
 if(body.action==='tune_ils'){
  const runway=(state().navigation||[]).find(n=>n.runway.toUpperCase()===body.value.toUpperCase());
  if(!runway)throw Error(`Unknown runway ${body.value}`);
  await tuneILS(runway);
 }
 if(body.action==='acknowledge_message'){
  const op=state(),all=[...(op.lastMessages||[]),...(op.scenarioMessages||[])],message=all.find(m=>m.id===body.value);
  if(!message)throw Error(`Unknown message id ${body.value}`);
  if(message.source==='native-window-ocr')await api.command('sim/operation/atc_readback');
  const acknowledgedAt=new Date().toISOString(),mark=m=>m.id===body.value?{...m,acknowledged:true,acknowledgedAt}:m;
  update({lastMessages:(op.lastMessages||[]).map(mark),scenarioMessages:(op.scenarioMessages||[]).map(mark)});
 }
 if(body.action==='speedbrakes_arm')await api.set(F.spoilers,-.5);
 if(body.action==='speedbrakes_retract')await api.set(F.spoilers,0);
 if(body.action==='speedbrakes_deploy')await api.set(F.spoilers,1);
 if(body.action==='autothrust'){
  const climb=(state().activeNav||state().nav||navData()).climbDetent;
  await api.set(F.throttles,[climb],0);await api.set(F.throttles,[climb],1);await sleep(200);
  for(const command of autothrustCommands(before.athrMode,before.athrOn)){await api.command(command);await sleep(100);}
 }
 if(body.action==='autopilot1'&&(before.ap1!==1||before.fdMasterPilot!==1)){
  if(await api.get('sim/cockpit2/autopilot/flight_director_mode')===0)await api.command('sim/autopilot/fdir_on');
  if(before.ap1===1||before.ap2===1){await api.command('sim/autopilot/servos_off_any');await sleep(150);}
  await api.set(F.bankAngleMode,3);
  await api.command('sim/autopilot/servos_on');
  await api.set(F.bankAngleMode,3);
 }
 if(body.action==='autopilot2'){
  if(before.onGround||before.ap1!==1||before.navMode!==2||before.gsMode!==2)throw Error('Engage AP2 only when airborne with AP1 and both localizer and glideslope captured');
  if(before.flightDirector2Mode===0)await api.command('sim/autopilot/fdir2_on');
  // X-Plane requires both flight directors to operate independently for
  // dual-channel autoland. This is aircraft-system configuration, not a
  // direct write to FLARE or ROLLOUT, which remain read-only outcomes.
  if(before.flightDirectorMaster!==2)await api.set(F.flightDirectorMaster,2);
  // servos2_on reselects the copilot as master in this installed A330,
  // disengaging AP1. The documented FD-mode dataref avoids that command's
  // master-selection heuristic. Native guidance still controls the aircraft.
  if(before.ap2!==1)await api.set(F.flightDirector2Mode,2);
 }

 if(a.ref)await api.set(a.ref,body.value);if(a.refs)for(const ref of a.refs)await api.set(ref,body.value);
 const actionAlreadySatisfied=alreadyActive;
 if(!['heading','speed'].includes(body.action)&&a.command&&!actionAlreadySatisfied)await api.command(a.command);
 if(a.commands)for(const command of a.commands)await api.command(command);

 await sleep(150);
 const after=await observe(),outcome=actionOutcome(body,after);log('agent-actions',{...stamp(after.simTime),requested:body,before,after,outcome});
 return {accepted:true,outcome,state:pilotState(after,before)};}
async function smokeAction(){
 const action=args[1];if(!action)throw Error('Usage: smoke-action ACTION [JSON_VALUE]');
 const raw=args[2],value=raw===undefined?undefined:JSON.parse(raw),wasPaused=await api.get(F.paused)===1;
 try{
  if(wasPaused){await api.resume();await sleep(250);}
  const result=await agentAction(value===undefined?{action}:{action,value});
  await sleep(1500);
  return {...result,final:pilotState(await observe())};
 }finally{if(wasPaused)await api.pause();}
}
async function serviceLandingSupport(s){
 const helper=state().landingHelper,nav=state().activeNav||state().nav;
 const step=landingStep(s,helper,nav);if(!step)return;
 const started=Date.now();
 if(step==='retard'){
  await api.command('sim/engines/throttle_idle');
  update({landingHelper:{...helper,idleIssued:true}});
 }else if(step==='ground_braking'){
  await api.command('sim/engines/throttle_idle');
  await api.set(F.spoilers,1);
  if(!s.reversers?.some(Boolean))await api.command('sim/engines/thrust_reverse_toggle');
  update({landingHelper:{...helper,idleIssued:true,groundSeen:true}});
 }else if(step==='stow_reverse'||step==='bounce'){
  if(s.reversers?.some(Boolean))await api.command('sim/engines/thrust_reverse_toggle');
  await api.command('sim/engines/throttle_idle');
  if(step==='bounce'){await api.set(F.spoilers,-.5);await api.set(F.leftBrake,0);await api.set(F.rightBrake,0);}
  update({landingHelper:{...helper,reverseStowed:step==='stow_reverse',groundSeen:step!=='bounce'}});
 }
 log('landing-support',{...stamp(s.simTime),step,executionMs:Date.now()-started,before:s,after:await observe()});
}
async function start(){
 const profile=chosenScenario();
 const preflight=args.includes('--preflight');
 if(state().scenarioId!==profile.id)throw Error(`Prepared scenario ${state().scenarioId} does not match requested ${profile.id}; prepare again.`);
 const check=await status();if(!check.ready)throw Error('NOT READY: '+JSON.stringify({phase:check.phase,checks:check.checks,atc:check.atc}));
 const lock=path.join(ROOT,'evaluation.lock');const fd=fs.openSync(lock,'wx');fs.writeSync(fd,String(process.pid));fs.closeSync(fd);
 currentRun=state().run;const token=crypto.randomBytes(24).toString('hex'),instructions=fs.readFileSync(path.join(HERE,'OPERATING_INSTRUCTIONS.md'),'utf8');save(path.join(ROOT,'agent-access.json'),{url:`http://127.0.0.1:${CFG.agentPort}`,token});
 let stopping=false,agentFinish=null,lastAgentObservation=null,beginRequested=!preflight;
 const server=http.createServer(async(req,res)=>{try{if(req.headers.authorization!==`Bearer ${token}`){res.writeHead(401);return res.end();}let out;
 if(req.method==='GET'&&req.url==='/observation'){const raw=await observe(),op=state(),messages=[...(op.lastMessages||[]),...(op.scenarioMessages||[])].sort((a,b)=>(a.simTime??0)-(b.simTime??0)||(a.sequence??0)-(b.sequence??0));out={state:pilotState(raw,lastAgentObservation),messages,communicationRevision:messages.map(m=>`${m.id}:${m.acknowledged?'ack':'new'}`).join('|'),budget:{simulationSecondsRemaining:Math.max(0,CFG.maxEvalSimSeconds-(raw.simTime-(op.evaluationStartSimTime??raw.simTime))),wallSecondsRemaining:Math.max(0,CFG.maxEvalWallSeconds-(Date.now()-(op.evaluationStartedAt??Date.now()))/1000)},communications:{mode:'simulated clearance and weather reports; acknowledge messages by id; interactive clearance requests are not implemented',lastObserved:op.lastOcrAt||null}};lastAgentObservation=raw;}
 else if(req.method==='GET'&&req.url==='/instructions')out={mission:'Land the aircraft at KPDX',operatingInstructions:instructions};
 else if(req.method==='GET'&&req.url==='/controls')out=Object.fromEntries(Object.entries(ACTIONS).map(([name,a])=>[name,{requiresValue:Boolean(a.ref||a.refs||a.valueType),valueType:a.valueType||(a.ref||a.refs?'number':null),min:a.min,max:a.max,values:name==='tune_ils'?(state().navigation||[]).map(n=>n.runway):a.values,description:a.description}]));
 else if(req.method==='GET'&&req.url==='/navigation')out={planned:state().nav,availableRunways:state().navigation||[state().nav]};
 else if(req.method==='POST'&&req.url==='/begin'){beginRequested=true;out={accepted:true};}
 else if(req.method==='POST'&&req.url==='/action'){let raw='';for await(const b of req){raw+=b;if(raw.length>4096)throw Error('Body too large');}out=await agentAction(JSON.parse(raw));}
 else if(req.method==='POST'&&req.url==='/finish'){let raw='';for await(const b of req){raw+=b;if(raw.length>4096)throw Error('Body too large');}agentFinish=JSON.parse(raw||'{}');out={accepted:true};}
 else{res.writeHead(404);return res.end();}
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(out));}catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
 process.once('SIGINT',()=>stopping=true);process.once('SIGTERM',()=>stopping=true);
 const begin=Date.now(),first=await observe();
 update({evaluationStartedAt:begin,evaluationStartSimTime:first.simTime});
 const initial={...stamp(first.simTime),id:'initial-clearance',source:'simulated-atc',sender:`${CFG.airport} Tower`,text:`Cleared for approach and landing runway ${state().activeRunway}.`,acknowledged:false};update({scenarioMessages:[initial]});log('messages',initial);
let last=first,lastOCR=0,armAt=null,touchdown=null,stopCount=0,crashed=false,runwayExcursion=false,outcome='operator_stopped';
const evaluationSamples=[];
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(CFG.agentPort,'127.0.0.1',resolve);});update({phase:'EVALUATING',ready:false});
 if(preflight){
  const deadline=Date.now()+180000;
  while(!beginRequested&&!stopping&&Date.now()<deadline)await sleep(100);
  if(!beginRequested)throw Error(stopping?'Evaluation stopped before preflight decision':'Timed out waiting for the first preflight decision');
  log('events',{...stamp(first.simTime),type:'preflight_decision_ready'});
 }
 if(!stopping)await api.resume();
 console.log(JSON.stringify({running:true,agentAccessFile:path.join(ROOT,'agent-access.json'),mission:'Land the aircraft at KPDX'}));
 while(!stopping){await sleep(CFG.sampleIntervalMs);const s=await observe();log('telemetry',{phase:'evaluation',...s});evaluationSamples.push(s);if(agentFinish){last=s;const a=assessMission(touchdown,state().activeNav||state().nav,crashed,s);outcome=a.missionCompleted?'mission_completed':agentFinish.reason==='decision_limit'?'decision_limit':'agent_stopped';log('events',{...stamp(s.simTime),type:'agent_finish',...agentFinish,assessment:a});break;}if(s.simTime<last.simTime){outcome='infrastructure_sim_reset';break;}if(s.paused||s.simSpeed!==1){outcome='interrupted_or_time_changed';break;}
 if(CFG.atc.windowId&&CFG.atc.roi&&Date.now()-lastOCR>CFG.atc.intervalMs){try{await captureATC();lastOCR=Date.now();}catch(e){log('events',{...stamp(s.simTime),type:'observation_failure',error:e.message});lastOCR=Date.now();if(!CFG.pocMode){outcome='infrastructure_communications_failure';break;}}}
 const elapsed=s.simTime-first.simTime;
 if(!suppressScenarioEvent&&profile.kind==='runway-change'&&CFG.scenario?.runwayChangeAfterSimSeconds!==null&&!state().scenarioApplied&&elapsed>=CFG.scenario.runwayChangeAfterSimSeconds)await applyRunwayChange(s.simTime);
 if(!suppressScenarioEvent&&profile.kind==='weather')await advanceWeatherScenario(s,profile);
 if(CFG.event.automatic){const due=(CFG.event.afterSimSeconds!==null&&elapsed>=CFG.event.afterSimSeconds)||(CFG.event.withinRunwayNm!==null&&s.track?.distanceNm<=CFG.event.withinRunwayNm);if(due&&armAt===null){await trigger('arm');armAt=s.simTime;}if(armAt!==null&&s.simTime-armAt>=CFG.event.armLeadSimSeconds&&state().event?.state==='arm')await trigger('execute');}
 if(!last.onGround&&s.onGround){touchdown={...stamp(s.simTime),type:'touchdown_candidate',lat:s.lat,lon:s.lon,iasKts:s.iasKts,groundSpeedMps:s.groundSpeedMps,preContactVerticalMps:last.verticalMps,preContactVsiFpm:last.vsiFpm,bank:s.bank,pitch:s.pitch,ap1:s.ap1,ap2:s.ap2,flightDirectorMaster:s.flightDirectorMaster,landingChannelMode:s.landingChannelMode,flareMode:s.flareMode,rolloutMode:s.rolloutMode,track:s.track,runwayFootprint:s.runwayFootprint,sampleIntervalSim:s.simTime-last.simTime};log('events',touchdown);}
 if(touchdown&&s.onGround&&!withinRunway(s.track,state().activeNav||state().nav,s.runwayFootprint))runwayExcursion=true;
 s.runwayExcursion=runwayExcursion;
 await serviceLandingSupport(s);
 if(s.hasCrashed){crashed=true;outcome='crashed';log('events',{...stamp(s.simTime),type:'crash_detected',state:s});last=s;break;}
 if(profile.goal==='go-around'&&!touchdown){const completion=goAroundCompletion(evaluationSamples,rows(currentRun,'agent-actions.jsonl'),state().weatherEvent);if(completion.complete){outcome='go_around_completed';last=s;log('events',{...stamp(s.simTime),type:'go_around_completed',completion});break;}}
 stopCount=touchdown&&s.onGround&&s.groundSpeedMps<1?stopCount+1:0;if(stopCount>=10){last=s;const a=assessMission(touchdown,state().activeNav||state().nav,crashed,s);outcome=a.missionCompleted?'mission_completed':'landed_but_objective_not_completed';break;}
 if(elapsed>CFG.maxEvalSimSeconds||Date.now()-begin>CFG.maxEvalWallSeconds*1000){outcome='time_limit';last=s;break;}last=s;
 }
 }catch(e){outcome='infrastructure_failure';log('events',{...stamp(),error:e.message});throw e;}
 finally{try{await api.pause();}finally{server.close();fs.unlinkSync(lock);const intendedNav=state().activeNav||state().nav,assessment=assessMission(touchdown,intendedNav,crashed,last),actions=rows(currentRun,'agent-actions.jsonl'),messages=rows(currentRun,'messages.jsonl'),weatherAssessment=profile.kind==='weather'?assessWeatherRun(evaluationSamples,actions,state().weatherEvent,assessment,{goal:profile.goal}):null;const result={...stamp(last.simTime),outcome,scenarioId:profile.id,intendedRunway:intendedNav?.runway,...assessment,weatherAssessment,weatherEvent:state().weatherEvent,fuelStartKg:first.fuelKg,fuelRemainingKg:last.fuelKg,fuelUsedKg:first.fuelKg-last.fuelKg,start:first,final:last,touchdown,event:state().event,saves:checkProtected()};result.score=scoreEvaluation({scenarioId:profile.id,result,actions,messages});update({phase:'FINISHED',outcome,mission:assessment,ready:false});save(path.join(currentRun,'result.json'),result);if(profile.kind==='weather')try{await restoreWeather(api,state().weatherBackup);log('events',{...stamp(),type:'weather_restored'});}catch(error){log('events',{...stamp(),type:'weather_restore_failed',error:error.message});}}}
}
function rows(p,name){const file=p&&path.join(p,name);return file&&fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];}
function report(){
 const op=state(),p=op.run,samples=rows(p,'telemetry.jsonl'),evals=samples.filter(x=>x.phase==='evaluation'),events=rows(p,'events.jsonl'),actions=rows(p,'agent-actions.jsonl'),messages=rows(p,'messages.jsonl');
 const recordedResult=p&&fs.existsSync(path.join(p,'result.json'))?json(path.join(p,'result.json')):null;
 const corrected=recordedResult?assessMission(recordedResult.touchdown,op.activeNav||op.nav,recordedResult.crashed,recordedResult.final):null;
 const result=recordedResult?{...recordedResult,...corrected,outcome:corrected?.missionCompleted&&recordedResult.outcome==='agent_declared_failure'?'mission_completed':recordedResult.outcome==='mission_completed'&&!corrected.missionCompleted?'landed_but_objective_not_completed':recordedResult.outcome}:null;
 const first=evals[0],last=evals.at(-1),touchdown=result?.touchdown||events.find(x=>x.type==='touchdown_candidate')||null;
 const absMax=(items,fn)=>items.length?Math.max(...items.map(x=>Math.abs(fn(x))).filter(Number.isFinite)):null;
 const eventExecution=events.find(x=>x.operation==='execute'||x.type==='runway_change_delivered'||x.type==='weather_shift_delivered'),firstPostEventAction=eventExecution&&actions.find(x=>x.simTime>=eventExecution.simTime);
 const metrics=first&&last?{wallDurationSeconds:(Date.parse(last.wallTime)-Date.parse(first.wallTime))/1000,simDurationSeconds:last.simTime-first.simTime,fuelUsedKg:first.fuelKg-last.fuelKg,fuelRemainingKg:last.fuelKg,maxCrossTrackM:absMax(evals,x=>x.track?.crossTrackM),maxSpeedErrorKts:absMax(evals,x=>x.iasKts-x.speedTarget),maxVerticalSpeedFpm:absMax(evals,x=>x.vsiFpm),maxBankDeg:absMax(evals,x=>x.bank),maxPitchDeg:absMax(evals,x=>x.pitch),criticalWarningSamples:evals.filter(x=>x.warning||x.stall||x.overspeed||x.hasCrashed).length,finalGroundSpeedMps:last.groundSpeedMps,agentActionCount:actions.length,eventResponseSimSeconds:firstPostEventAction?firstPostEventAction.simTime-eventExecution.simTime:null,touchdown}:null;
 const limitations=[];
 if(!op.atc?.verified)limitations.push('Native ATC transcript observation is not verified');
 if((op.scenarioId||'runway-change')==='runway-change'&&op.event?.delivery!=='verified')limitations.push('Incursion HTTP acceptance is not aircraft appearance or native ATC delivery proof');
 if(op.scenarioId?.startsWith('weather-')&&result?.weatherAssessment?.eventDelivery!=='verified')limitations.push('Weather change at the aircraft was not verified; do not score model decision quality for this run');
 if(op.scenarioId?.startsWith('weather-'))limitations.push('Selected-speed tracking is not a verified weight-dependent A330 VAPP calculation; stabilization gates are prototype policy, not certification');
 limitations.push('Same-host action allowlist is not an operating-system security boundary','Touchdown values are sampled at the configured interval, not exact per-frame contact values');
 if(!result)limitations.push('No final evaluated AI flight has been run');
 return {phase:op.phase,ready:op.ready,run:p,scenarioId:op.scenarioId||'runway-change',setupFailure:op.setupFailure,atc:op.atc,event:op.event,weatherEvent:op.weatherEvent,weatherAssessment:result?.weatherAssessment||null,outcome:result?.outcome||op.outcome||null,objectives:corrected,score:result?scoreEvaluation({scenarioId:result.scenarioId||op.scenarioId||'runway-change',result,actions,messages}):null,records:{telemetry:samples.length,evaluation:evals.length,actions:actions.length,messages:messages.length,events:events.length},metrics,sourceFiles:checkProtected(),limitations};
}
async function main(){const op=args[0];if(op==='nav')return navData(args[1]||CFG.runway);if(op==='status')return status();if(op==='readiness')return readiness();if(op==='setup')return setup();if(op==='stabilize')return stabilize();if(op==='smoke-action')return smokeAction();if(op==='start')return start();if(op==='trigger')return trigger(args[1]);if(op==='scenario'&&args[1]==='runway-change')return applyRunwayChange();if(op==='clear')return trigger('clear');if(op==='pause'){await api.pause();return {paused:true};}if(op==='atc'){if(args[1]==='open'){await api.command('sim/operation/contact_atc');return {requested:true};}if(args[1]==='readback'){await api.command('sim/operation/atc_readback');return {requested:true};}return atcVerify();}if(op==='report')return report();throw Error('Usage: node scenario.mjs nav [RUNWAY]|setup [--scenario runway-change|weather-mild|weather-challenge|weather-headwind] [--sit PATH] [--reuse-loaded]|stabilize|smoke-action ACTION [JSON_VALUE]|status|readiness|start [--scenario ID] [--no-scenario-event]|trigger arm|trigger execute|scenario runway-change|clear|atc open|atc readback|atc verify [--confirm-current-clearance]|pause|report [--config FILE]');}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(x=>{if(x!==undefined)console.log(JSON.stringify(x,null,2));}).catch(e=>{console.error(JSON.stringify({error:e.message}));process.exitCode=1;});
