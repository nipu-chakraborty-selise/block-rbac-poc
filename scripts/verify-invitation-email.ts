import env from '@next/env';
import {writeFileSync} from 'node:fs';
import {backendClient,runtimeConfig,userClient} from '../src/lib/blocks-runtime';
env.loadEnvConfig(process.cwd());
let stage='hosted signup';
try {
 const config=runtimeConfig();
 const signup=await userClient('').auth.json<{redirect_uri?:string;flow?:string}>('/iam/v4/idp/initiate',{auth:false,query:{clientId:config.clientId,redirectUri:config.redirectUri,flow:'signup'}});
 const target=new URL(signup.redirect_uri||'');
 if(target.protocol==='http:'&&target.host===new URL(config.oidcUrl).host)target.protocol='https:';
 if(target.origin!==new URL(config.oidcUrl).origin||(!target.pathname.includes('signup')&&signup.flow!=='signup'))throw new Error('Hosted signup unavailable');
 stage='mail request';
 const response=await backendClient().mail.sendToAny({to:['pro.nipu@gmail.com'],purpose:'AtlasUnitInvitation',language:'en-US',subjectDataContext:{Organization:'Atlas email delivery test'},bodyDataContext:{Organization:'Atlas email delivery test',Unit:'Delivery verification',Role:'Test message — no role or membership granted',InvitationUrl:process.env.APP_ORIGIN||''}});
 if(response.isSuccess===false||response.error||(Array.isArray(response.errors)&&response.errors.length))throw new Error('Mail rejected');
 const evidence={verifiedAt:new Date().toISOString(),sender:'blocks@selise.io',testRecipient:'pro.nipu@gmail.com',hostedSignupInitiationVerified:true,mailRequestAccepted:true,inboxDeliveryConfirmed:false,newAccountsCreated:0,rolesGranted:0,mailResponseFields:Object.keys(response)};
 writeFileSync('docs/invitation-email-live-evidence.json',JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify(evidence,null,2));
}catch(error){console.error('Invitation email verification failed; sensitive response suppressed.',{stage,status:(error as {status?:number}).status,errorType:error instanceof Error?error.constructor.name:'unknown'});process.exitCode=1;}
