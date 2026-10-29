import {AppError,type User} from './model';
interface Dependencies {
 projectKey:string;
 authenticate:()=>Promise<{ok:boolean;user:Record<string,unknown>}>;
 profiles:(id:string)=>Promise<{isSuccess?:boolean;data?:Record<string,unknown>[];totalCount?:number}>;
}
/** Authenticate independently of organization membership; new signups have none yet. */
export async function verifyBlocksIdentity(access:string,deps:Dependencies):Promise<User>{
 let authenticated:Awaited<ReturnType<Dependencies['authenticate']>>;
 try{authenticated=await deps.authenticate();}catch{throw new AppError(401,'Blocks session expired. Sign in again.');}
 const info=authenticated.user;
 if(!authenticated.ok||typeof info.sub!=='string'||!info.sub||info.error||info.isSuccess===false)
  throw new AppError(401,'Blocks did not validate this session. Sign in again.');
 // Decode claims only after Blocks validated this exact bearer through auth/me.
 let claims:Record<string,unknown>;
 try{claims=JSON.parse(Buffer.from(access.split('.')[1],'base64url').toString());}catch{throw new AppError(401,'Invalid Blocks token.');}
 const tenant=claims.tenant_id||claims.tenantId||claims.projectKey||claims.ProjectKey;
 if(tenant!==deps.projectKey||info.tenant_id!==deps.projectKey)
  throw new AppError(403,'Blocks identity belongs to another project.');
 if((claims.user_id||claims.sub)!==info.sub)throw new AppError(401,'Blocks identity does not match the session.');
 let result:Awaited<ReturnType<Dependencies['profiles']>>;
 try{result=await deps.profiles(info.sub);}catch{throw new AppError(503,'Cannot verify the current Blocks account. Try again shortly.');}
 if(result.isSuccess===false||!Array.isArray(result.data)||!Number.isInteger(result.totalCount)||result.totalCount!>100)
  throw new AppError(503,'Cannot verify the current Blocks account.');
 const matches=result.data.filter(u=>u.itemId===info.sub);
 if(matches.length!==1||matches[0].active!==true)throw new AppError(403,'An active Blocks project identity is required.');
 const user=matches[0];
 if(user.isVerified!==true)throw new AppError(403,'Verify your email before signing in.');
 const roles=user.roles;
 // IAM's authoritative directory stores membership as {organizationId: roleSlugs[]}.
 // Empty role maps are valid for verified accounts that have not created/joined a company.
 if(!roles||typeof roles!=='object'||Array.isArray(roles)||Object.values(roles).some(value=>!Array.isArray(value)||value.some(role=>typeof role!=='string')))
  throw new AppError(503,'Cannot resolve Blocks organization membership.');
 return {id:String(user.itemId),name:[user.firstName,user.lastName].filter(v=>typeof v==='string'&&v).join(' ')||String(user.email||'Blocks user'),email:String(user.email||''),verified:true,projectId:deps.projectKey,countryIds:Object.keys(roles).filter(id=>id!=='default')};
}
