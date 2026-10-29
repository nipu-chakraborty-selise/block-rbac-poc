import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {activateInvitationAccount,previewInvitation,activationFailed} from '../src/lib/rbac/activate-invitation';
import {sharedMockRepository} from '../src/lib/rbac/repository';
import {emptyState,type OrganizationState} from '../src/lib/rbac/model';
import {tokenHash} from '../src/lib/rbac/service';
import {application,handle} from '../src/lib/http';

const token=randomBytes(16).toString('base64url');
const inviteId=randomUUID();
test('Successful activation with an empty errors array is not rejected',()=>{
 assert.equal(activationFailed({isSuccess:true,errors:[]}),false);
 assert.equal(activationFailed({isSuccess:true,errors:null}),false);
 assert.equal(activationFailed({isSuccess:false,errors:[]}),true);
 assert.equal(activationFailed({isSuccess:true,errors:['invalid code']}),true);
 assert.equal(activationFailed({error:'invalid_code'}),true);
});

async function seedInvite(email='newbie@demo.local'){
  application();
  const state:OrganizationState={
    ...emptyState({id:'bd',name:'Bangladesh',status:'active'}),
    members:[{userId:'super',role:'organization-admin',status:'active'}],
    units:[{id:'hrm',name:'HRM',status:'active'}],
    invitations:[{
      id:inviteId,
      email,
      recipientId:'',
      unitId:'',
      role:'organization-admin',
      scope:'organization',
      tokenHash:tokenHash(token),
      invitedBy:'super',
      expiresAt:new Date(Date.now()+86400000).toISOString(),
      status:'pending',
    }],
  };
  await sharedMockRepository.commit(state,await sharedMockRepository.load('bd'));
  return {organizationId:'bd',inviteId,token,email};
}

test('Invitation preview exposes activate-account context for a pending invite',async()=>{
  const invite=await seedInvite('unassigned@demo.local');
  const preview=await previewInvitation(invite);
  assert.equal(preview.email,'unassigned@demo.local');
  assert.equal(preview.roleLabel,'Organization Admin');
  assert.equal(preview.accountStatus,'active');
  assert.equal(preview.organization,'Bangladesh');
});
test('Invitation preview uses an origin-checked POST body, never a GET query',async()=>{
 const invite=await seedInvite('unassigned@demo.local');
 const body={organizationId:invite.organizationId,inviteId:invite.inviteId,token:invite.token};
 const request=(method:string,origin='http://localhost')=>new Request('http://localhost/api/auth/invitation-preview',{method,headers:{origin,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})});
 assert.equal((await handle(request('GET'))).status,405);
 assert.equal((await handle(request('POST','https://evil.example'))).status,403);
 const result=await handle(request('POST'));assert.equal(result.status,200);assert.equal((await result.json()).email,'unassigned@demo.local');
});

test('Activate invitation page creates a verified mock account for new invitees',async()=>{
  const invite=await seedInvite('activate.newbie@demo.local');
  const result=await activateInvitationAccount({
    ...invite,
    firstName:'New',
    lastName:'Invitee',
    password:'Password1!',
  });
  assert.equal(result.status,'activated');
  assert.equal(result.next,'signin');
  const user=application().store.all('users').find(u=>u.email==='activate.newbie@demo.local');
  assert.equal(user?.verified,true);
  assert.match(user?.name||'',/New Invitee/);
});
