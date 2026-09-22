#!/usr/bin/env node
import {configureInstallation,loadConfig} from './installation.mjs';

const args=process.argv.slice(2),rootIndex=args.indexOf('--xplane-root'),simRoot=rootIndex>=0?args[rootIndex+1]:null;
if(!simRoot){console.error('Usage: node install.mjs --xplane-root "/path/to/X-Plane 12" [--check-only]');process.exitCode=2;}
else{
 const config=loadConfig(),result=configureInstallation(simRoot,config,{install:!args.includes('--check-only')});
 console.log(JSON.stringify(result,null,2));
 if(!result.valid)process.exitCode=1;
}
