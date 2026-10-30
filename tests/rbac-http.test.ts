import { test } from "node:test";
import assert from "node:assert/strict";
import { rbacHandler } from "../src/lib/rbac/http";
import { handle, application } from "../src/lib/http";
import { POST as retired } from "../src/app/api/[[...path]]/route";
import {PROJECT_ID} from "../src/lib/seed";
import {defaultPermissions} from '../src/lib/rbac/permissions';
const request = (
  path: string,
  method = "GET",
  body?: unknown,
  cookie?: string,
  origin = "http://localhost",
) =>
  new Request(`http://localhost/api/${path}`, {
    method,
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
const call = (path: string, method = "GET", body?: unknown, cookie?: string) =>
  rbacHandler(request(`rbac/${path}`, method, body, cookie));
test('Tenant-wide native roles are inaccessible to company/unit users and mock mode never accesses IAM',async()=>{
 assert.equal((await call('native-roles')).status,401);
 for(const id of ['recruit-admin','hr-admin','recruit-member']){
  const cookie=await login(id);
  assert.equal((await call('native-roles','GET',undefined,cookie)).status,403);
  assert.equal((await call('native-roles','POST',{name:'Unauthorized'},cookie)).status,403);
  assert.equal((await call('native-roles/changed-id','PATCH',{name:'Unauthorized'},cookie)).status,403);
 }
 const root=await login('super');
 assert.equal((await call('native-roles','GET',undefined,root)).status,503);
 assert.equal((await rbacHandler(request('rbac/native-roles','POST',{},root,'https://evil.example'))).status,403);
});
test("Outside organization accounts can accept a bound invitation without reading its workspace",async()=>{
 const admin=await login("super"),recipient=await login("germany-admin");
 assert.equal((await call("organizations/bd","GET",undefined,recipient)).status,403);
 const state=await (await call("organizations/bd","GET",undefined,admin)).json();
 const response=await call("organizations/bd/invitations","POST",{email:"germany-admin@demo.local",unitId:"legal",role:"unit-user",revision:state.revision},admin);
 assert.equal(response.status,200);
 const link=await response.json();
 assert.equal((await call(`organizations/bd/invitations/${link.id}/accept`,"POST",{token:"wrong"},recipient)).status,403);
 assert.equal((await call("organizations/bd","GET",undefined,recipient)).status,403);
 assert.equal((await call(`organizations/bd/invitations/${link.id}/accept`,"POST",{token:link.token},recipient)).status,200);
 const access=await call("organizations/bd/access?unitId=legal","GET",undefined,recipient);
 assert.equal(access.status,200);assert.equal((await access.json()).role,"unit-user");
 assert.equal((await call(`organizations/bd/invitations/${link.id}/accept`,"POST",{token:link.token},recipient)).status,200);
});
async function login(id: string) {
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";
  process.env.APP_MODE = "mock";
  const response = await handle(request("auth/mock", "POST", { userId: id }));
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie")!.split(";")[0];
}
test("Organization invitation scope is Super Admin only and verified signup gets the stored role",async()=>{
 const root=await login("super"),unitAdmin=await login("recruit-admin");
 const state=await (await call("organizations/bd","GET",undefined,root)).json();
 const body={scope:"organization",email:"new-org-admin@demo.local",role:"organization-admin",revision:state.revision};
 assert.equal((await call("organizations/bd/invitations","POST",body,unitAdmin)).status,403);
 const invited=await call("organizations/bd/invitations","POST",body,root);
 assert.equal(invited.status,200);const link=await invited.json();
 assert.equal(link.emailStatus,"mock");
 application().store.put("users",{id:"new-org-admin",name:"New organization admin",email:body.email,verified:true,projectId:PROJECT_ID,countryIds:[]});
 const recipient=await login("new-org-admin");
 const accepted=await call(`organizations/bd/invitations/${link.id}/accept`,"POST",{token:link.token,role:"unit-user"},recipient);
 assert.equal(accepted.status,200);
 const joined=await (await call("organizations/bd","GET",undefined,recipient)).json();
 assert.equal(joined.organizationAdmin,true);
 assert.equal(joined.members.find((m:{userId:string})=>m.userId==="new-org-admin").role,"organization-admin");
 // Restore the original single-admin fixture for the last-admin regression below.
 assert.equal((await call("organizations/bd/members","POST",{userId:"new-org-admin",role:"member",revision:joined.revision},root)).status,200);
});
test("Verified signup can create and own a company without gaining platform or other-company access",async()=>{
 const app=application();
 app.store.put("users",{id:"company-founder",name:"Company founder",email:"founder@demo.local",verified:true,projectId:PROJECT_ID,countryIds:[]});
 const cookie=await login("company-founder");
 const created=await call("organizations","POST",{name:"Founder company",ownerId:"super",superAdmin:true},cookie);
 assert.equal(created.status,201);const company=await created.json();
 assert.equal(company.companyOwner,true);assert.equal(company.initialized,true);
 const state=await (await call(`organizations/${company.id}`,"GET",undefined,cookie)).json();
 assert.equal(state.ownerId,"company-founder");assert.equal(state.companyOwner,true);
 assert.equal(state.organizationAdmin,true);assert.equal(state.superAdmin,false);
 assert.equal(state.canInviteOrganization,true);
 assert.equal((await call("organizations/bd","GET",undefined,cookie)).status,403);
 const visible=await (await call("organizations","GET",undefined,cookie)).json();
 assert.deepEqual(visible.organizations.map((o:{id:string})=>o.id),[company.id]);
 assert.equal(app.store.all("admins").some(a=>a.userId==="company-founder"),false);
 const invite=await call(`organizations/${company.id}/invitations`,"POST",{scope:"organization",email:"staff@demo.local",role:"organization-admin",revision:state.revision},cookie);
 assert.equal(invite.status,200);
 const updated=await (await call(`organizations/${company.id}`,"GET",undefined,cookie)).json();
 assert.equal((await call(`organizations/${company.id}/members`,"POST",{userId:"company-founder",role:"member",revision:updated.revision},cookie)).status,409);
});
test('Organization Admin manages owner-authorized units and units they create but cannot manage the company',async()=>{
 const founder=await login('company-founder');
 const organizations=await (await call('organizations','GET',undefined,founder)).json();
 const id=organizations.organizations.find((o:{name:string})=>o.name==='Founder company').id;
 const snapshot=async(cookie:string)=> (await call(`organizations/${id}`,'GET',undefined,cookie)).json();
 let state=await snapshot(founder);
 const created=await call(`organizations/${id}/units`,'POST',{name:'Team A',revision:state.revision},founder);assert.equal(created.status,200);const unit=await created.json();
 state=await snapshot(founder);
 const other=await call(`organizations/${id}/units`,'POST',{name:'Team B',revision:state.revision},founder);assert.equal(other.status,200);const secondUnit=await other.json();
 application().store.put('users',{id:'company-org-admin',name:'Org admin',email:'org-admin@demo.local',verified:true,projectId:PROJECT_ID,countryIds:[id]});
 state=await snapshot(founder);
 assert.equal((await call(`organizations/${id}/members`,'POST',{userId:'company-org-admin',role:'organization-admin',managedUnitIds:[unit.id,secondUnit.id],revision:state.revision},founder)).status,200);
 const admin=await login('company-org-admin');state=await snapshot(admin);
 assert.equal(state.units.length,2);
 assert.equal((await call(`organizations/${id}/access?unitId=${secondUnit.id}`,'GET',undefined,admin)).status,200);
 assert.equal((await call(`organizations/${id}/units/${secondUnit.id}`,'PATCH',{name:'Team B renamed',revision:state.revision},admin)).status,200);
 state=await snapshot(admin);
 assert.equal((await call(`organizations/${id}/invitations`,'POST',{email:'new-member@demo.local',unitId:unit.id,role:'unit-admin',revision:state.revision},admin)).status,200);
 state=await snapshot(admin);
 assert.equal((await call(`organizations/${id}/invitations`,'POST',{email:'unit-member@demo.local',unitId:secondUnit.id,role:'unit-user',revision:state.revision},admin)).status,200);
 state=await snapshot(admin);
 assert.equal((await call(`organizations/${id}/members`,'POST',{userId:'company-org-admin',role:'member',revision:state.revision},admin)).status,403);
 const capabilities=await (await call(`organizations/${id}/access`,'GET',undefined,admin)).json();
 assert.equal(capabilities.canManageOrganization,false);assert.equal(capabilities.canManageMembers,false);
 const ownUnit=await call(`organizations/${id}/units`,'POST',{name:'Admin created',revision:state.revision},admin);assert.equal(ownUnit.status,200);
 assert.equal((await call(`organizations/${id}/access?unitId=${(await ownUnit.json()).id}`,'GET',undefined,admin)).status,200);
});
test("RBAC HTTP checks authentication, origin, changed IDs and fixed-role delegation", async () => {
  process.env.APP_MODE = "mock";
  assert.equal((await call("organizations")).status, 401);
  const cookie = await login("recruit-admin");
  const response = await call("organizations/bd", "GET", undefined, cookie),
    state = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(
    state.units.map((u: { id: string }) => u.id),
    ["hrm"],
  );
  assert.equal(
    (await call("organizations/de", "GET", undefined, cookie)).status,
    403,
  );
  assert.equal(
    (
      await call(
        "organizations/bd/access?unitId=legal",
        "GET",
        undefined,
        cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        "organizations/bd/units",
        "POST",
        { name: "Forbidden", revision: state.revision },
        cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        "organizations/bd/units/hrm/members",
        "POST",
        { userId: "unassigned", role: "custom-role", revision: state.revision },
        cookie,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await call(
        "organizations/bd/units/hrm/members",
        "POST",
        { userId: "unassigned", role: "unit-admin", revision: state.revision },
        cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await rbacHandler(
        request(
          "rbac/organizations/bd/units",
          "POST",
          { name: "CSRF", revision: state.revision },
          cookie,
          "https://evil.example",
        ),
      )
    ).status,
    403,
  );
  const access = await (
    await call("organizations/bd/access?unitId=hrm", "GET", undefined, cookie)
  ).json();
  assert.equal(access.canManageUnit, false);
  assert.equal(access.canManageMembers, true);
  assert.equal(
    (
      await retired(
        request(
          "countries/bd/departments",
          "POST",
          { name: "Legacy bypass" },
          cookie,
        ),
      )
    ).status,
    410,
  );
});
test("HTTP revisions protect concurrent updates and the last Organization Admin", async () => {
  const cookie = await login("super");
  const state = await (
    await call("organizations/bd", "GET", undefined, cookie)
  ).json();
  assert.equal(
    (
      await call(
        "organizations/bd/members",
        "POST",
        { userId: "hr-admin", role: "member", revision: state.revision },
        cookie,
      )
    ).status,
    409,
  );
  const name = `Finance ${crypto.randomUUID()}`;
  const results = await Promise.all([
    call(
      "organizations/bd/units",
      "POST",
      { name, revision: state.revision },
      cookie,
    ),
    call(
      "organizations/bd/units",
      "POST",
      { name, revision: state.revision },
      cookie,
    ),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (
      await call(
        "organizations/bd/units",
        "POST",
        { name: "No revision" },
        cookie,
      )
    ).status,
    409,
  );
  const current = await (
    await call("organizations/bd", "GET", undefined, cookie)
  ).json();
  assert.equal(
    current.units.filter((u: { name: string }) => u.name === name).length,
    1,
  );
});

test('Workspace permission API enforces owner scope, lower-role delegation, CAS and effective content grants',async()=>{
 const app=application();
 app.store.put('users',{id:'permission-owner',name:'Permission owner',email:'permissions@demo.local',verified:true,projectId:PROJECT_ID,countryIds:[]});
 const owner=await login('permission-owner');
 const company=await (await call('organizations','POST',{name:'Permission company'},owner)).json();
 const base=`organizations/${company.id}`;
 const snapshot=async(cookie=owner)=>(await call(base,'GET',undefined,cookie)).json();
 let state=await snapshot();
 const unit=await (await call(`${base}/units`,'POST',{name:'Scoped unit',revision:state.revision},owner)).json();
 app.store.put('users',{id:'permission-admin',name:'Permission admin',email:'permission-admin@demo.local',verified:true,projectId:PROJECT_ID,countryIds:[company.id]});
 state=await snapshot();
 assert.equal((await call(`${base}/members`,'POST',{userId:'permission-admin',role:'organization-admin',managedUnitIds:[unit.id],revision:state.revision},owner)).status,200);
 const admin=await login('permission-admin');state=await snapshot();
 const body={role:'organization-admin',permissions:{...defaultPermissions('organization-admin'),createUnit:false,manageContent:false},revision:state.revision};
 assert.equal((await call(`${base}/permissions`,'PATCH',body,admin)).status,403);
 assert.equal((await call(`${base}/permissions`,'PATCH',body,owner)).status,200);
 assert.equal((await call(`${base}/permissions`,'PATCH',body,owner)).status,409);
 state=await snapshot(admin);assert.equal(state.canCreateUnit,false);
 assert.equal((await call(`${base}/units`,'POST',{name:'Denied unit',revision:state.revision},admin)).status,403);
 assert.equal((await call(`${base}/permissions`,'PATCH',{role:'unit-admin',unitId:unit.id,permissions:defaultPermissions('unit-admin'),revision:state.revision},admin)).status,403);
 assert.equal((await call(`${base}/permissions`,'PATCH',{role:'unit-admin',unitId:unit.id,permissions:{...defaultPermissions('unit-admin'),manageContent:false},revision:state.revision},admin)).status,200);
 const access=await (await call(`${base}/access?unitId=${encodeURIComponent(unit.id)}`,'GET',undefined,admin)).json();
 assert.equal(access.canManageUnitContent,false);
 assert.equal(access.permissions.manageContent,false);
 const outsider=await login('germany-admin');
 assert.equal((await call(`${base}/permissions`,'PATCH',{...body,revision:(await snapshot()).revision},outsider)).status,403);
});
