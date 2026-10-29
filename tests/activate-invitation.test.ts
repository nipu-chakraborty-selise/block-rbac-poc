import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {activateInvitationAccount,previewInvitation} from '../src/lib/rbac/activate-invitation';
import {sharedMockRepository} from '../src/lib/rbac/repository';
import {emptyState,type OrganizationState} from '../src/lib/rbac/model';
import {tokenHash} from '../src/lib/rbac/service';
import {application} from '../src/lib/http';

const token=randomBytes(16).toString('base64url');
const inviteId=randomUUID();

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
