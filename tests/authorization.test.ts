import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../src/lib/store";
import { seed } from "../src/lib/seed";
import { Application } from "../src/lib/service";
import { createHandler } from "../src/lib/http";
import { AppError } from "../src/lib/model";
const setup = () => {
  const store = new MemoryStore();
  seed(store);
  return { store, app: new Application(store) };
};
const denied = (fn: () => unknown, status = 403) =>
  assert.throws(
    fn,
    (e: unknown) => e instanceof AppError && e.status === status,
  );

test("super-admin sees all countries and manages every scope", () => {
  const { app } = setup(),
    u = app.auth.identity("super");
  assert.equal(app.snapshot(u, "bd").resources.length, 2);
  assert.equal(app.snapshot(u, "de").resources.length, 1);
  const d = app.hierarchySave(u, "np", "department", undefined, {
    name: "Finance",
  });
  assert.equal(d.countryOrganizationId, "np");
});
test("department admin creates descendant groups but cannot access siblings or Germany", () => {
  const { app } = setup(),
    u = app.auth.identity("hr-admin");
  const g = app.hierarchySave(u, "bd", "group", undefined, {
    name: "Benefits",
    departmentId: "hrm",
  });
  assert.ok(g.id);
  assert.deepEqual(
    app.snapshot(u, "bd").departments.map((d) => d.id),
    ["hrm"],
  );
  denied(() =>
    app.hierarchySave(u, "bd", "group", undefined, {
      name: "Intruder",
      departmentId: "legal",
    }),
  );
  denied(() => app.snapshot(u, "de"));
});
test("group admin cannot read or manage a sibling group", () => {
  const { app } = setup(),
    u = app.auth.identity("recruit-admin");
  assert.deepEqual(
    app.snapshot(u, "bd").groups.map((g) => g.id),
    ["recruitment"],
  );
  assert.equal(app.snapshot(u, "bd").departments.length, 0);
  denied(() => app.archive(u, "bd", "group", "payroll"));
  denied(() =>
    app.auth.require(
      u,
      "resource.view",
      app.scopeForResource("r-payroll", "bd").scope,
    ),
  );
});
test("member sees only Recruitment and cannot write resources", () => {
  const { app } = setup(),
    u = app.auth.identity("recruit-member");
  assert.deepEqual(
    app.snapshot(u, "bd").resources.map((r) => r.id),
    ["r-recruit"],
  );
  denied(() =>
    app.resourceSave(u, "bd", "r-recruit", { title: "Changed", content: "No" }),
  );
});
test("country membership and account activation alone grant no scope access", () => {
  const { app } = setup(),
    u = app.auth.identity("unassigned");
  assert.equal(app.snapshot(u, "bd").resources.length, 0);
  assert.equal(app.snapshot(u, "bd").groups.length, 0);
  denied(() =>
    app.auth.require(u, "group.view", {
      countryId: "bd",
      type: "group",
      id: "recruitment",
    }),
  );
});
test("delegation blocks privilege escalation and shared role changes", () => {
  const { app } = setup(),
    u = app.auth.identity("recruit-admin");
  denied(() =>
    app.invite(u, "bd", {
      scopeType: "group",
      scopeId: "recruitment",
      roleId: "bd-dept",
      email: "unassigned@demo.local",
    }),
  );
  denied(() =>
    app.roleSave(u, "bd", undefined, {
      scopeType: "group",
      scopeId: "recruitment",
      name: "Escalation",
      permissions: ["member.assign-role"],
      delegablePermissions: [],
    }),
  );
  denied(() => app.grantSuper(u, "unassigned"));
  denied(() =>
    app.roleSave(u, "bd", "bd-member", {
      scopeType: "group",
      scopeId: "recruitment",
      name: "Escalation",
      permissions: ["group.view"],
      delegablePermissions: [],
    }),
  );
});
test("invitation acceptance verifies recipient, assigns exact scope, and is idempotent", () => {
  const { app, store } = setup();
  const i = app.invite(app.auth.identity("hr-admin"), "bd", {
    scopeType: "group",
    scopeId: "recruitment",
    roleId: "bd-member",
    email: "unassigned@demo.local",
  });
  denied(() => app.accept(app.auth.identity("payroll-member"), i.id));
  const recipient = app.auth.identity("unassigned");
  assert.equal(app.accept(recipient, i.id).scopeId, "recruitment");
  assert.equal(app.accept(recipient, i.id).alreadyAccepted, true);
  assert.equal(
    store.all("memberships").filter((m) => m.userId === "unassigned").length,
    1,
  );
  assert.deepEqual(
    app
      .snapshot(app.auth.identity("unassigned"), "bd")
      .resources.map((r) => r.id),
    ["r-recruit"],
  );
});
test("expired and revoked invitations grant no membership", () => {
  for (const status of ["expired", "revoked"] as const) {
    const { app, store } = setup();
    const i = app.invite(app.auth.identity("super"), "bd", {
      scopeType: "group",
      scopeId: "recruitment",
      roleId: "bd-member",
      email: "unassigned@demo.local",
    });
    if (status === "expired")
      store.put("invitations", { ...i, expiresAt: new Date(0).toISOString() });
    else app.revoke(app.auth.identity("super"), "bd", i.id);
    denied(() => app.accept(app.auth.identity("unassigned"), i.id), 410);
    assert.equal(
      store.all("memberships").filter((m) => m.userId === "unassigned").length,
      0,
    );
  }
});
test("acceptance rechecks inviter authority and current role delegation", () => {
  const { app } = setup();
  const i = app.invite(app.auth.identity("hr-admin"), "bd", {
    scopeType: "group",
    scopeId: "recruitment",
    roleId: "bd-member",
    email: "unassigned@demo.local",
  });
  app.membershipChange(
    app.auth.identity("super"),
    "bd",
    "m-hr-admin",
    {},
    true,
  );
  denied(() => app.accept(app.auth.identity("unassigned"), i.id));
});
test("archived parents block descendants and invitation acceptance", () => {
  const { app } = setup();
  const i = app.invite(app.auth.identity("super"), "bd", {
    scopeType: "group",
    scopeId: "recruitment",
    roleId: "bd-member",
    email: "unassigned@demo.local",
  });
  app.archive(app.auth.identity("super"), "bd", "department", "hrm");
  denied(() =>
    app.auth.require(app.auth.identity("recruit-member"), "resource.view", {
      countryId: "bd",
      type: "group",
      id: "recruitment",
    }),
  );
  assert.equal(
    app.snapshot(app.auth.identity("super"), "bd").resources.length,
    0,
  );
  denied(() => app.accept(app.auth.identity("unassigned"), i.id));
});
test("membership removal takes effect immediately and preserves country/other scope access", () => {
  const { app, store } = setup();
  const u = app.auth.identity("recruit-member");
  store.put("memberships", {
    id: "extra",
    userId: u.id,
    countryOrganizationId: "bd",
    scopeType: "group",
    scopeId: "payroll",
    roleId: "bd-member",
    status: "active",
  });
  app.membershipChange(
    app.auth.identity("super"),
    "bd",
    "m-recruit-member",
    {},
    true,
  );
  assert.deepEqual(
    app.snapshot(u, "bd").resources.map((r) => r.id),
    ["r-payroll"],
  );
  assert.deepEqual(store.get("users", u.id)?.countryIds, ["bd"]);
});
test("country mismatch, parent tampering, and unknown permissions are rejected", () => {
  const { app } = setup(),
    u = app.auth.identity("super");
  denied(
    () =>
      app.hierarchySave(u, "de", "group", undefined, {
        name: "Invalid",
        departmentId: "hrm",
      }),
    422,
  );
  denied(
    () =>
      app.roleSave(u, "bd", undefined, {
        scopeType: "group",
        scopeId: "recruitment",
        name: "Invalid",
        permissions: ["iam.superadmin"],
        delegablePermissions: [],
      }),
    422,
  );
  denied(
    () =>
      app.invite(u, "bd", {
        scopeType: "group",
        scopeId: "recruitment",
        roleId: "de-member",
        email: "unassigned@demo.local",
      }),
    422,
  );
});
test("mock unique membership validation prevents duplicate inserts", () => {
  const { store } = setup();
  const m = store.get("memberships", "m-recruit-member")!;
  assert.throws(() => store.put("memberships", { ...m, id: "duplicate" }));
});
test("HTTP endpoints enforce session authentication, changed IDs, filtering before pagination, CSRF and live isolation", async () => {
  const previous = process.env.NODE_ENV,
    mode = process.env.APP_MODE;
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";
  process.env.APP_MODE = "mock";
  try {
    const { app } = setup(),
      handle = createHandler(() => app);
    const request = (
      path: string,
      method = "GET",
      body?: unknown,
      cookie?: string,
      origin = "http://localhost",
    ) =>
      handle(
        new Request(`http://localhost/api/${path}`, {
          method,
          headers: {
            origin,
            ...(cookie ? { cookie } : {}),
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
        }),
      );
    assert.equal(
      (await request("countries/bd/resources/r-recruit")).status,
      401,
    );
    const login = await request("auth/mock", "POST", {
      userId: "recruit-member",
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (
        await request(
          "countries/bd/resources/r-recruit",
          "GET",
          undefined,
          cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "countries/bd/resources/r-payroll",
          "GET",
          undefined,
          cookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          "countries/bd/resources/r-recruit",
          "PATCH",
          { title: "Hack", content: "Hack" },
          cookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (await request("countries/de/workspace", "GET", undefined, cookie))
        .status,
      403,
    );
    const list = await request(
      "countries/bd/resources?page=1&pageSize=1",
      "GET",
      undefined,
      cookie,
    );
    assert.equal((await list.json()).total, 1);
    assert.equal(
      (
        await request(
          "auth/mock",
          "POST",
          { userId: "super" },
          undefined,
          "https://evil.local",
        )
      ).status,
      403,
    );
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    assert.equal((await request("auth/mock", "GET")).status, 404);
    process.env.APP_MODE = "live";
    assert.equal(
      (await request("auth/mock", "POST", { userId: "super" })).status,
      404,
    );
    assert.equal(
      (await request("countries/bd/workspace", "GET", undefined, cookie))
        .status,
      401,
    );
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = previous;
    process.env.APP_MODE = mode;
  }
});

test('in-memory transaction rollback and defensive reads preserve mock authorization state',()=>{const {store}=setup();const before=store.all('memberships');assert.throws(()=>store.transaction(()=>{store.remove('memberships','m-recruit-member');throw new Error('rollback')}));assert.deepEqual(store.all('memberships'),before);const row=store.get('memberships','m-recruit-member')!;row.status='archived';assert.equal(store.get('memberships',row.id)?.status,'active');});

test("country user directory includes unassigned users only for super-admin and does not leak other countries",()=>{const {app}=setup();const root=app.auth.identity('super');const bd=app.snapshot(root,'bd');assert(bd.users.some(u=>u.id==='unassigned'));assert(!bd.users.some(u=>u.id==='germany-admin'));assert(bd.users.find(u=>u.id==='super')?.applicationAdmin);const member=app.snapshot(app.auth.identity('recruit-member'),'bd');assert(!member.users.some(u=>u.id==='unassigned'));assert(!member.users.some(u=>u.id==='payroll-member'));});

test("super-admin adds country members without implicit internal access", () => {
  const {app,store}=setup(), actor=app.auth.identity("super");
  const target={id:"new-member",name:"New member",email:"new@example.com",verified:true,projectId:actor.projectId,countryIds:[]};
  app.addUser(actor,"bd",target,{level:"country"});
  const member=store.get("users",target.id)!;
  assert.deepEqual(member.countryIds,["bd"]);
  assert.equal(app.snapshot(member,"bd").departments.length,0);
  assert.equal(store.all("memberships").filter(m=>m.userId===target.id).length,0);
});
test("super-admin adds and updates one scoped membership; rejects invalid targets before writes",()=>{
  const {app,store}=setup(),actor=app.auth.identity("super");
  const target={id:"new-member",name:"New member",email:"new@example.com",verified:true,projectId:actor.projectId,countryIds:[]};
  const role=store.all("roles").find(r=>r.countryOrganizationId==="bd")!;
  const body={level:"department",scopeId:"hrm",roleId:role.id};
  app.addUser(actor,"bd",target,body);app.addUser(actor,"bd",target,body);
  assert.equal(store.all("memberships").filter(m=>m.userId===target.id).length,1);
  denied(()=>app.validateUserAddition(app.auth.identity("hr-admin"),"bd",body));
  denied(()=>app.validateUserAddition(actor,"de",body),422);
  denied(()=>app.addUser(actor,"bd",{...target,verified:false},body),422);
});
