import test from 'node:test';
import assert from 'node:assert/strict';
import {orientationQuaternion,resetSetupOrientation} from './setup-orientation.mjs';

function angles([w,x,y,z]){
 return {heading:(Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z))*180/Math.PI+360)%360,pitch:Math.asin(2*(w*y-z*x))*180/Math.PI,roll:Math.atan2(2*(w*x+y*z),1-2*(x*x+y*y))*180/Math.PI};
}
test('quaternion gives the requested runway heading and level wings across a reversal',()=>{
 for(const heading of [0,90,119.13,180,299.13,359.9]){
  const q=orientationQuaternion(heading,5.5),a=angles(q);
  assert.ok(Math.abs(Math.hypot(...q)-1)<1e-12);
  assert.ok(Math.abs(((a.heading-heading+540)%360)-180)<1e-8);
  assert.ok(Math.abs(a.pitch-5.5)<1e-8);assert.ok(Math.abs(a.roll)<1e-8);
 }
});
test('manual 28R to 10R reset changes physics orientation, not just display angles',async()=>{
 const data=new Map([['sim/time/paused',1],['sim/flightmodel/position/q',orientationQuaternion(299.13,3)],...['P','Q','R'].map(k=>['sim/flightmodel/position/'+k,15])]);
 const api={get:async k=>data.get(k),set:async(k,v)=>data.set(k,v)};
 await resetSetupOrientation(api,119.13,5.5);
 const physical=angles(data.get('sim/flightmodel/position/q'));
 assert.ok(Math.abs(physical.heading-119.13)<1e-8);assert.ok(Math.abs(physical.roll)<1e-8);
 for(const k of ['P','Q','R'])assert.equal(data.get('sim/flightmodel/position/'+k),0);
 data.set('sim/time/paused',0);
 await assert.rejects(()=>resetSetupOrientation(api,119.13,5.5),/paused/);
});
test('setup rejects a simulator which ignores the quaternion write',async()=>{
 const api={get:async k=>k==='sim/time/paused'?1:orientationQuaternion(299.13,3),set:async()=>{}};
 await assert.rejects(()=>resetSetupOrientation(api,119.13,5.5),/did not accept/);
});
