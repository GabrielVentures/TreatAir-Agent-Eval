// X-Plane's physics reads q, not the display angles psi/theta/phi.
// Formula: https://developer.x-plane.com/article/movingtheplane/
export function orientationQuaternion(headingDeg,pitchDeg,rollDeg=0){
 if(![headingDeg,pitchDeg,rollDeg].every(Number.isFinite))throw Error('Invalid setup orientation');
 const [h,p,r]=[headingDeg,pitchDeg,rollDeg].map(x=>x*Math.PI/360);
 const ch=Math.cos(h),sh=Math.sin(h),cp=Math.cos(p),sp=Math.sin(p),cr=Math.cos(r),sr=Math.sin(r);
 return [ch*cp*cr+sh*sp*sr,ch*cp*sr-sh*sp*cr,ch*sp*cr+sh*cp*sr,-ch*sp*sr+sh*cp*cr];
}

export async function resetSetupOrientation(api,headingDeg,pitchDeg){
 if(await api.get('sim/time/paused')!==1)throw Error('Aircraft orientation reset requires a paused simulator');
 const q=orientationQuaternion(headingDeg,pitchDeg);
 await api.set('sim/flightmodel/position/q',q);
 // Match the paused visual state as well as the physics state.
 await api.set('sim/flightmodel/position/psi',headingDeg);
 await api.set('sim/flightmodel/position/theta',pitchDeg);
 await api.set('sim/flightmodel/position/phi',0);
 for(const name of ['P','Q','R'])await api.set(`sim/flightmodel/position/${name}`,0);
 const actual=await api.get('sim/flightmodel/position/q');
 if(!Array.isArray(actual)||actual.length!==4||actual.some(x=>!Number.isFinite(x))||Math.min(...[1,-1].map(sign=>Math.max(...q.map((x,i)=>Math.abs(actual[i]-sign*x)))))>0.0001)throw Error('X-Plane did not accept the aircraft orientation reset');
 return q;
}
