import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CONFIG_FILE=path.join(HERE,'config.json');
export const DEFAULT_STATE_ROOT=path.join(HERE,'.state');
export const LOCAL_CONFIG_NAME='local-config.json';
export const BUNDLED_SITUATION_NAME='Runway Change Airbus A330-300 Situation.sit';

function readJson(file){return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};}
function writeJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temp=`${file}.tmp-${process.pid}-${crypto.randomUUID()}`;fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);}
function sha256(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}

export function loadConfig(baseFile=DEFAULT_CONFIG_FILE,stateRoot=process.env.XPLANE_SCENARIO_STATE||DEFAULT_STATE_ROOT){
 const base=readJson(baseFile),local=readJson(process.env.XPLANE_LOCAL_CONFIG||path.join(stateRoot,LOCAL_CONFIG_NAME));
 const simRoot=process.env.XPLANE_ROOT||base.simRoot||local.simRoot||null;
 return {...base,simRoot:simRoot?path.resolve(simRoot):null};
}

export function inspectInstallation(simRoot,config,{platform=process.platform,arch=process.arch}={}){
 const root=simRoot?path.resolve(simRoot):null;
 const aircraft=root&&path.join(root,config.aircraft);
 const navigationCandidates=root?[
  'Custom Data/user_nav.dat','Custom Data/earth_nav.dat','Resources/default data/earth_nav.dat'
 ].map(relative=>path.join(root,relative)):[];
 const airportData=root&&path.join(root,'Global Scenery/Global Airports/Earth nav data/apt.dat');
 const checks={
  root:Boolean(root&&fs.existsSync(root)&&fs.statSync(root).isDirectory()),
  aircraft:Boolean(aircraft&&fs.existsSync(aircraft)),
  navigation:navigationCandidates.some(file=>fs.existsSync(file)),
  airportData:Boolean(airportData&&fs.existsSync(airportData))
 };
 const errors=[];
 if(!checks.root)errors.push('X-Plane installation folder was not found');
 if(checks.root&&!checks.aircraft)errors.push(`Expected A330 is missing: ${config.aircraft}`);
 if(checks.root&&!checks.navigation)errors.push('X-Plane navigation data was not found');
 if(checks.root&&!checks.airportData)errors.push('Global Airports apt.dat was not found');
 return {configured:Boolean(root),valid:Object.values(checks).every(Boolean),simRoot:root,checks,errors,platform,arch,automaticLaunch:platform==='darwin'&&Boolean(root&&fs.existsSync(path.join(root,'X-Plane.app')))};
}

function copyBundledFile(source,destination){
 fs.mkdirSync(path.dirname(destination),{recursive:true});
 if(fs.existsSync(destination)){
  const identical=sha256(source)===sha256(destination);
  return {status:identical?'present':'conflict',path:destination,source,identical};
 }
 fs.copyFileSync(source,destination,fs.constants.COPYFILE_EXCL);
 return {status:'installed',path:destination,source,identical:true};
}

function bundledStatus(source,destination){
 if(!fs.existsSync(destination))return {status:'missing',path:destination};
 return {status:sha256(source)===sha256(destination)?'present':'conflict',path:destination};
}

export function installBundledAssets(simRoot,config,{platform=process.platform,arch=process.arch}={}){
 const inspection=inspectInstallation(simRoot,config,{platform,arch});
 if(!inspection.valid)return {...inspection,assets:null};
 const situationSource=path.join(HERE,'assets','situations',BUNDLED_SITUATION_NAME);
 const situationDestination=path.join(inspection.simRoot,config.situation);
 const situation=copyBundledFile(situationSource,situationDestination);
 let loader;
 if(platform==='darwin'&&arch==='arm64'){
  const loaderSource=path.join(HERE,'assets','agentakt_scenario','mac_x64','agentakt_scenario.xpl');
  const loaderDestination=path.join(inspection.simRoot,path.dirname(config.aircraft),'plugins','agentakt_scenario','mac_x64','agentakt_scenario.xpl');
  loader=copyBundledFile(loaderSource,loaderDestination);
 }else{
  loader={status:'unsupported',path:null,reason:'The bundled loader is tested only on Apple Silicon macOS. Build and test a native plugin before claiming support for this platform.'};
 }
 return {...inspection,assets:{situation,loader}};
}

export function configureInstallation(simRoot,config,{stateRoot=process.env.XPLANE_SCENARIO_STATE||DEFAULT_STATE_ROOT,install=true,platform=process.platform,arch=process.arch}={}){
 const result=install?installBundledAssets(simRoot,config,{platform,arch}):inspectInstallation(simRoot,config);
 if(!result.valid)return result;
 const localFile=process.env.XPLANE_LOCAL_CONFIG||path.join(stateRoot,LOCAL_CONFIG_NAME);
 writeJson(localFile,{simRoot:result.simRoot});
 return {...result,localConfig:localFile};
}

export function installationSummary(config,{platform=process.platform,arch=process.arch}={}){
 const result=inspectInstallation(config.simRoot,config,{platform,arch});
 if(!result.valid)return {...result,ready:false,manualLoadAvailable:false,automaticLoadAvailable:false};
 const situationSource=path.join(HERE,'assets','situations',BUNDLED_SITUATION_NAME),situation=path.join(result.simRoot,config.situation);
 const loaderSource=path.join(HERE,'assets','agentakt_scenario','mac_x64','agentakt_scenario.xpl'),loader=path.join(result.simRoot,path.dirname(config.aircraft),'plugins','agentakt_scenario','mac_x64','agentakt_scenario.xpl');
 const assets={situation:bundledStatus(situationSource,situation),loader:platform==='darwin'&&arch==='arm64'?bundledStatus(loaderSource,loader):{status:'unsupported',path:null,reason:'Automatic situation loading is not bundled for this platform.'}};
 const situationReady=assets.situation.status==='present';
 const manualLoadAvailable=result.valid&&situationReady;
 const automaticLoadAvailable=manualLoadAvailable&&(config.nativeFlightInit||assets.loader.status==='present');
 return {...result,ready:manualLoadAvailable,manualLoadAvailable,automaticLoadAvailable,situationName:BUNDLED_SITUATION_NAME,situationRelativePath:config.situation,assets};
}
