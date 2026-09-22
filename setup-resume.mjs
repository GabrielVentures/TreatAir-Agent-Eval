// Loading may expose saved telemetry before X-Plane accepts pause-off.
// Keep this retry confined to setup; evaluated flights retain fast failures.
export async function resumeForSetup({resume,checkCancelled,onRetry,sleep,now=Date.now,timeoutMs=180000}){
 const started=now();let lastError;
 while(now()-started<timeoutMs){
  checkCancelled();
  try{await resume();return;}catch(error){
   if(error.setupFatal)throw error;
   lastError=error;
  }
  checkCancelled();
  onRetry(lastError);
  await sleep(500);
 }
 throw Error(`Aircraft initialization could not resume within ${timeoutMs/1000} seconds: ${lastError?.message||'controls unavailable'}`);
}
