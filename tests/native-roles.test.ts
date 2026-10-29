import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeRole,validateRoleChange} from '../src/lib/rbac/native-roles';
const role=(slug:string,parentRoleSlug:string|null=null)=>nativeRole({itemId:slug,slug,name:slug,parentRoleSlug,description:'Preserve me',canCreateOwn:false,lastUpdatedDate:'2026-10-29T00:00:00Z'});
test('Native role hierarchy rejects self-parenting, indirect cycles and missing parents',()=>{
 const parent=role('atlas-manager'),child=role('atlas-staff','atlas-manager');
 const roles=[parent,child];
 const body={name:parent.name,parentRoleSlug:child.slug,canCreateOwn:false,revision:parent.revision};
 assert.throws(()=>validateRoleChange(roles,body,parent),/cycle/);
 assert.throws(()=>validateRoleChange(roles,{...body,parentRoleSlug:parent.slug},parent),/cycle/);
 assert.throws(()=>validateRoleChange(roles,{...body,parentRoleSlug:'missing'},parent),/unavailable/);
 const saved=validateRoleChange(roles,{...body,parentRoleSlug:null,canCreateOwn:true},parent);
 assert.equal(saved.description,'Preserve me');assert.equal(saved.canCreateOwn,true);
});
test('Native role edits protect service roles and reject stale or malformed requests',()=>{
 const protectedRole=role('atlas-data-backend');
 assert.throws(()=>validateRoleChange([protectedRole],{},protectedRole),/protected/);
 const current=role('atlas-reviewer');
 assert.throws(()=>validateRoleChange([current],{revision:'stale'},current),/changed/);
 assert.throws(()=>validateRoleChange([],{name:'Bad',slug:'clouduser',parentRoleSlug:null,canCreateOwn:false}),/slug/);
 assert.throws(()=>validateRoleChange([current],{name:'Duplicate',slug:current.slug,parentRoleSlug:null,canCreateOwn:false}),/reserved or in use/);
 assert.throws(()=>validateRoleChange([],{name:'New',slug:'atlas-new',parentRoleSlug:null,canCreateOwn:'true'}),/setting/);
 const newRole=validateRoleChange([current],{name:'New',slug:'atlas-new',parentRoleSlug:current.slug,canCreateOwn:false,permissions:['untrusted']});
 assert.equal('permissions' in newRole,false);
});
test('Native role revisions reflect parent, delegation and server revision changes',()=>{
 const a=role('atlas-reviewer');
 assert.notEqual(a.revision,nativeRole({itemId:a.id,slug:a.slug,name:a.name,parentRoleSlug:null,canCreateOwn:true}).revision);
});
