import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {configureInstallation,installBundledAssets,loadConfig} from './installation.mjs';

function fixture(){
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'xplane-install-')),root=path.join(workspace,'X-Plane 12'),stateRoot=path.join(workspace,'state');
 for(const relative of ['Aircraft/Laminar Research/Airbus A330-300','Resources/default data','Global Scenery/Global Airports/Earth nav data'])fs.mkdirSync(path.join(root,relative),{recursive:true});
 fs.writeFileSync(path.join(root,'Aircraft/Laminar Research/Airbus A330-300/A330.acf'),'A330 fixture');
 fs.writeFileSync(path.join(root,'Resources/default data/earth_nav.dat'),'nav fixture');
 fs.writeFileSync(path.join(root,'Global Scenery/Global Airports/Earth nav data/apt.dat'),'airport fixture');
 return {workspace,root,stateRoot};
}

test('clean Apple Silicon configuration installs the bundled situation and loader',()=>{
 const f=fixture(),config=loadConfig();
 try{
  const result=configureInstallation(f.root,config,{stateRoot:f.stateRoot,platform:'darwin',arch:'arm64'});
  assert.equal(result.valid,true);assert.equal(result.assets.situation.status,'installed');assert.equal(result.assets.loader.status,'installed');
  assert.ok(fs.existsSync(path.join(f.root,config.situation)));
  assert.ok(fs.existsSync(path.join(f.root,'Aircraft/Laminar Research/Airbus A330-300/plugins/agentakt_scenario/mac_x64/agentakt_scenario.xpl')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.stateRoot,'local-config.json'),'utf8')),{simRoot:f.root});
 }finally{fs.rmSync(f.workspace,{recursive:true,force:true});}
});

test('installer never overwrites an existing situation',()=>{
 const f=fixture(),config=loadConfig(),destination=path.join(f.root,config.situation);
 try{
  fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,'recipient-owned situation');
  const result=installBundledAssets(f.root,config,{platform:'darwin',arch:'arm64'});
  assert.equal(result.assets.situation.status,'conflict');
  assert.equal(fs.readFileSync(destination,'utf8'),'recipient-owned situation');
 }finally{fs.rmSync(f.workspace,{recursive:true,force:true});}
});

test('unsupported platforms keep setup explicit and do not claim a loader',()=>{
 const f=fixture(),config=loadConfig();
 try{
  const result=installBundledAssets(f.root,config,{platform:'win32',arch:'x64'});
  assert.equal(result.valid,true);assert.equal(result.assets.situation.status,'installed');assert.equal(result.assets.loader.status,'unsupported');
 }finally{fs.rmSync(f.workspace,{recursive:true,force:true});}
});
