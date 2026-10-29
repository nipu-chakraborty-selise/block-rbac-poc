import {AppError} from '../model';
import {hasOrganizationRoleMembership} from '../live-users';
import type {Identity} from './model';
interface DirectoryClient {
 list:(request?:{page?:number;pageSize?:number;filter?:Record<string,unknown>})=>Promise<{isSuccess?:boolean;totalCount?:number;data?:{itemId?:string;email?:string;firstName?:string;lastName?:string;active?:boolean;isVerified?:unknown;roles?:unknown}[]}>;
}
export async function organizationDirectory(users:DirectoryClient,id:string,admins:{userId:string}[]):Promise<Identity[]>{
 const people:Identity[]=[];let page=0,count=0,total=0;
 do {
  const result=await users.list({page,pageSize:100,filter:{organizationIds:[id]}});
  if(result.isSuccess===false||!Array.isArray(result.data)||!Number.isInteger(result.totalCount))throw new AppError(503,'IAM user directory unavailable.');
  total=result.totalCount!;count+=result.data.length;
  if(total>10000||(!result.data.length&&count<total))throw new AppError(503,'IAM user directory is incomplete.');
  for(const user of result.data){
   // Recheck authoritative membership even if a server ignores its query filter.
   if(!hasOrganizationRoleMembership(user,id))continue;
   if(!user.itemId)throw new AppError(503,'IAM identity missing.');
   people.push({id:user.itemId,name:[user.firstName,user.lastName].filter(Boolean).join(' ')||user.email||user.itemId,email:user.email||'',active:user.active===true,verified:user.isVerified===true,organizationIds:[id],superAdmin:admins.some(a=>a.userId===user.itemId)});
  }
  page++;
 }while(count<total);
 return people;
}
