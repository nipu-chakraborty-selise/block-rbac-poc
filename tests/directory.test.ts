import test from 'node:test';import assert from 'node:assert/strict';
import {organizationDirectory} from '../src/lib/rbac/directory';
test('Directory uses plural organizationIds and filters nonmembers even when IAM returns them',async()=>{
 const users={list:async(body?:{filter?:Record<string,unknown>})=>{
  assert.deepEqual(body?.filter,{organizationIds:['company']});
  return {totalCount:2,data:[{itemId:'member',email:'member@example.com',active:true,isVerified:true,roles:{company:[]}},{itemId:'outside',email:'outside@example.com',active:true,isVerified:true,roles:{other:['admin']}}]};
 }};
 const directory=await organizationDirectory(users,'company',[]);
 assert.deepEqual(directory.map(u=>u.id),['member']);
 assert.deepEqual(directory[0].organizationIds,['company']);
});
test('Directory completes pagination without treating filtered records as fetched counts',async()=>{
 let calls=0;
 const users={list:async()=>++calls===1?{totalCount:2,data:[{itemId:'outside',roles:{}}]}:{totalCount:2,data:[{itemId:'member',roles:{company:[]}}]}};
 assert.deepEqual((await organizationDirectory(users,'company',[])).map(u=>u.id),['member']);assert.equal(calls,2);
});
