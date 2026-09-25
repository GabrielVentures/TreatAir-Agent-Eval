import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';

test('preparation clears prior evaluation error before starting the setup child',()=>{
 const source=fs.readFileSync(new URL('./dashboard.mjs',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('function startJob('),source.indexOf('function runConfig('));
 for(const kind of ['setup','prepare-loaded']){
  const writes=[];let operator;
  const context={path,ROOT:'/test',HERE:'/test',process:{execPath:'node'},crypto:{randomUUID:()=> 'test-id'},
   writeJson:(file,value)=>writes.push({file,value}),updateOperator:value=>{operator=value;},
   spawn:()=>{
    assert.equal(writes[0].value.status,'idle');
    assert.equal(operator.phase,'WAITING_FOR_SIMULATOR');
    assert.equal(operator.ready,false);
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.pid=123;return child;
   }};
  vm.runInNewContext(fn+`;startJob('${kind}',[]);`,context);
  assert.equal(writes[1].value.status,'running');
 }
});
