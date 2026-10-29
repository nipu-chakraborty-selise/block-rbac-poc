import test from 'node:test';import assert from 'node:assert/strict';
import {createCompanyOrganization} from '../src/lib/rbac/create-company';
test('Concurrent same-name company creations resolve only their own request reference',async()=>{
 const records:Record<string,unknown>[]=[];let release:()=>void=()=>{};
 const both=new Promise<void>(resolve=>{release=resolve;});
 const iam={
  create:async(body:Record<string,unknown>)=>{records.push({...body,itemId:`org-${records.length}`});if(records.length===2)release();await both;return {isSuccess:true};},
  list:async()=>({isSuccess:true,organizations:[...records].reverse()}),
  get:async(id:string)=>({isSuccess:true,data:records.find(r=>r.itemId===id)}),
 };
 const result=await Promise.all([createCompanyOrganization(iam,'Same Company'),createCompanyOrganization(iam,'Same Company')]);
 assert.deepEqual(result,['org-0','org-1']);assert.notEqual(records[0].description,records[1].description);
});
test('Company lookup fails closed if creation reference is missing',async()=>{
 const iam={create:async()=>({isSuccess:true}),list:async()=>({organizations:[{name:'Company',itemId:'unrelated'}]}),get:async()=>({data:{name:'Company',itemId:'unrelated',description:'not this request'}})};
 await assert.rejects(()=>createCompanyOrganization(iam,'Company'),/ambiguous or missing/);
});
test('Direct creation IDs must also match the request and support nested data responses',async()=>{
 let created:Record<string,unknown>={};
 const iam={create:async(body:Record<string,unknown>)=>{created={...body,itemId:'new'};return {isSuccess:true,data:{itemId:'new'}};},list:async()=>{throw new Error('Should not list');},get:async()=>({data:created})};
 assert.equal(await createCompanyOrganization(iam,'Company'),'new');
 await assert.rejects(()=>createCompanyOrganization({...iam,get:async()=>({data:{...created,description:'wrong reference'}})},'Company'),/could not be matched/);
});
