const KTS_PER_MPS=1.94384449;
const region={
 direction:'sim/weather/region/wind_direction_degt',
 speed:'sim/weather/region/wind_speed_msc',
 altitude:'sim/weather/region/wind_altitude_msl_m',
 variability:'sim/weather/region/variability_pct',
 changeMode:'sim/weather/region/change_mode',
 immediate:'sim/weather/region/update_immediately',
 source:'sim/weather/region/weather_source'
};
const normalized=degrees=>(degrees%360+360)%360;
export const angularDifference=(a,b)=>Math.abs(((a-b+540)%360)-180);

export function interpolateWind(from,to,fraction){
 const t=Math.max(0,Math.min(1,fraction)),turn=((to.directionDeg-from.directionDeg+540)%360)-180;
 return {directionDeg:normalized(from.directionDeg+turn*t),speedKts:from.speedKts+(to.speedKts-from.speedKts)*t};
}

export function windComponents(wind,runwayTrueCourse){
 const angle=(wind.directionDeg-runwayTrueCourse)*Math.PI/180;
 return {headwindKts:wind.speedKts*Math.cos(angle),crosswindKts:wind.speedKts*Math.sin(angle)};
}

export function changedWindLayers(altitudes,values,replacement,fieldElevationFt){
 if(!Array.isArray(altitudes)||!Array.isArray(values)||altitudes.length!==values.length)throw Error('Weather wind layer arrays are unavailable or inconsistent');
 const ceilingM=fieldElevationFt*.3048+3000;
 return values.map((value,index)=>Number.isFinite(altitudes[index])&&altitudes[index]>=0&&altitudes[index]<=ceilingM?replacement:value);
}

export async function snapshotWeather(api){
 const result={};for(const [key,ref] of Object.entries(region))result[key]=await api.get(ref);
 if(result.source===1||result.changeMode===7)throw Error('Real Weather is active. Select a static weather preset before preparing a weather scenario.');
 return result;
}

export async function setWind(api,backup,wind,fieldElevationFt){
 await api.set(region.immediate,1);
 await api.set(region.changeMode,3);
 await api.set(region.variability,0);
 await api.set(region.direction,changedWindLayers(backup.altitude,backup.direction,wind.directionDeg,fieldElevationFt));
 await api.set(region.speed,changedWindLayers(backup.altitude,backup.speed,wind.speedKts/KTS_PER_MPS,fieldElevationFt));
}

export async function restoreWeather(api,backup){
 if(!backup)return;
 await api.set(region.immediate,1);
 await api.set(region.direction,backup.direction);
 await api.set(region.speed,backup.speed);
 await api.set(region.variability,backup.variability);
 await api.set(region.changeMode,backup.changeMode);
 await api.set(region.immediate,backup.immediate);
}

export function windDelivered(observed,baseline,target){
 if(!Number.isFinite(observed?.directionDeg)||!Number.isFinite(observed?.speedKts))return false;
 // Confirm a real, material change at the aircraft, not merely an accepted
 // regional write. X-Plane adds local variation to regional base weather.
 return observed.speedKts>=Math.max(5,target.speedKts-5)&&
  angularDifference(observed.directionDeg,target.directionDeg)<=35&&
  (angularDifference(observed.directionDeg,baseline.directionDeg)>=50||Math.abs(observed.speedKts-baseline.speedKts)>=5);
}
