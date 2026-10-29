import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {AppError,type User} from './model';
import {runtimeConfig,tokens,userClient,backendClient} from './blocks-runtime';
import {verifyBlocksIdentity} from './blocks-identity';
export interface LiveSession {access:string;refresh:string;expiresAt:number}
function key(){const secret=process.env['SESSION_SECRET'];if(!secret||!/^[a-f0-9]{64}$/i.test(secret))throw new AppError(503,'A 32-byte server session encryption key is required.');return Buffer.from(secret,'hex');}
export function seal(session:LiveSession){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify(session),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');}
export function unseal(value:string):LiveSession{try{const data=Buffer.from(value,'base64url');if(data.length<29)throw new Error();const cipher=createDecipheriv('aes-256-gcm',key(),data.subarray(0,12));cipher.setAuthTag(data.subarray(12,28));const session=JSON.parse(Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString());if(typeof session.access!=='string'||typeof session.refresh!=='string'||!Number.isFinite(session.expiresAt))throw new Error();return session;}catch(e){if(e instanceof AppError)throw e;throw new AppError(401,'Sign in to continue.');}}
export function sessionCookie(session:LiveSession){const value=seal(session);if(value.length>3700)throw new AppError(503,'Blocks session is too large for the encrypted browser cookie.');return `atlas_live=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`;}
export async function verifyIdentity(access:string):Promise<User>{
 const client=userClient(access);
 return verifyBlocksIdentity(access,{
  projectKey:runtimeConfig().projectKey,
  authenticate:async()=>({ok:true,user:await client.http.request<Record<string,unknown>>('/iam/v4/auth/me')}),
  profiles:id=>backendClient().iam.users.list({page:0,pageSize:100,filter:{userIds:[id]}}),
 });
}
export async function liveSession(req:Request){const value=req.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('atlas_live='))?.slice(11);if(!value)throw new AppError(401,'Sign in to continue.');let session=unseal(value),cookie:string|undefined;if(session.expiresAt<=Date.now()+30000){if(!session.refresh)throw new AppError(401,'Sign in to continue.');const response=await userClient(session.access).auth.oidc.refreshToken({refreshToken:session.refresh});const next=tokens(response);session={...next,refresh:next.refresh||session.refresh};cookie=sessionCookie(session);}const user=await verifyIdentity(session.access);return {session,user,cookie};}
