import env from '@next/env';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {liveRepository,liveWorkspace} from '../src/lib/live-workspace';
import {backendClient,runtimeConfig} from '../src/lib/blocks-runtime';
env.loadEnvConfig(process.cwd());
const countries=JSON.parse(readFileSync('blocks/plans/country-mapping.json','utf8'));
const grant=JSON.parse(readFileSync('blocks/plans/bootstrap-super.json','utf8'));
const iam=backendClient();const org=await iam.iam.organizations.get(countries[0].id);console.log('Organization response contract:',Object.keys(org));

const repo=liveRepository();const id=`verification-${randomUUID()}`;
const row={id,countryOrganizationId:countries[0].id,name:'Temporary persistence verification',status:'active' as const,createdBy:grant.userId,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
const itemId=await repo.create('departments',row);
try{const saved=await repo.get('departments',itemId);if(!saved||saved.record.name!==row.name||!saved.revision)throw new Error('Persistence readback failed');await repo.compareAndSet('departments',itemId,{...row,name:'Updated verification'},saved.revision);let rejected=false;try{await repo.compareAndSet('departments',itemId,row,saved.revision)}catch{rejected=true}if(!rejected)throw new Error('Stale update was accepted');const updated=await repo.get('departments',itemId);if(updated?.record.name!=='Updated verification')throw new Error('Update readback failed');console.log('Live persistence and stale revision rejection passed');}finally{await repo.remove('departments',itemId)}
const u={itemId:grant.userId,email:'',isVerified:true}; // CLI-verified bootstrap identity, not a browser authentication test.
const workspace=await liveWorkspace({id:u.itemId,name:'Verified operator',email:String(u.email||''),verified:u.isVerified===true,projectId:runtimeConfig().projectKey,countryIds:countries.map((c:{id:string})=>c.id)});
const operator=workspace.app.store.get('users',u.itemId)!;
const department=workspace.app.hierarchySave(operator,countries[0].id,'department',undefined,{name:'Temporary domain persistence verification'});
await workspace.flush();const persisted=(await repo.list('departments')).items.find(r=>r.record.id===department.id);if(!persisted)throw new Error('Domain flush failed');await repo.remove('departments',persisted.itemId);
const anonymous=new (await import('../src/lib/blocks-data')).BlocksDataRepository({apiUrl:runtimeConfig().apiUrl,xBlocksKey:runtimeConfig().projectKey},(await import('../blocks/data/contracts.json')).default);let anonymousDenied=false;try{await anonymous.list('departments')}catch{anonymousDenied=true}if(!anonymousDenied)throw new Error('Anonymous Data access was allowed');
const evidence={verifiedAt:new Date().toISOString(),storage:'Blocks Data Gateway',countries:workspace.app.store.all('countries').length,departments:(await repo.list('departments')).total,groups:workspace.app.store.all('groups').length,explicitAdmin:workspace.app.auth.super(workspace.app.store.get('users',u.itemId)!),persistence:true,staleRevisionRejected:true,temporaryRecordDeleted:true,domainFlushVerified:true,anonymousDataDenied:true};writeFileSync('docs/blocks-live-runtime-evidence.json',JSON.stringify(evidence,null,2)+'\n');console.log(evidence);
