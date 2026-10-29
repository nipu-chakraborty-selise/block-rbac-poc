import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hasOrganizationRoleMembership,provisionUser} from '../src/lib/live-users';
import {backendClient} from '../src/lib/blocks-runtime';
type IAM=ReturnType<typeof backendClient>['iam']['users'];
const user={itemId:'u',email:'person@example.com',active:true,isVerified:true,roles:{bd:[] as string[]}};
test('roles map is the membership source of truth',()=>{
 assert.equal(hasOrganizationRoleMembership({roles:{bd:[]}},'bd'),true);
 assert.equal(hasOrganizationRoleMembership({roles:{default:[]}},'bd'),false);
 assert.equal(hasOrganizationRoleMembership({roles:undefined},'bd'),false);
});
test('existing country member keeps IAM permissions unchanged',async()=>{
 let writes=0;
 const iam={list:async()=>({isSuccess:true,data:[user],totalCount:1}),updateAccess:async()=>{writes++;return {isSuccess:true};}} as unknown as IAM;
 const result=await provisionUser('bd',{email:user.email},{iam,projectId:'tenant'});
 assert.equal(result.id,'u');assert.equal(writes,0);
});
test('invite accept retries treat already-a-member IAM responses as success',async()=>{
 let member=false;
 const profile=()=>({...user,roles:member?{bd:[]}:{default:[]}});
 const iam={
  list:async()=>({isSuccess:true,data:[profile()],totalCount:1}),
  updateAccess:async()=>{
   member=true;
   const error=Object.assign(new Error('Blocks API 400 Bad Request: User is already a member of the organization'),{status:400,body:{errors:{Organization:'User is already a member of the organization'}}});
   throw error;
  },
 } as unknown as IAM;
 const result=await provisionUser('bd',{email:user.email},{iam,projectId:'tenant'});
 assert.equal(result.id,'u');
 assert.equal(member,true);
});
test('country grant carries no IAM privileges and requires confirmation',async()=>{
 let granted=false;
 const profile=()=>({...user,roles:granted?{bd:[]}:{default:[]}});
 const iam={list:async()=>({isSuccess:true,data:[profile()],totalCount:1}),updateAccess:async(b:Record<string,unknown>)=>{assert.deepEqual(b,{userId:'u',organizationId:'bd',roles:[],permissions:[],notifyUser:false});granted=true;return {isSuccess:true};}} as unknown as IAM;
 await provisionUser('bd',{email:user.email},{iam,projectId:'tenant'});assert.equal(granted,true);
 granted=false;iam.updateAccess=async()=>({isSuccess:true});
 await assert.rejects(()=>provisionUser('bd',{email:user.email},{iam,projectId:'tenant'}),/could not be confirmed/);
});
test('list(?organizationId) false positives still trigger a real grant',async()=>{
 let writes=0;
 // Blocks may return the user for an org filter even when roles only has "default".
 const profile={...user,roles:{default:[] as string[]}};
 const iam={
  list:async(b:Record<string,unknown>)=>{
   if((b.filter as Record<string,unknown>).organizationId)return {isSuccess:true,data:[profile],totalCount:1};
   return {isSuccess:true,data:[{...profile,roles:writes?{default:[],bd:[]}:{default:[]}}],totalCount:1};
  },
  updateAccess:async()=>{writes++;return {isSuccess:true};},
 } as unknown as IAM;
 await provisionUser('bd',{email:user.email},{iam,projectId:'tenant'});
 assert.equal(writes,1);
});
test('inactive users and unknown accounts cannot receive access',async()=>{
 let writes=0;
 const iam={list:async()=>({isSuccess:true,data:[{...user,active:false}],totalCount:1}),updateAccess:async()=>{writes++;return {isSuccess:true};}} as unknown as IAM;
 await assert.rejects(()=>provisionUser('bd',{email:user.email},{iam,projectId:'tenant'}),/active and verified/);
 iam.list=async()=>({isSuccess:true,data:[],totalCount:0});
 await assert.rejects(()=>provisionUser('bd',{email:user.email},{iam,projectId:'tenant'}),/No existing IAM account/);
 assert.equal(writes,0);
});
test('new account creation disables email and checks activation before assignment',async()=>{
 let created=false,activated=false;
 const iam={list:async()=>({isSuccess:true,data:created?[{...user,active:activated,isVerified:activated,roles:activated?{bd:[]}:{}}]:[],totalCount:created?1:0}),create:async(b:Record<string,unknown>)=>{assert.equal(b.sendMail,false);assert.equal(b.notifyUser,false);assert.deepEqual(b.permissions,[]);assert.deepEqual(b.roles,[]);created=true;return {isSuccess:true};},activate:async(b:Record<string,unknown>)=>{assert.equal(b.userId,user.itemId);assert.equal(b.reason,'Super-admin provisioned organization member');activated=true;return {isSuccess:true};}} as unknown as IAM;
 const result=await provisionUser('bd',{accountMode:'new',email:user.email,name:'Person',password:'12345678'},{iam,projectId:'tenant'});
 assert.equal(result.verified,true);assert.equal(activated,true);
});
