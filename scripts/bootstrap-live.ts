import env from '@next/env';
import {readFileSync} from 'node:fs';
import {MemoryStore} from '../src/lib/store';
import {seed} from '../src/lib/seed';
import {liveRepository} from '../src/lib/live-workspace';
import type {DataTable} from '../src/lib/blocks-data';
import type {Tables} from '../src/lib/model';
env.loadEnvConfig(process.cwd());
const mapping=JSON.parse(readFileSync('blocks/plans/country-mapping.json','utf8')) as {code:string;name:string;id:string}[];
const grant=JSON.parse(readFileSync('blocks/plans/bootstrap-super.json','utf8'));
const store=new MemoryStore();seed(store);const repo=liveRepository();
const ids=Object.fromEntries(mapping.map(c=>[c.code.toLowerCase(),c.id]));
for(const c of mapping)store.put('countryMetadata',{id:`country-${c.code}`,countryOrganizationId:c.id,countryCode:c.code,displayName:c.name,status:'active'});
store.put('admins',{id:'bootstrap-super',userId:grant.userId,grantedBy:grant.grantedBy,createdAt:new Date().toISOString()});
const tables:DataTable[]=['countryMetadata','admins','departments','groups','roles','resources','audit'];
for(const table of tables){const current=await repo.list(table);for(const source of store.all(table)){
 const row={...source} as unknown as Record<string,unknown>;
 for(const field of ['countryOrganizationId'])if(typeof row[field]==='string'&&ids[row[field]])row[field]=ids[row[field]];
 for(const field of ['createdBy','actorId'])if(row[field]==='super')row[field]=grant.userId;
 if(!current.items.some(r=>r.record.id===row.id))await repo.create(table,row as unknown as Tables[typeof table]);
 }console.log('Live collection ready:',table);}
