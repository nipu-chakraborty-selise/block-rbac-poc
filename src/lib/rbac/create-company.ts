import {randomUUID} from 'node:crypto';
import type {backendClient} from '../blocks-runtime';
import {AppError} from '../model';
type Organizations=ReturnType<typeof backendClient>['iam']['organizations'];
type RecordShape=Record<string,unknown>;
function object(value:unknown):RecordShape {return value&&typeof value==='object'&&!Array.isArray(value)?value as RecordShape:{};}
export async function createCompanyOrganization(iam:Pick<Organizations,'create'|'list'|'get'>,name:string):Promise<string>{
 // A per-request correlation reference prevents same-name concurrent creations being confused.
 const description=`Atlas company creation ${randomUUID()}`;
 const created=await iam.create({name,description,defaultRoleForMembers:[],defaultPermissionsForMembers:[]});
 if(created.isSuccess!==true)throw new AppError(502,'IAM did not create the organization.');
 const candidates=[created,object(created.data),object(created.organization),object(object(created.data).organization)];
 const direct=candidates.map(value=>value.itemId).find(id=>typeof id==='string'&&id) as string|undefined;
 const verify=async(id:string)=>{
  const result=await iam.get(id);const org=object(result.organization||result.data);
  return result.isSuccess!==false&&org.itemId===id&&org.name===name&&org.description===description&&org.isDisabled!==true;
 };
 if(direct){if(await verify(direct))return direct;throw new AppError(503,'Created organization could not be matched to this request. Contact an administrator before retrying.');}
 const matches=new Set<string>();let page=0;
 while(page<100){
  const result=await iam.list({Page:page,PageSize:100,'Filter.Search':name});
  if(result.isSuccess===false||!Array.isArray(result.organizations))throw new AppError(503,'Organization created, but lookup failed. Contact an administrator before retrying.');
  for(const org of result.organizations){
   if(typeof org.itemId==='string'&&org.name===name&&await verify(org.itemId))matches.add(org.itemId);
  }
  if(result.organizations.length<100)break;
  page++;
 }
 if(page>=100||matches.size!==1)throw new AppError(503,'Organization created, but its request reference is ambiguous or missing. Contact an administrator before retrying.');
 return [...matches][0];
}
