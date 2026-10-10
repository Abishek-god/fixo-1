import "jsr:@supabase/functions-js/edge-runtime.d.ts";
type Task = "fast" | "general" | "reasoning" | "character";
type ChatMessage = { role: "user" | "assistant"; content: string };
const MODELS = ["qwen3.8-27b","qwen3.8-flash","kimi-k3","qwen3.8-max-0902","deepseek-v4.1-flash","glm-5.3","deepseek-v4-pro-0813","qwen3.8-2.4t-a95b","qwen-plus-character","qwen-flash-character"] as const;
const FALLBACKS: Record<Task,string[]> = {
 fast:["qwen3.8-flash","deepseek-v4.1-flash","qwen3.8-27b","glm-5.3"],
 general:["qwen3.8-27b","glm-5.3","deepseek-v4.1-flash","kimi-k3"],
 reasoning:["kimi-k3","qwen3.8-max-0902","deepseek-v4-pro-0813","qwen3.8-2.4t-a95b","qwen3.8-27b"],
 character:["qwen-plus-character","qwen-flash-character","qwen3.8-flash"]
};
const SYSTEM_PROMPT = "You are Fixo AI, an educational financial research assistant focused on Indian markets. Explain assumptions, uncertainty, and data freshness. Do not claim to have live prices unless supplied in the conversation. Do not guarantee returns or present speculative outputs as facts. This product supports paper trading only; never claim to place real-money trades. Provide educational information, not personalized investment advice.";
const corsHeaders = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, GET, OPTIONS","Content-Type":"application/json"};
function json(data:unknown,status=200):Response{return new Response(JSON.stringify(data),{status,headers:corsHeaders});}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 if(req.method==="GET")return json({service:"Fixo AI Edge Function",models:MODELS,tasks:Object.keys(FALLBACKS)});
 if(req.method!=="POST")return json({error:"Method not allowed."},405);
 const authorization=req.headers.get("Authorization");
 const supabaseUrl=Deno.env.get("SUPABASE_URL");
 const anonKey=Deno.env.get("SUPABASE_ANON_KEY")??Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
 const baseUrl=Deno.env.get("AI_BASE_URL")?.trim().replace(/\/+$/,"");
 const apiKey=Deno.env.get("AI_API_KEY")?.trim();
 if(!authorization?.startsWith("Bearer "))return json({error:"Sign in to use Fixo AI."},401);
 if(!supabaseUrl||!anonKey)return json({error:"Supabase Auth environment is not configured."},503);
 if(!baseUrl||!apiKey)return json({error:"Set AI_BASE_URL and AI_API_KEY as Supabase Edge Function secrets."},503);
 try{
  const authResponse=await fetch(supabaseUrl.replace(/\/+$/,"")+"/auth/v1/user",{headers:{apikey:anonKey,Authorization:authorization}});
  if(!authResponse.ok)return json({error:"Session is invalid or expired. Sign in again."},401);
 }catch{return json({error:"Could not verify the user session."},502);}
 let body:{messages?:ChatMessage[];model?:string;task?:Task};
 try{body=await req.json();}catch{return json({error:"Request body must be valid JSON."},400);}
 const messages=body.messages;
 if(!Array.isArray(messages)||messages.length<1||messages.length>30||messages.some(m=>!m||!["user","assistant"].includes(m.role)||typeof m.content!=="string"||!m.content.trim()||m.content.length>12000))
  return json({error:"Provide 1–30 valid user/assistant messages."},400);
 const task:Task=body.task&&body.task in FALLBACKS?body.task:"general";
 const requestedModel=typeof body.model==="string"&&MODELS.includes(body.model as typeof MODELS[number])?body.model:undefined;
 const candidates=[...new Set([...(requestedModel?[requestedModel]:[]),...FALLBACKS[task]])];
 const safeMessages=[{role:"system",content:SYSTEM_PROMPT},...messages.map(m=>({role:m.role,content:m.content.trim()}))];
 let lastStatus=502;
 for(const model of candidates){
  let response:Response;
  try{response=await fetch(baseUrl+"/chat/completions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+apiKey},
   body:JSON.stringify({model,messages:safeMessages,temperature:0.3,stream:false}),signal:AbortSignal.timeout(45000)});}
  catch{lastStatus=502;continue;}
  if(!response.ok){
   lastStatus=response.status;
   if([400,401,403].includes(response.status))return json({error:response.status===400?"AI provider rejected the request or model ID.":"AI provider rejected the credentials or model access.",model,detail:(await response.text().catch(()=>"")).slice(0,400)},response.status);
   if(response.status!==429&&response.status<500)return json({error:"AI provider request failed.",model},response.status);
   continue;
  }
  try{
   const payload=await response.json();const content=payload?.choices?.[0]?.message?.content;
   const answer=typeof content==="string"?content:Array.isArray(content)?content.map((p:{text?:string})=>p.text??"").join(""):"";
   if(!answer.trim()){lastStatus=502;continue;}
   return json({answer,model,task,fallbackUsed:model!==(requestedModel??FALLBACKS[task][0])});
  }catch{lastStatus=502;}
 }
 return json({error:"All eligible Fixo AI models failed. Check model IDs, provider access, and rate limits.",tried:candidates},lastStatus);
});
