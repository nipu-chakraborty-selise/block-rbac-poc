import {AppError,type Tables,type User} from './model';
import {MemoryStore} from './store';
import {Application} from './service';
import {BlocksDataRepository,type GatewayContracts,type DataTable,type StoredRecord} from './blocks-data';
import {backendClient,runtimeConfig} from './blocks-runtime';
import {liveSession} from './live-auth';
import contracts from '../../blocks/data/contracts.json';
const tables=Object.keys(contracts) as DataTable[];
export function liveRepository(){const client=backendClient(),config=runtimeConfig();return new BlocksDataRepository({apiUrl:config.apiUrl,xBlocksKey:config.projectKey,accessToken:()=>client.auth.accessToken()},contracts as GatewayContracts);}
/** Request-local projection of actual Gateway records, with no seed, cache or mock fallback. */
export async function liveWorkspace(user:User){const repository=liveRepository(),projection=new MemoryStore();const originals=new Map<DataTable,Map<string,StoredRecord<Tables[DataTable]>>>();
 await Promise.all(tables.map(async table=>{const map=new Map<string,StoredRecord<Tables[DataTable]>>();let page=1,total=0,count=0;do{const batch=await repository.list(table,{page,pageSize:100});total=batch.total;count+=batch.items.length;if(total>10000)throw new AppError(503,'Live POC collection exceeds its 10,000-record limit.');for(const row of batch.items){if(map.has(row.record.id))throw new AppError(503,`Duplicate application IDs in ${table}.`);map.set(row.record.id,row);projection.put(table,row.record);}if(!batch.items.length&&count<total)throw new AppError(502,'Incomplete Gateway pagination.');page++;}while(count<total);originals.set(table,map);}));
 // Validate active IAM parents; CountryMetadata only supplies application labels/code/archive.
 const metadata=projection.all('countryMetadata');const iam=backendClient();
 await Promise.all(metadata.map(async meta=>{const response=await iam.iam.organizations.get(meta.countryOrganizationId);const org=(response.organization||response.data) as Record<string,unknown>|undefined;if(response.isSuccess===false||!org||org.itemId!==meta.countryOrganizationId)throw new AppError(503,'Country metadata does not match a real IAM organization.');projection.put('countries',{id:meta.countryOrganizationId,code:meta.countryCode,name:meta.displayName,status:org.isDisabled===true?'archived':meta.status});}));
 projection.put('users',user);
 // Only an explicit application admin receives the IAM country user directory.
 if(projection.all('admins').some(grant=>grant.userId===user.id)){
  await Promise.all(metadata.map(async country=>{let page=0,count=0,total=0;do{
   const result=await iam.iam.users.list({page,pageSize:100,filter:{organizationId:country.countryOrganizationId}});
   if(result.isSuccess===false||!Array.isArray(result.data)||!Number.isInteger(result.totalCount))throw new AppError(503,'Cannot load the live country user directory.');
   total=result.totalCount!;count+=result.data.length;if(total>10000)throw new AppError(503,'Live user directory exceeds the POC limit.');
   for(const u of result.data){if(!u.itemId)throw new AppError(502,'IAM user identity is missing.');const existing=projection.get('users',u.itemId);projection.put('users',{id:u.itemId,name:[u.firstName,u.lastName].filter(Boolean).join(' ')||u.email||u.itemId,email:u.email||'',verified:u.isVerified===true,projectId:runtimeConfig().projectKey,countryIds:[...new Set([...(existing?.countryIds||[]),country.countryOrganizationId])]});}
   if(!result.data.length&&count<total)throw new AppError(502,'Incomplete IAM user directory.');page++;
  }while(count<total);}));
 }

 const ids=[...new Set(projection.all('memberships').map(m=>m.userId))].filter(id=>!projection.get('users',id));
 // IAM supplies profiles, never application grants from profile attributes.
 await Promise.all(ids.map(async id=>{const member=projection.all('memberships').find(m=>m.userId===id)!;const response=await iam.http.request<{data?:import('@seliseblocks/client').BlocksUser;isSuccess?:boolean}>(`/iam/v4/iam/users/${encodeURIComponent(id)}`,{query:{organizationId:member.countryOrganizationId}});const u=response.data;if(!u||response.isSuccess===false||!u.itemId)throw new AppError(503,'Cannot resolve a scoped member’s IAM identity.');projection.put('users',{id:u.itemId,name:[u.firstName,u.lastName].filter(Boolean).join(' ')||u.email||u.itemId,email:u.email||'',verified:u.isVerified===true,projectId:runtimeConfig().projectKey,countryIds:[]});}));
 const app=new Application(projection,runtimeConfig().projectKey);
 async function flush(){
  // Country edits preserve separate codes and display labels, without deleting the IAM country.
  for(const c of projection.all('countries')){const meta=projection.all('countryMetadata').find(m=>m.countryOrganizationId===c.id);if(meta&&(meta.displayName!==c.name||meta.status!==c.status))projection.put('countryMetadata',{...meta,displayName:c.name,status:c.status});}
  const writes:{table:DataTable;row?:Tables[DataTable];old?:StoredRecord<Tables[DataTable]>}[]=[];
  for(const table of tables){const before=originals.get(table)!;for(const row of projection.all(table)){const old=before.get(row.id);if(!old||JSON.stringify(old.record)!==JSON.stringify(row))writes.push({table,row,old});}for(const [id,old]of before)if(!projection.get(table,id))writes.push({table,old});}
  const audits=writes.filter(w=>w.table==='audit'&&w.row&&!w.old),business=writes.filter(w=>w.table!=='audit');
  // An intent record precedes each operation. A crash leaves a truthful '.requested' audit.
  const auditIds=new Map<string,string>();for(const w of audits){const row=w.row as Tables['audit'];auditIds.set(row.id,await repository.create('audit',{...row,action:`${row.action}.requested`}));}
  let completed=0;try{for(const w of business){if(w.row){if(w.old){if(!w.old.revision)throw new AppError(503,'Gateway revision is required for live updates.');await repository.compareAndSet(w.table,w.old.itemId,w.row,w.old.revision);}else await repository.create(w.table,w.row);}else if(w.old)await repository.remove(w.table,w.old.itemId);completed++;}}
  catch(e){if(completed)throw new AppError(503,'Some live records were saved before a later operation failed. Refresh the workspace before retrying; audit intents are preserved.');throw e;}
  for(const w of audits){const row=w.row as Tables['audit'];try{await repository.update('audit',auditIds.get(row.id)!,row);}catch{console.error('Live operation completed; audit intent remains pending reconciliation.');}}
 }
 return {app,flush};
}
export async function liveRequest(req:Request){const identity=await liveSession(req);const workspace=await liveWorkspace(identity.user);return {...identity,...workspace};}
