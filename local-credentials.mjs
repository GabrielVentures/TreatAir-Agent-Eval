import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const filename=root=>path.join(root,'provider-credentials.json');
export function loadSavedApiKey(root){
  try{return String(JSON.parse(fs.readFileSync(filename(root),'utf8')).apiKey||'').trim();}
  catch(error){if(error.code==='ENOENT')return '';throw new Error('Cannot read saved API credentials. Check local file permissions.');}
}
export function saveApiKey(root,apiKey){
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  const file=filename(root),temp=`${file}.${crypto.randomUUID()}.tmp`;
  try{
    fs.writeFileSync(temp,JSON.stringify({apiKey}),{mode:0o600,flag:'wx'});
    fs.renameSync(temp,file);
  }finally{fs.rmSync(temp,{force:true});}
}
export function clearSavedApiKey(root){fs.rmSync(filename(root),{force:true});}
