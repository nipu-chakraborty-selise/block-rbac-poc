import test from 'node:test';
import assert from 'node:assert/strict';
import {Rbac} from '../src/lib/rbac/service';
import {emptyState, type Identity} from '../src/lib/rbac/model';
import {defaultPermissions, validPermissionPolicy} from '../src/lib/rbac/permissions';
import {MockStateRepository} from '../src/lib/rbac/repository';

function setup() {
  const state=emptyState({id:'company',name:'Company',status:'active'});
  const person=(id:string):Identity=>({id,name:id,email:`${id}@example.com`,active:true,verified:true,organizationIds:['company'],superAdmin:false});
  const owner=person('owner'),admin=person('admin'),unitAdmin=person('unit-admin'),member=person('member'),newMember=person('new');
  state.ownerId=owner.id;
  state.members=[{userId:owner.id,role:'organization-admin',status:'active'},{userId:admin.id,role:'organization-admin',status:'active',managedUnitIds:['a']},...[unitAdmin,member,newMember].map(u=>({userId:u.id,role:'member' as const,status:'active' as const}))];
  state.units=[{id:'a',name:'A',status:'active'},{id:'b',name:'B',status:'active'}];
  state.assignments=[{unitId:'a',userId:unitAdmin.id,role:'unit-admin',status:'active'},{unitId:'a',userId:member.id,role:'unit-user',status:'active'}];
  return {state,owner,admin,unitAdmin,member,newMember};
}
test('Owner revokes Organization Admin actions immediately without changing unit scope or owner rights',()=>{
  const {state,owner,admin}=setup();
  new Rbac(state,owner).updatePermissions({role:'organization-admin',permissions:{...defaultPermissions('organization-admin'),createUnit:false,renameUnit:false}});
  const actor=new Rbac(state,admin);
  assert.equal(actor.snapshot().canCreateUnit,false);
  assert.throws(()=>actor.saveUnit(undefined,{name:'New'}),/does not permit/);
  assert.throws(()=>actor.saveUnit('a',{name:'Renamed'}),/does not permit/);
  assert.throws(()=>actor.statusUnit('b','archived'),/does not permit/);
  new Rbac(state,owner).saveUnit(undefined,{name:'Owner unit'});
  assert.equal(state.events[0].action,'role.permissions-changed');
});
test('Organization Admin can configure only child roles in authorized units and cannot delegate missing permissions',()=>{
  const {state,owner,admin,unitAdmin}=setup(),manager=new Rbac(state,admin);
  const grants={...defaultPermissions('unit-admin'),renameUnit:true,changeUnitStatus:true};
  assert.throws(()=>manager.updatePermissions({role:'organization-admin',permissions:defaultPermissions('organization-admin')}),/parent role/);
  assert.throws(()=>manager.updatePermissions({role:'unit-admin',permissions:grants}),/parent role/);
  assert.throws(()=>manager.updatePermissions({role:'unit-admin',unitId:'b',permissions:grants}),/parent role/);
  manager.updatePermissions({role:'unit-admin',unitId:'a',permissions:grants});
  new Rbac(state,unitAdmin).saveUnit('a',{name:'Renamed'});
  new Rbac(state,unitAdmin).statusUnit('a','archived');
  assert.equal(new Rbac(state,unitAdmin).snapshot().units[0].role,'unit-admin');
  new Rbac(state,unitAdmin).statusUnit('a','active');
  assert.throws(()=>new Rbac(state,unitAdmin).saveUnit('b',{name:'Other'}),/does not permit/);
  new Rbac(state,owner).updatePermissions({role:'organization-admin',permissions:{...defaultPermissions('organization-admin'),renameUnit:false}});
  assert.throws(()=>manager.updatePermissions({role:'unit-admin',unitId:'a',permissions:grants}),/cannot delegate/);
});
test('Lower roles cannot edit permissions or gain same-role or higher-role management',()=>{
  const {state,owner,unitAdmin,member}=setup();
  for(const actor of [unitAdmin,member])assert.throws(()=>new Rbac(state,actor).updatePermissions({role:'unit-user',unitId:'a',permissions:defaultPermissions('unit-user')}),/parent role/);
  assert.throws(()=>new Rbac(state,owner).updatePermissions({role:'unit-admin',permissions:{...defaultPermissions('unit-admin'),manageAdmins:true}}),/hierarchy/);
  assert.throws(()=>new Rbac(state,owner).updatePermissions({role:'unit-user',permissions:{...defaultPermissions('unit-user'),inviteMembers:true}}),/hierarchy/);
  assert.throws(()=>new Rbac(state,owner).updatePermissions({role:'organization-owner',permissions:defaultPermissions('organization-admin')}),/hierarchy/);
});
test('Revoked invitation authority blocks acceptance; invitation and assignment grants remain independent',()=>{
  const {state,owner,unitAdmin,newMember}=setup(),issuer=new Rbac(state,unitAdmin);
  new Rbac(state,owner).updatePermissions({role:'unit-admin',unitId:'a',permissions:{...defaultPermissions('unit-admin'),manageMembers:false}});
  const invite=issuer.invite(newMember,'a','unit-user');
  assert.throws(()=>issuer.assign(newMember,'a','unit-user'),/does not permit/);
  new Rbac(state,newMember).accept(invite.id,invite.token,unitAdmin);
  const next=issuer.invite({email:'another@example.com'},'a','unit-user');
  new Rbac(state,owner).updatePermissions({role:'unit-admin',unitId:'a',permissions:{...defaultPermissions('unit-admin'),inviteMembers:false}});
  const another={...newMember,id:'another',email:'another@example.com'};
  assert.throws(()=>new Rbac(state,another).accept(next.id,next.token,unitAdmin),/does not permit/);
  assert.throws(()=>issuer.invite({email:'third@example.com'},'a','unit-user'),/does not permit/);
});
test('Content permission grants preserve assigned-unit access and company isolation',()=>{
  const {state,owner,member}=setup();
  new Rbac(state,owner).updatePermissions({role:'unit-user',unitId:'a',permissions:{...defaultPermissions('unit-user'),manageContent:true}});
  assert.equal(new Rbac(state,member).can('manageContent','a'),true);
  assert.equal(new Rbac(state,member).can('manageContent','b'),false);
  const elsewhere=emptyState({id:'other',name:'Other',status:'active'});
  assert.equal(new Rbac(elsewhere,member).can('manageContent','a'),false);
  assert.throws(()=>new Rbac(state,{...member,organizationIds:[]}).requirePermission('manageContent','a'),/No access/);
});
test('Permission policies validate on persistence and use existing CAS revisions',async()=>{
  const {state,owner}=setup(),repo=new MockStateRepository();
  await repo.commit(state,undefined);
  const one=(await repo.load(state.organizationId))!,two=(await repo.load(state.organizationId))!;
  new Rbac(one.state,owner).updatePermissions({role:'unit-admin',permissions:{...defaultPermissions('unit-admin'),renameUnit:true}});
  await repo.commit(one.state,one);
  await assert.rejects(()=>repo.commit(two.state,two),/changed/);
  assert.equal(validPermissionPolicy({units:{unknown:{}}},['a']),false);
  assert.equal(validPermissionPolicy({roles:{'unit-admin':{...defaultPermissions('unit-admin'),manageAdmins:true}}},['a']),false);
  assert.equal(validPermissionPolicy(undefined,['a']),true);
});
