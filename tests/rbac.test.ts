import { test } from "node:test";
import assert from "node:assert/strict";
import { Rbac } from "../src/lib/rbac/service";
import { emptyState, type Identity } from "../src/lib/rbac/model";
import { MockStateRepository, legacyImport } from "../src/lib/rbac/repository";
import { AppError } from "../src/lib/model";
const person = (id: string, superAdmin = false): Identity => ({
  id,
  name: id,
  email: `${id}@example.com`,
  active: true,
  verified: true,
  organizationIds: ["bd"],
  superAdmin,
});
const setup = () => {
  const state = emptyState({ id: "bd", name: "Bangladesh", status: "active" }),
    root = person("root", true),
    admin = person("admin"),
    unitAdmin = person("unit-admin"),
    user = person("user");
  state.members = [
    { userId: admin.id, role: "organization-admin", status: "active" },
    { userId: unitAdmin.id, role: "member", status: "active" },
    { userId: user.id, role: "member", status: "active" },
  ];
  state.units = [
    { id: "hr", name: "HR", status: "active" },
    { id: "legal", name: "Legal", status: "active" },
  ];
  state.assignments = [
    {
      unitId: "hr",
      userId: unitAdmin.id,
      role: "unit-admin",
      status: "active",
    },
    { unitId: "hr", userId: user.id, role: "unit-user", status: "active" },
  ];
  return { state, root, admin, unitAdmin, user };
};
const denied = (fn: () => unknown, status = 403) =>
  assert.throws(
    fn,
    (e: unknown) => e instanceof AppError && e.status === status,
  );
test("Organization Admin manages only their organization; platform super-admin is explicit", () => {
  const { state, admin } = setup();
  const wrong = new Rbac({ ...state, organizationId: "de" }, admin);
  denied(() => wrong.saveUnit(undefined, { name: "Legal" }));
  assert.equal(new Rbac(state, admin).snapshot().units.length, 2);
});
test("Unit Admin cannot create, rename, archive or restore units", () => {
  const { state, unitAdmin } = setup(),
    s = new Rbac(state, unitAdmin);
  denied(() => s.saveUnit(undefined, { name: "New" }));
  denied(() => s.saveUnit("hr", { name: "HR2" }));
  denied(() => s.statusUnit("hr", "archived"));
  denied(() => s.statusUnit("legal", "active"));
});
test("Unit names are unique across case, spacing, normalization and archives", () => {
  const { state, admin } = setup(),
    s = new Rbac(state, admin);
  denied(() => s.saveUnit(undefined, { name: " hr " }), 409);
  s.statusUnit("hr", "archived");
  denied(() => s.saveUnit(undefined, { name: "ＨＲ" }), 409);
  s.saveUnit("hr", { name: "People" });
  assert.equal(state.assignments[0].unitId, "hr");
});
test("Archive blocks access and hides unit from users; restore reactivates retained assignments", () => {
  const { state, admin, user } = setup();
  new Rbac(state, admin).statusUnit("hr", "archived");
  assert.equal(new Rbac(state, user).snapshot().units.length, 0);
  denied(() => new Rbac(state, user).unitRole("hr"));
  new Rbac(state, admin).statusUnit("hr", "active");
  assert.equal(new Rbac(state, user).unitRole("hr"), "unit-user");
});
test("Unit Admin adds/removes regular users only in own unit and cannot demote admins", () => {
  const { state, unitAdmin, user } = setup(),
    s = new Rbac(state, unitAdmin);
  denied(() => s.assign(user, "legal", "unit-user"));
  denied(() => s.assign(user, "hr", "unit-admin"));
  denied(() => s.assign(unitAdmin, "hr", "unit-user"));
  denied(() => s.assign(person("admin"), "hr", "unit-user"));
  denied(() => s.removeUnitMember("hr", unitAdmin.id));
  s.removeUnitMember("hr", user.id);
  s.assign(user, "hr", "unit-user");
  assert.equal(s.unitRole("hr"), "unit-admin");
});
test("A person can be HR Admin and Legal User, without inheritance or sibling access", () => {
  const { state, admin, unitAdmin } = setup();
  new Rbac(state, admin).assign(unitAdmin, "legal", "unit-user");
  const s = new Rbac(state, unitAdmin);
  assert.equal(s.unitRole("hr"), "unit-admin");
  assert.equal(s.unitRole("legal"), "unit-user");
  denied(() => s.requireUnitAdmin("legal"));
});
test("Removing one unit membership preserves others; organization removal revokes every unit", () => {
  const { state, admin, user } = setup(),
    s = new Rbac(state, admin);
  s.assign(user, "legal", "unit-user");
  s.removeUnitMember("hr", user.id);
  assert.deepEqual(
    new Rbac(state, user).snapshot().units.map((u) => u.id),
    ["legal"],
  );
  s.removeOrganizationMember(user.id);
  denied(() => new Rbac(state, user).snapshot());
  assert.equal(
    state.assignments.filter(
      (m) => m.userId === user.id && m.status === "active",
    ).length,
    0,
  );
});
test("Last Organization Admin cannot be removed or demoted even by super-admin", () => {
  const { state, root, admin, user } = setup(),
    s = new Rbac(state, root);
  denied(() => s.removeOrganizationMember(admin.id), 409);
  denied(() => s.addOrganizationMember(admin, "member"), 409);
  s.addOrganizationMember(user, "organization-admin");
  s.removeOrganizationMember(admin.id);
  assert.equal(
    state.members.find((m) => m.userId === user.id)?.role,
    "organization-admin",
  );
});
test("Country membership without an RBAC membership grants no access; membership only has no units", () => {
  const { state, admin } = setup(),
    p = person("unassigned");
  denied(() => new Rbac(state, p).snapshot());
  new Rbac(state, admin).addOrganizationMember(p, "member");
  assert.equal(new Rbac(state, p).snapshot().units.length, 0);
});
test("Inactive/unverified accounts cannot obtain roles or use their assignments", () => {
  const { state, admin, user } = setup();
  denied(() => new Rbac(state, { ...user, active: false }));
  denied(() => new Rbac(state, { ...user, verified: false }));
  denied(
    () =>
      new Rbac(state, admin).assign(
        { ...user, active: false },
        "legal",
        "unit-user",
      ),
    422,
  );
  denied(
    () =>
      new Rbac(state, admin).assign(
        { ...user, organizationIds: ["de"] },
        "legal",
        "unit-user",
      ),
    422,
  );
});
test("Invitations require recipient identity and current inviter authority; valid acceptance is idempotent", () => {
  const { state, admin, user, unitAdmin } = setup(),
    s = new Rbac(state, admin);
  const link = s.invite(user, "legal", "unit-user");
  denied(() => new Rbac(state, unitAdmin).accept(link.id, link.token, admin));
  assert.equal(
    new Rbac(state, user).accept(link.id, link.token, admin).alreadyAccepted,
    false,
  );
  assert.equal(
    new Rbac(state, user).accept(link.id, link.token, admin).alreadyAccepted,
    true,
  );
  const second = s.invite(user, "hr", "unit-admin");
  state.members.find((m) => m.userId === admin.id)!.status = "removed";
  denied(() => new Rbac(state, user).accept(second.id, second.token, admin));
});
test("Outside accounts join only when they accept; Unit Admins cannot appoint admins", () => {
  const {state,admin,unitAdmin}=setup();
  const outsider={...person("outside"),organizationIds:["de"]};
  const manager=new Rbac(state,unitAdmin);
  denied(()=>manager.invite(outsider,"hr","unit-admin"));
  const link=manager.invite(outsider,"hr","unit-user");
  assert.equal(state.members.some(m=>m.userId===outsider.id),false);
  denied(()=>new Rbac(state,outsider).accept(link.id,"invalid",unitAdmin));
  assert.equal(state.members.some(m=>m.userId===outsider.id),false);
  new Rbac(state,outsider).accept(link.id,link.token,unitAdmin);
  assert.equal(state.members.find(m=>m.userId===outsider.id)?.role,"member");
  assert.equal(state.assignments.find(a=>a.userId===outsider.id)?.role,"unit-user");
  const inactive={...person("inactive"),active:false,organizationIds:[]};
  denied(()=>new Rbac(state,admin).invite(inactive,"hr","unit-user"),422);
});
test("New-email invitations grant only their stored role after verified signup",()=>{
 const {state,admin,user}=setup();
 const email="new-person@example.com";
 const link=new Rbac(state,admin).invite({email},"legal","unit-user");
 assert.equal(state.invitations.find(i=>i.id===link.id)?.recipientId,"");
 denied(()=>new Rbac(state,user).accept(link.id,link.token,admin));
 const signedUp={...person("new-person"),email,organizationIds:[]};
 denied(()=>new Rbac(state,{...signedUp,verified:false}).accept(link.id,link.token,admin));
 new Rbac(state,signedUp).accept(link.id,link.token,admin);
 assert.equal(state.invitations.find(i=>i.id===link.id)?.recipientId,signedUp.id);
 assert.equal(state.assignments.find(a=>a.userId===signedUp.id)?.role,"unit-user");
 denied(()=>new Rbac(state,{...signedUp,id:"different"}).accept(link.id,link.token,admin));
});
test("Super Admin organization invitations grant the selected organization role without unit assignments",()=>{
 for(const role of ["member","organization-admin"] as const){
  const {state,root,unitAdmin,admin}=setup();
  const recipient={...person(`org-${role}`),organizationIds:[]};
  denied(()=>new Rbac(state,unitAdmin).inviteOrganization(recipient,role));
  denied(()=>new Rbac(state,admin).inviteOrganization(recipient,role));
  const link=new Rbac(state,root).inviteOrganization({email:recipient.email},role);
  denied(()=>new Rbac(state,recipient).accept(link.id,link.token,{...root,superAdmin:false}));
  new Rbac(state,recipient).accept(link.id,link.token,root);
  assert.equal(state.members.find(m=>m.userId===recipient.id)?.role,role);
  assert.equal(state.assignments.some(a=>a.userId===recipient.id),false);
  const joined=new Rbac(state,{...recipient,organizationIds:["bd"]}).snapshot();
  assert.equal(joined.organizationAdmin,role==="organization-admin");
  assert.equal(joined.units.length,role==="organization-admin"?2:0);
  assert.equal(joined.canManageOrganization,role==="organization-admin");
 }
});
test("Company owners administer and invite only within their own organization",()=>{
 const {state,admin,unitAdmin,user}=setup();state.ownerId=admin.id;
 const owner=new Rbac(state,admin);
 assert.equal(owner.snapshot().companyOwner,true);assert.equal(owner.snapshot().superAdmin,false);
 const link=owner.inviteOrganization(user,"organization-admin");
 new Rbac(state,user).accept(link.id,link.token,admin);
 assert.equal(state.members.find(m=>m.userId===user.id)?.role,"organization-admin");
 denied(()=>owner.addOrganizationMember(admin,"member"),409);
 denied(()=>owner.removeOrganizationMember(admin.id),409);
 denied(()=>new Rbac(state,unitAdmin).inviteOrganization(user,"member"));
 const unrelated=emptyState({id:"de",name:"Other company",status:"active"});
 denied(()=>new Rbac(unrelated,admin).inviteOrganization(user,"member"));
});
test("Organization Admin manages all units and unit roles but cannot run the company",()=>{
 const {state,admin:owner,user:admin,unitAdmin,user}=setup();state.ownerId=owner.id;
 const ownerService=new Rbac(state,owner);
 ownerService.addOrganizationMember(admin,"organization-admin");
 const service=new Rbac(state,admin);
 assert.equal(service.snapshot().effectiveRole,"organization-admin");
 assert.equal(ownerService.snapshot().effectiveRole,"organization-owner");
 assert.equal(ownerService.snapshot().units.find(u=>u.id==="hr")?.role,"organization-owner");
 assert.equal(service.snapshot().canManageOrganization,false);
 assert.deepEqual(service.snapshot().units.map(u=>u.id).sort(),["hr","legal"]);
 service.saveUnit("hr",{name:"People"});
 service.saveUnit("legal",{name:"Counsel"});
 service.assign(user,"legal","unit-admin");
 service.invite({email:"member@demo.local"},"legal","unit-user");
 denied(()=>service.settings({name:"Hijack",layerLabel:"Teams"}));
 denied(()=>service.addOrganizationMember(unitAdmin,"organization-admin"));
 denied(()=>service.removeOrganizationMember(unitAdmin.id));
 denied(()=>service.inviteOrganization(unitAdmin,"organization-admin"));
 const created=service.saveUnit(undefined,{name:"Admin-created unit"});
 assert.equal(service.canManageUnit(created.id),true);
});
test("Organization-admin invitations grant company-wide unit management after verified signup",()=>{
 const {state,admin:owner}=setup();state.ownerId=owner.id;
 const service=new Rbac(state,owner),recipient={...person("invited-admin"),organizationIds:[]};
 const invitation=service.inviteOrganization({email:recipient.email},"organization-admin");
 new Rbac(state,recipient).accept(invitation.id,invitation.token,owner);
 const joined=new Rbac(state,{...recipient,organizationIds:["bd"]});
 assert.deepEqual(joined.snapshot().units.map(u=>u.id).sort(),["hr","legal"]);
 assert.equal(joined.canManageUnit("hr"),true);
 assert.equal(joined.snapshot().canManageOrganization,false);
});
test("Invitation scope forbids role tampering and organization revocation by Unit Admin",()=>{
 const {state,root,unitAdmin,user,admin}=setup();
 denied(()=>new Rbac(state,root).inviteOrganization(user,"unit-admin"),422);
 denied(()=>new Rbac(state,root).invite(user,"hr","organization-admin"),422);
 const link=new Rbac(state,root).inviteOrganization(user,"member");
 denied(()=>new Rbac(state,unitAdmin).revokeInvitation(link.id));
 new Rbac(state,root).revokeInvitation(link.id);
 denied(()=>new Rbac(state,user).accept(link.id,link.token,root),410);
 const demotion=new Rbac(state,root).inviteOrganization(admin,"member");
 denied(()=>new Rbac(state,admin).accept(demotion.id,demotion.token,root),409);
});
test("Expired and revoked invitations cannot be accepted; hashes are never returned in snapshots", () => {
  for (const action of ["expire", "revoke"]) {
    const { state, admin, user } = setup(),
      s = new Rbac(state, admin),
      link = s.invite(user, "legal", "unit-user");
    if (action === "expire")
      state.invitations[0].expiresAt = new Date(0).toISOString();
    else s.revokeInvitation(link.id);
    denied(() => new Rbac(state, user).accept(link.id, link.token, admin), 410);
    assert.equal("tokenHash" in s.snapshot().invitations[0], false);
  }
});
test("CAS rejects concurrent demotions that would otherwise remove all admins", async () => {
  const { state, admin, user } = setup(),
    repo = new MockStateRepository();
  new Rbac(state, admin).addOrganizationMember(user, "organization-admin");
  await repo.commit(state, undefined);
  const a = (await repo.load("bd"))!,
    b = (await repo.load("bd"))!;
  new Rbac(a.state, admin).removeOrganizationMember(user.id);
  new Rbac(b.state, user).removeOrganizationMember(admin.id);
  await repo.commit(a.state, a);
  await assert.rejects(() => repo.commit(b.state, b), /Organization changed/);
  assert.equal(
    (await repo.load("bd"))!.state.members.filter(
      (m) => m.role === "organization-admin" && m.status === "active",
    ).length,
    1,
  );
});
test("CAS rejects concurrent duplicate unit creates; audit and changes commit together", async () => {
  const { state, admin } = setup(),
    repo = new MockStateRepository();
  await repo.commit(state, undefined);
  const a = (await repo.load("bd"))!,
    b = (await repo.load("bd"))!;
  new Rbac(a.state, admin).saveUnit(undefined, { name: "Finance" });
  new Rbac(b.state, admin).saveUnit(undefined, { name: "Finance" });
  await repo.commit(a.state, a);
  await assert.rejects(() => repo.commit(b.state, b), /Organization changed/);
  const saved = (await repo.load("bd"))!;
  assert.equal(saved.state.units.filter((u) => u.name === "Finance").length, 1);
  assert.equal(saved.state.events.length, 1);
});
test("Legacy import makes independent units without inheriting old memberships", () => {
  const state = legacyImport(
    { id: "bd", name: "Bangladesh", status: "active" },
    [{ id: "hr", name: "HR", status: "active" }],
    [{ id: "payroll", name: "Payroll", status: "active", departmentId: "hr" }],
  );
  assert.deepEqual(
    state.units.map((u) => u.name),
    ["HR", "HR / Payroll"],
  );
  assert.equal(state.assignments.length, 0);
  assert.equal(state.members.length, 0);
});

test("Removing organization access revokes pending invitations and rejoining does not resurrect them", () => {
  const { state, admin, user } = setup(),
    s = new Rbac(state, admin),
    link = s.invite(user, "legal", "unit-user");
  s.removeOrganizationMember(user.id);
  s.addOrganizationMember(user, "member");
  denied(() => new Rbac(state, user).accept(link.id, link.token, admin), 410);
  assert.equal(new Rbac(state, user).snapshot().units.length, 0);
});
test("Invitation is bound to the IAM user ID as well as the email", () => {
  const { state, admin, user } = setup(),
    link = new Rbac(state, admin).invite(user, "legal", "unit-user");
  denied(() =>
    new Rbac(state, { ...user, id: "different-account" }).accept(
      link.id,
      link.token,
      admin,
    ),
  );
});

test("Unit Admin cannot revoke an invitation addressed to an Organization Admin", () => {
  const { state, admin, unitAdmin } = setup(),
    s = new Rbac(state, admin),
    link = s.invite(admin, "hr", "unit-user");
  denied(() => new Rbac(state, unitAdmin).revokeInvitation(link.id));
});
