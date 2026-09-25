// Only these public messages cross from the model process into the dashboard.
export function providerFailure(status,payload){
 const code=payload?.error?.code||payload?.error?.type;
 if(['insufficient_quota','billing_hard_limit_reached','billing_not_active'].includes(code))return {code:'api_quota',message:'OpenAI API credit or spending limit reached. Add credit or review billing limits for the account/project that owns this API key, then prepare the flight and try again.'};
 if(status===401)return {code:'api_auth',message:'OpenAI rejected the API key. Update it in Settings, then prepare the flight and try again.'};
 if(status===429)return {code:'api_rate_limit',message:'OpenAI is temporarily limiting requests. Wait a moment, then prepare the flight and try again.'};
 return {code:'api_error',message:`OpenAI could not start or continue the agent (HTTP ${status}). Check model access and provider availability, then try again. Details are in the local run log.`};
}

export function parseAgentFailure(stderr){
 for(const line of String(stderr).split('\n').reverse()){
  try{const value=JSON.parse(line);if(value.type==='agent_failure'&&typeof value.error?.message==='string'&&typeof value.error?.code==='string')return {code:value.error.code,message:value.error.message};}catch{}
 }
 return null;
}
