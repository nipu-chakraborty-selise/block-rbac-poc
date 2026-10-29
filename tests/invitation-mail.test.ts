import test from 'node:test';
import assert from 'node:assert/strict';
import {invitationLink,invitationMailLink,invitationRoleLabel,sendInvitationMail} from '../src/lib/rbac/invitation-mail';

test('Copied invitation links keep the token in the URL fragment',()=>{
 assert.equal(invitationRoleLabel('organization-admin'),'Organization Admin');
 assert.equal(invitationRoleLabel('unit-user'),'Unit Member');
 const href=invitationLink('https://app.example','org-1','invite-1','token-1');
 assert.match(href,/\/activate\?/);
 assert.match(href,/organization=org-1/);
 assert.match(href,/invite=invite-1/);
 assert.match(href,/#token=token-1$/);
 assert.doesNotMatch(href,/[?&]token=/);
});

test('Mail invitation links use the continue page so clients that strip fragments still work',async()=>{
 const href=invitationMailLink('https://app.example','org-1','invite-1','token-1');
 assert.match(href,/\/invite\/continue\?/);
 assert.match(href,/[?&]token=token-1(?:&|$)/);
 assert.doesNotMatch(href,/#/);

 let sent:Record<string,unknown>|undefined;
 const status=await sendInvitationMail(
  {
   email:'admin@example.com',
   organization:'Harbor Legal',
   unit:'Organization',
   role:'organization-admin',
   organizationId:'org-1',
   id:'invite-1',
   token:'token-1',
   scope:'organization',
  },
  {
   mode:()=>'live',
   origin:()=>'https://app.example',
   client:()=>({mail:{sendToAny:async(request)=>{sent=request;return {isSuccess:true,errors:[]};}}}),
  },
 );
 assert.equal(status,'queued');
 assert.deepEqual(sent?.to,['admin@example.com']);
 assert.equal(sent?.purpose,'AtlasUnitInvitation');
 const body=sent?.bodyDataContext as Record<string,string>;
 assert.equal(body.Role,'Organization Admin');
 assert.equal(body.Unit,'Organization');
 assert.equal(body.InvitationUrl,href);
 assert.equal(body.InvitationUrl.includes('&amp;'),false);
});

test('Mock mode never calls Blocks Mail; live failures are reported as failed',async()=>{
 assert.equal(await sendInvitationMail({email:'a@b.co',organization:'O',unit:'U',role:'member',organizationId:'o',id:'i',token:'t'},{mode:()=>'mock',client:()=>({mail:{sendToAny:async()=>{throw new Error('should not send');}}})}),'mock');
 assert.equal(await sendInvitationMail({email:'a@b.co',organization:'O',unit:'U',role:'member',organizationId:'o',id:'i',token:'t'},{mode:()=>'live',origin:()=>'https://app.example',client:()=>({mail:{sendToAny:async()=>({isSuccess:false,errors:['denied']})}})}),'failed');
});
