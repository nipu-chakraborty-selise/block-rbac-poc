import {backendClient, runtimeConfig} from './blocks-runtime';
import {AppError, type User} from './model';

export function alreadyOrganizationMember(error:unknown){
  const text=[
    error instanceof Error?error.message:'',
    typeof error==='object'&&error&&'body' in error?JSON.stringify((error as {body:unknown}).body):'',
  ].join(' ').toLowerCase();
  return /already (a )?member|already belongs|already (in|has) (the )?organization|duplicate membership/.test(text);
}

/** Blocks list filters by organizationId are not authoritative; membership lives in user.roles keys. */
export function hasOrganizationRoleMembership(user:{roles?:unknown}|undefined, organizationId:string){
  const roles=user?.roles;
  return !!roles && typeof roles==='object' && !Array.isArray(roles) && Object.prototype.hasOwnProperty.call(roles, organizationId);
}

/** Provision IAM membership separately from the app's scoped Data records. */
export async function provisionUser(countryId:string, b:Record<string,unknown>, dependencies?:{iam:ReturnType<typeof backendClient>['iam']['users'];projectId:string}):Promise<User> {
  const email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw new AppError(422,'Enter a valid email address.');
  const iam=dependencies?.iam||backendClient().iam.users;
  const find=async()=>{const result=await iam.list({page:0,pageSize:100,filter:{email}});if(result.isSuccess===false||!Array.isArray(result.data)||Number(result.totalCount)>100)throw new AppError(502,'Cannot uniquely look up the IAM user.');const matches=result.data.filter(u=>u.email?.toLowerCase()===email);if(matches.length>1)throw new AppError(422,'Multiple IAM accounts match this email. Resolve the duplicate in Blocks first.');return matches[0];};
  let target=await find();
  if(!target){
    if(b.accountMode!=='new')throw new AppError(422,'No existing IAM account matches this email. Choose Create account.');
    if(typeof b.password!=='string'||b.password.length<8||b.password.length>128)throw new AppError(422,'Initial password must be 8–128 characters.');
    const name=typeof b.name==='string'?b.name.trim():'';
    if(!name||name.length>120)throw new AppError(422,'Enter a name of 1–120 characters.');
    const created=await iam.create({email,userName:email,firstName:name,password:b.password,organizationId:countryId,roles:[],permissions:[],sendMail:false,notifyUser:false});
    if(created.isSuccess!==true)throw new AppError(502,'IAM did not create the account. No scoped assignment was saved.');
    target=await find();
    if(!target?.itemId)throw new AppError(503,'Account creation succeeded but identity lookup failed. Refresh before retrying.');
    const activated=await iam.activate({userId:target.itemId,reason:'Super-admin provisioned organization member'});
    if(activated.isSuccess!==true)throw new AppError(503,'Account created but activation failed. It has no scoped assignment; activate it in Blocks before retrying.');
    target=await find();
  }
  if(!target?.itemId||target.active!==true||target.isVerified!==true)throw new AppError(422,'The IAM account must be active and verified before assigning access.');
  // Never trust list(?organizationId=) alone — it can return users who only belong to "default".
  if(!hasOrganizationRoleMembership(target, countryId)){
    let granted:{isSuccess?:boolean;errors?:unknown};
    try{
      granted=await iam.updateAccess({userId:target.itemId,organizationId:countryId,roles:[],permissions:[],notifyUser:false});
    }catch(error){
      if(!alreadyOrganizationMember(error))throw error;
      granted={isSuccess:true};
    }
    if(granted.isSuccess!==true){
      if(!(alreadyOrganizationMember(granted.errors)||alreadyOrganizationMember(granted)))
        throw new AppError(502,'IAM did not grant country membership. No scoped assignment was saved.');
    }
    target=await find();
    if(!hasOrganizationRoleMembership(target, countryId))
      throw new AppError(503,'Country membership could not be confirmed on the IAM profile. No scoped assignment was saved; refresh before retrying.');
  }
  return {id:target!.itemId!,email,name:[target!.firstName,target!.lastName].filter(Boolean).join(' ')||email,verified:true,projectId:dependencies?.projectId||runtimeConfig().projectKey,countryIds:[countryId]};
}
