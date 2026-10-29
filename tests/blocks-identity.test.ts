import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyBlocksIdentity} from '../src/lib/blocks-identity';
const token=(claims:Record<string,unknown>)=>`header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
const claims={tenant_id:'tenant',user_id:'new-user',sub:'provider-subject'};
const user={itemId:'new-user',active:true,isVerified:true,email:'new@example.com',firstName:'New',roles:{}};
function setup(overrides:Partial<Parameters<typeof verifyBlocksIdentity>[1]>={}){
 return {projectKey:'tenant',authenticate:async()=>({ok:true,user:{sub:'new-user',tenant_id:'tenant'}}),profiles:async()=>({isSuccess:true,data:[user],totalCount:1}),...overrides};
}
test('Activated new signup with no roles or organizations can establish its identity',async()=>{
 const result=await verifyBlocksIdentity(token(claims),setup());
 assert.equal(result.id,'new-user');assert.equal(result.verified,true);assert.deepEqual(result.countryIds,[]);
});
test('Membership is resolved from the exact server-side IAM user, including membership with empty roles',async()=>{
 const result=await verifyBlocksIdentity(token(claims),setup({profiles:async id=>{assert.equal(id,'new-user');return {data:[{...user,roles:{default:[],company:[]}}, {...user,itemId:'other',roles:{secretCompany:['admin']}}],totalCount:2};}}));
 assert.deepEqual(result.countryIds,['company']);
});
test('Failed bearer authentication never accesses the backend user directory',async()=>{
 let read=false;
 await assert.rejects(()=>verifyBlocksIdentity(token(claims),setup({authenticate:async()=>({ok:false,user:{sub:'new-user',tenant_id:'tenant'}}),profiles:async()=>{read=true;return {data:[],totalCount:0};}})),/validate this session/);
 assert.equal(read,false);
});
test('Wrong-tenant tokens and mismatched validated subjects are rejected',async()=>{
 await assert.rejects(()=>verifyBlocksIdentity(token({...claims,tenant_id:'other'}),setup()),/another project/);
 await assert.rejects(()=>verifyBlocksIdentity(token({...claims,user_id:'other'}),setup()),/does not match/);
 await assert.rejects(()=>verifyBlocksIdentity(token(claims),setup({authenticate:async()=>({ok:true,user:{sub:'new-user',tenant_id:'other'}})})),/another project/);
});
test('Inactive, unverified, duplicate and malformed directory records fail closed',async()=>{
 for(const profile of [{...user,active:false},{...user,isVerified:false},{...user,roles:['admin']}])
  await assert.rejects(()=>verifyBlocksIdentity(token(claims),setup({profiles:async()=>({data:[profile],totalCount:1})})));
 await assert.rejects(()=>verifyBlocksIdentity(token(claims),setup({profiles:async()=>({data:[user,user],totalCount:2})})));
 await assert.rejects(()=>verifyBlocksIdentity(token(claims),setup({profiles:async()=>{throw new Error('upstream failure');}})),/current Blocks account/);
});
