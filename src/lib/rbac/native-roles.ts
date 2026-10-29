import {createHash} from 'node:crypto';
import {backendClient} from '../blocks-runtime';
import {AppError} from '../model';
export interface NativeRole {id:string;slug:string;name:string;description:string|null;parentRoleSlug:string|null;canCreateOwn:boolean;revision:string;protected:boolean}
const reserved=new Set(['clouduser','atlas-data-backend']);
export function nativeRole(value:Record<string,unknown>):NativeRole {
 if(typeof value.itemId!=='string'||typeof value.slug!=='string'||typeof value.name!=='string')throw new AppError(502,'Blocks returned an invalid role.');
 const role={id:value.itemId,slug:value.slug,name:value.name,description:typeof value.description==='string'?value.description:null,parentRoleSlug:typeof value.parentRoleSlug==='string'?value.parentRoleSlug:null,canCreateOwn:value.canCreateOwn===true};
 return {...role,revision:createHash('sha256').update(JSON.stringify({...role,lastUpdatedDate:value.lastUpdatedDate})).digest('hex'),protected:reserved.has(role.slug)};
}
export function validateRoleChange(roles:NativeRole[],body:Record<string,unknown>,current?:NativeRole){
 if(current?.protected)throw new AppError(403,'System and backend roles are protected in this app.');
 if(current&&body.revision!==current.revision)throw new AppError(409,'Role changed. Reload before saving.');
 const name=typeof body.name==='string'?body.name.trim():'';
 const slug=current?.slug||(typeof body.slug==='string'?body.slug.trim():'');
 if(!name||name.length>120||!/^atlas-[a-z][a-z0-9-]{0,63}$/.test(slug))throw new AppError(422,'Use a name and a role slug starting with atlas-.');
 if(reserved.has(slug)||(!current&&roles.some(r=>r.slug===slug)))throw new AppError(409,'This role slug is already reserved or in use.');
 if(typeof body.canCreateOwn!=='boolean'||(body.parentRoleSlug!==null&&typeof body.parentRoleSlug!=='string'))throw new AppError(422,'Choose a parent role and same-role assignment setting.');
 const parent=body.parentRoleSlug as string|null;
 const visited=new Set([slug]);let next=parent;
 while(next){if(visited.has(next))throw new AppError(422,'Role parents cannot form a cycle.');visited.add(next);const role=roles.find(r=>r.slug===next);if(!role)throw new AppError(422,'Parent role is unavailable.');next=role.parentRoleSlug;}
 return {name,slug,parentRoleSlug:parent,canCreateOwn:body.canCreateOwn,description:current?.description??null};
}
export async function listNativeRoles(){
 const roles:NativeRole[]=[];let page=0,total=0;
 do{const result=await backendClient().iam.roles.list({page,pageSize:100,organizationId:'default',filter:{search:''}});
 if(result.isSuccess===false||!Array.isArray(result.data)||!Number.isInteger(result.totalCount))throw new AppError(502,'Blocks role list unavailable.');
 total=result.totalCount!;if(total>10000||(!result.data.length&&roles.length<total))throw new AppError(502,'Blocks role list is incomplete.');
 roles.push(...result.data.map(nativeRole));page++;}while(roles.length<total);
 return roles;
}
export async function saveNativeRole(body:Record<string,unknown>,id?:string){
 const roles=await listNativeRoles(),current=id?roles.find(r=>r.id===id):undefined;
 if(id&&!current)throw new AppError(404,'Role not found.');
 const values=validateRoleChange(roles,body,current);
 const response=current?await backendClient().iam.roles.update({itemId:current.id,name:values.name,description:values.description,parentRoleSlug:values.parentRoleSlug,canCreateOwn:values.canCreateOwn,propagateToOtherOrg:false}):await backendClient().iam.roles.create(values);
 if(response.isSuccess!==true)throw new AppError(502,'Blocks did not save the role.');
 const readback=(await listNativeRoles()).find(r=>r.slug===values.slug);
 if(!readback||readback.parentRoleSlug!==values.parentRoleSlug||readback.canCreateOwn!==values.canCreateOwn||readback.name!==values.name)throw new AppError(502,'Role save could not be confirmed. Reload before retrying.');
 return readback;
}
