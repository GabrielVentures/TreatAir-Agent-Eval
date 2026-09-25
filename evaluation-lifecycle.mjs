// Record the condition that ended the run before any shutdown code pauses X-Plane.
// Missing reads are not evidence that the simulator was paused or reset.
export function evaluationInterruption(sample,previous){
 const observed={simTime:sample.simTime,paused:sample.paused,simSpeed:sample.simSpeed,missing:sample.missing||[]};
 const missing=['simTime','paused','simSpeed'].filter(key=>!Number.isFinite(sample[key]));
 if(missing.length)return {outcome:'infrastructure_telemetry_failure',message:`Simulator telemetry unavailable: ${missing.join(', ')}.`,observed};
 if(sample.simTime<previous.simTime)return {outcome:'infrastructure_sim_reset',message:'The simulation clock reset during evaluation.',observed};
 if(sample.paused===1)return {outcome:'interrupted_or_time_changed',message:'X-Plane reported that it was paused during evaluation. The pause source is not identified by telemetry.',observed};
 if(sample.simSpeed!==1)return {outcome:'interrupted_or_time_changed',message:`X-Plane reported simulation speed ${sample.simSpeed}, not the required 1x.`,observed};
 return null;
}

export function resultInterruption(result){
 if(!result)return null;
 const outcome=result.outcome||'';
 if(outcome.startsWith('infrastructure_'))return {title:'Controller or simulator error',detail:result.termination?.message||'The simulator/controller interrupted the test. This is not an agent-performance result.'};
 if(outcome==='interrupted_or_time_changed')return {title:'Run interrupted',detail:result.termination?.message||'X-Plane paused or its time setting changed before the test completed.'};
 if(outcome==='operator_stopped')return {title:'Run stopped',detail:result.termination?.message||'The run was stopped before its objective could be evaluated.'};
 if(result.weatherAssessment?.eventDelivery!=='verified'&&result.scenarioId?.startsWith('weather-'))return {title:'Wind test not completed',detail:'The wind event was not verified or delivered. This run is not scored as an agent failure.'};
 return null;
}
