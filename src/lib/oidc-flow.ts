import {createBlocksClient,type BlocksAuthResponse} from '@seliseblocks/client';
import {runtimeConfig,tokens} from './blocks-runtime';
import {verifyIdentity,sessionCookie} from './live-auth';
import {mode} from './adapters';
import {clearOidcCookie,oidcStateCookie,validOidcState} from './oidc-state';
interface FlowDependencies {
 origin:()=>string;
 enabled:()=>boolean;
 initiate:(signup?:boolean)=>Promise<{redirect_uri?:string;redirectUri?:string}>;
 exchange:(callback:string)=>Promise<BlocksAuthResponse>;
 establish:(result:BlocksAuthResponse)=>Promise<string>;
 providerOrigin:()=>string;
}
function errorResponse(kind:'expired'|'provider'|'configuration'){
 const message=kind==='expired'?'This sign-in link expired or was already used. Start a fresh login.':kind==='configuration'?'Blocks login is not configured for this address.':'Blocks could not complete sign-in. Start a fresh login and try again.';
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign-in could not complete</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f8f9fc;color:#242638;font:16px Arial,sans-serif}main{max-width:420px;margin:24px;padding:36px;border:1px solid #e9eaf1;border-radius:18px;background:white}h1{font-size:25px}p{line-height:1.7;color:#737589}a{display:inline-block;padding:12px 18px;border-radius:8px;background:#6c4cdb;color:white;text-decoration:none}small{display:block;margin-top:20px}small a{background:none;color:#6c4cdb;padding:0}</style></head><body><main class="login-card"><h1>Sign-in could not complete</h1><p>${message}</p><a href="/api/auth/oidc/start">Sign in again</a><small><a href="/login">Return to workspace</a></small></main></body></html>`;
 return new Response(html,{status:kind==='configuration'?503:400,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",'Set-Cookie':clearOidcCookie}});
}
function matchesOrigin(req:Request,registered:string){const expected=new URL(registered),url=new URL(req.url);const host=req.headers.get('host')||url.host;const protocol=req.headers.get('x-forwarded-proto')?.split(',')[0].trim()||url.protocol.replace(':','');return host===expected.host&&`${protocol}:`===expected.protocol;}
export function createOidcFlow(deps:FlowDependencies){
 // Coalesce concurrent callbacks while the one-time exchange is in progress.
 const pending=new Map<string,Promise<Response>>();
 async function start(req:Request){
  if(!deps.enabled())return errorResponse('configuration');
  try{if(!matchesOrigin(req,deps.origin()))return errorResponse('configuration');const signup=new URL(req.url).searchParams.get('flow')==='signup';const result=await deps.initiate(signup);const target=new URL(result.redirect_uri||result.redirectUri||'');const provider=new URL(deps.providerOrigin());if(target.protocol==='http:'&&provider.protocol==='https:'&&target.host===provider.host)target.protocol='https:';if(target.origin!==provider.origin)return errorResponse('configuration');const state=target.searchParams.get('state');if(!state)return errorResponse('provider');return new Response(null,{status:303,headers:{Location:target.href,'Set-Cookie':oidcStateCookie(state),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}catch{return errorResponse('provider');}
 }
 async function callback(req:Request){
  if(!deps.enabled())return errorResponse('configuration');
  const url=new URL(req.url),state=url.searchParams.get('state')||'';
  if(!matchesOrigin(req,deps.origin()))return errorResponse('configuration');
  if(!validOidcState(req.headers.get('cookie'),state))return errorResponse('expired');
  if(url.searchParams.has('error')||!url.searchParams.get('code'))return errorResponse('provider');
  const active=pending.get(state);if(active)return (await active).clone();
  if(pending.size>=1000)return errorResponse('provider');
  const completion=(async()=>{let stage='token-exchange';try{
   const result=await deps.exchange(new URL(`${url.pathname}${url.search}`,deps.origin()).href);
   if(result.error)return errorResponse(result.error==='invalid_state'?'expired':'provider');
   stage='identity-and-session';
   const cookie=await deps.establish(result);
   const headers=new Headers({'Location':`${deps.origin()}/`,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});headers.append('Set-Cookie',cookie);headers.append('Set-Cookie',clearOidcCookie);
   return new Response(null,{status:303,headers});
  }catch(error){console.error('OIDC callback could not complete.',{stage,status:typeof (error as {status?:unknown})?.status==='number'?(error as {status:number}).status:undefined});return errorResponse('provider');}})();
  pending.set(state,completion);try{return (await completion).clone();}finally{pending.delete(state);}
 }
 return {start,callback};
}
function client(){const config=runtimeConfig();if(!config.clientId||!config.redirectUri)throw new Error('Registered OIDC callback configuration is required.');return createBlocksClient({apiUrl:config.apiUrl,xBlocksKey:config.projectKey,appDomain:config.appDomain,oidc:{clientId:config.clientId,url:config.oidcUrl,redirectUri:config.redirectUri}});}
const flow=createOidcFlow({origin:()=>new URL(runtimeConfig().redirectUri!).origin,providerOrigin:()=>runtimeConfig().oidcUrl,enabled:()=>mode()==='live',initiate:signup=>signup?client().auth.json('/iam/v4/idp/initiate',{auth:false,query:{clientId:runtimeConfig().clientId,redirectUri:runtimeConfig().redirectUri,flow:'signup'}}):client().auth.idp.initiate(),exchange:callback=>client().auth.idp.callback(callback),establish:async result=>{const session=tokens(result);await verifyIdentity(session.access);return sessionCookie(session);}});
export const startOidc=flow.start;
export const completeOidc=flow.callback;
