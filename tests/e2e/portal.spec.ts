import { test, expect, type Page } from "@playwright/test";
test('Platform Super Admin can edit native role hierarchy through the Blocks panel',async({page})=>{
 await enter(page);
 const roles=[{id:'root-role',slug:'clouduser',name:'System User',description:null,parentRoleSlug:null,canCreateOwn:true,revision:'system',protected:true},{id:'reviewer',slug:'atlas-reviewer',name:'Reviewer',description:'Keep description',parentRoleSlug:null,canCreateOwn:false,revision:'one',protected:false}];
 await page.route('**/api/config',route=>route.fulfill({json:{mockSelector:false}}));
 await page.route('**/api/rbac/native-roles**',async route=>{
  const request=route.request();
  if(request.method()==='PATCH'){
   const body=request.postDataJSON();expect(body.parentRoleSlug).toBe('clouduser');expect(body.canCreateOwn).toBe(true);expect(body.revision).toBe('one');
   roles[1]={...roles[1],name:body.name,parentRoleSlug:body.parentRoleSlug,canCreateOwn:body.canCreateOwn,revision:'two'};
   await route.fulfill({json:roles[1]});
  }else await route.fulfill({json:{roles,assignable:['atlas-reviewer']}});
 });
 await page.reload();await page.getByRole('button',{name:/Bangladesh.*Open organization/}).click();
 await page.getByRole('button',{name:'Roles & access',exact:true}).click();
 await expect(page.getByRole('table',{name:'Workspace role management'})).toContainText('Assigned unit only');
 await expect(page.getByRole('table',{name:'Blocks role hierarchy'})).toContainText('Protected system role');
 await page.getByRole('button',{name:'Edit hierarchy',exact:true}).click();
 const form=page.getByRole('form',{name:'Blocks role editor'});
 await form.getByLabel('Parent role').selectOption('clouduser');
 await form.getByRole('checkbox').check();await form.getByRole('button',{name:'Save Blocks role',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('saved and read back');
 await expect(page.getByRole('table',{name:'Blocks role hierarchy'}).getByRole('row',{name:/^Reviewer atlas-reviewer/})).toContainText('clouduser');
});
test("Super Admin invites an Organization Admin and acceptance opens the organization workspace",async({page})=>{
 await enter(page);
 await page.getByRole("button",{name:"Members",exact:true}).click();
 await page.getByRole("button",{name:"Invite organization member",exact:true}).click();
 await page.getByRole("textbox",{name:"Recipient email",exact:true}).fill("unassigned@demo.local");
 await page.getByRole("combobox",{name:"Organization role",exact:true}).selectOption("organization-admin");
 await page.getByRole("button",{name:"Create invitation",exact:true}).click();
 const link=await page.getByRole("textbox",{name:"Invitation link",exact:true}).inputValue();
 await expect(page.getByRole("heading",{name:"Organization invitations",exact:true})).toBeVisible();
 await page.getByRole("combobox",{name:"Demo identity",exact:true}).selectOption("unassigned");
 const emailLink=new URL(link);emailLink.pathname='/invite/continue';
 const secret=new URLSearchParams(emailLink.hash.slice(1)).get('token')!;
 const requestUrls:string[]=[];page.on('request',request=>requestUrls.push(request.url()));
 const previewPromise=page.waitForRequest(request=>request.url().includes('/api/auth/invitation-preview'));
 await page.goto(emailLink.href);
 const previewRequest=await previewPromise;
 expect(previewRequest.method()).toBe('POST');expect(previewRequest.postDataJSON().token).toBe(secret);
 await expect(page.getByRole("heading",{name:"Activate your account",exact:true})).toBeVisible();
 await page.getByRole("link",{name:"Continue to accept invitation"}).click();
 await page.getByRole("button",{name:"Accept invitation",exact:true}).click();
 await expect(page.getByRole("button",{name:"Create unit",exact:true})).toBeVisible();
 await expect(page.getByRole("heading",{name:"Legal",exact:true})).toBeVisible();
 const current=await (await page.request.get("/api/rbac/organizations/bd")).json();
 const restored=await page.request.post("/api/rbac/organizations/bd/members",{headers:{origin:"http://127.0.0.1:3100"},data:{userId:"unassigned",role:"member",revision:current.revision}});
 expect(restored.status()).toBe(200);
 expect(requestUrls.every(url=>!url.includes(secret))).toBe(true);
});
test("Unit Admin invites only a Unit Member to their permitted unit",async({page})=>{
 await enter(page,"recruit-admin");await openUnit(page,"HRM");
 await expect(page.getByRole("button",{name:"Invite organization member",exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"Invite member",exact:true}).click();
 const roles=page.getByRole("combobox",{name:"Unit role",exact:true});
 await expect(roles.locator("option")).toHaveCount(1);
 await expect(roles).toHaveValue("unit-user");
 await page.getByRole("textbox",{name:"Recipient email",exact:true}).fill("recruit-member@demo.local");
 await page.getByRole("button",{name:"Create invitation",exact:true}).click();
 const link=await page.getByRole("textbox",{name:"Invitation link",exact:true}).inputValue();
 await page.getByRole("combobox",{name:"Demo identity",exact:true}).selectOption("recruit-member");
 await page.goto(link);
 await expect(page.getByRole("heading",{name:"Activate your account",exact:true})).toBeVisible();
 await page.getByRole("link",{name:"Continue to accept invitation"}).click();
 await page.getByRole("button",{name:"Accept invitation",exact:true}).click();
 await expect(page.getByRole("heading",{name:"HRM",exact:true})).toBeVisible();
 await expect(page.getByRole("heading",{name:"Legal",exact:true})).toHaveCount(0);
 await expect(page.getByRole("button",{name:"Create unit",exact:true})).toHaveCount(0);
});
async function enter(page: Page, id = "super") {
  await page.goto("/");
  await page.locator("#login-user").selectOption(id);
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Organizations", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Bangladesh.*Open organization/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Units", exact: true }),
  ).toBeVisible();
}
async function openUnit(page: Page, name: string) {
  await page
    .locator(".rbac-unit-card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .getByRole("button", { name: /Open unit/ })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}
test("super-admin sees organizations and a single unit layer; legacy controls are retired", async ({
  page,
}) => {
  await enter(page);
  await expect(
    page.getByRole("heading", { name: "HRM", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Legal", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recruitment", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Resources", exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get("/api/countries/bd/workspace")).status()).toBe(
    410,
  );
  await page
    .getByRole("button", { name: "Organizations", exact: true })
    .click();
  for (const country of ["Bangladesh", "Germany", "Nepal"])
    await expect(
      page.getByRole("heading", { name: country, exact: true }),
    ).toBeVisible();
});
test("Organization Admin creates unique units, renames label and restores archived units", async ({
  page,
}) => {
  await enter(page, "hr-admin");
  await page.getByRole("button", { name: "Create unit", exact: true }).click();
  const name = "Finance";
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: `Archive ${name}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(
    page
      .locator(".rbac-unit-card")
      .filter({ has: page.getByRole("heading", { name, exact: true }) }),
  ).toContainText("Archived");
  await page
    .getByRole("button", { name: `Restore ${name}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(
    page
      .locator(".rbac-unit-card")
      .filter({ has: page.getByRole("heading", { name, exact: true }) }),
  ).toContainText("Active");
  await page.getByRole("button", { name: "Create unit", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(" hrm ");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).toContainText("already exists");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Layer label", exact: true })
    .fill("Teams");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Teams", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Layer label", exact: true })
    .fill("Units");
  await page.getByRole("button", { name: "Save changes" }).click();
});
test("Unit Admin manages regular users in own unit and cannot appoint admins", async ({
  page,
}) => {
  await enter(page, "recruit-admin");
  await expect(
    page.getByRole("heading", { name: "Legal", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Create unit", exact: true }),
  ).toHaveCount(0);
  await openUnit(page, "HRM");
  await page
    .getByRole("button", { name: "Add unit member", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Person", exact: true })
    .selectOption("unassigned");
  await expect(
    page
      .getByRole("combobox", { name: "Unit role", exact: true })
      .getByRole("option", { name: "Unit Admin", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("table", { name: "Unit members" })).toContainText(
    "Sam Taylor",
  );
  const snapshot = await (
    await page.request.get("/api/rbac/organizations/bd")
  ).json();
  const escalation = await page.request.post(
    "/api/rbac/organizations/bd/units/hrm/members",
    {
      headers: { origin: "http://127.0.0.1:3100" },
      data: {
        userId: "unassigned",
        role: "unit-admin",
        revision: snapshot.revision,
      },
    },
  );
  expect(escalation.status()).toBe(403);
});
test("Unit Member sees assigned units only and backend denies changed unit IDs", async ({
  page,
}) => {
  await enter(page, "recruit-member");
  await expect(
    page.getByRole("heading", { name: "Legal", exact: true }),
  ).toHaveCount(0);
  await openUnit(page, "HRM");
  await expect(
    page.getByRole("button", { name: "Add unit member", exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await page.request.get("/api/rbac/organizations/bd/access?unitId=legal")
    ).status(),
  ).toBe(403);
  expect((await page.request.get("/api/rbac/organizations/de")).status()).toBe(
    403,
  );
});
test("last Organization Admin cannot be demoted through the UI", async ({
  page,
}) => {
  await enter(page);
  await page.getByRole("button", { name: "Members", exact: true }).click();
  const row = page
    .getByRole("table", { name: "Organization members" })
    .getByRole("row")
    .filter({ hasText: "hr-admin@demo.local" });
  await row.getByRole("button", { name: "Change role", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Organization role", exact: true })
    .selectOption("member");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Keep at least one active Organization Admin",
  );
});
test("unit invitation acceptance checks the recipient and grants independent access", async ({
  page,
}) => {
  await enter(page);
  await openUnit(page, "Legal");
  await page
    .getByRole("button", { name: "Invite member", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Recipient email", exact: true })
    .fill("germany-admin@demo.local");
  await page.getByRole("combobox", { name: "Unit role", exact: true }).selectOption("unit-user");
  await page.getByRole("button", { name: "Create invitation", exact: true }).click();
  const link = await page
    .getByRole("textbox", { name: "Invitation link", exact: true })
    .inputValue();
  await page
    .getByRole("combobox", { name: "Demo identity", exact: true })
    .selectOption("germany-admin");
  await page.goto(link);
  await page.getByRole('link',{name:'Continue to accept invitation',exact:true}).click();
  await page
    .getByRole("button", { name: "Accept invitation", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Invitation accepted");
  await expect(
    page.getByRole("heading", { name: "Legal", exact: true }),
  ).toBeVisible();
});
test("super-admin creates an organization and appoints its first admin explicitly", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#login-user").selectOption("super");
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await page
    .getByRole("button", { name: "Create organization", exact: true })
    .click();
  const name = `Organization ${Date.now()}`;
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Save changes" }).click();
  await page
    .getByRole("button", { name: new RegExp(`${name}.*Open organization`) })
    .click();
  await page
    .getByRole("button", { name: "Initialize organization", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Organization Admin", exact: true })
    .selectOption("super");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Units", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Create your first unit", exact: true }),
  ).toBeVisible();
});
test("RBAC workspace fits desktop and mobile and exposes owner and scoped business roles", async ({
  page,
}) => {
  await enter(page);
  await page.screenshot({ path: "docs/rbac-desktop.png", fullPage: true });
  await page
    .getByRole("button", { name: "Roles & access", exact: true })
    .click();
  for (const name of ["Organization Owner", "Organization Admin", "Unit Admin", "Unit Member"])
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Units", exact: true }).click();
  await page.screenshot({ path: "docs/rbac-mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test('Organization Owner invites an Organization Admin who can manage all units',async({page})=>{
 await page.goto('/');await page.locator('#login-user').selectOption('recruit-member');
 await page.getByRole('button',{name:'Enter workspace',exact:true}).click();
 await page.getByRole('button',{name:'Create company',exact:true}).click();
 await page.getByRole('textbox',{name:'Name',exact:true}).fill('Ops company');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Organization Owner');
 for(const name of ['Team Alpha','Team Beta']){
  await page.getByRole('button',{name:'Create unit',exact:true}).click();
  await page.getByRole('textbox',{name:'Name',exact:true}).fill(name);
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
 }
 await page.getByRole('button',{name:'Members',exact:true}).click();
 await page.getByRole('button',{name:'Invite organization member',exact:true}).click();
 await page.getByRole('textbox',{name:'Recipient email',exact:true}).fill('germany-admin@demo.local');
 await page.getByRole('combobox',{name:'Organization role',exact:true}).selectOption('organization-admin');
 await page.getByRole('button',{name:'Create invitation',exact:true}).click();
 const link=await page.getByRole('textbox',{name:'Invitation link',exact:true}).inputValue();
 await page.getByRole('combobox',{name:'Demo identity',exact:true}).selectOption('germany-admin');
 await page.goto(link);await page.getByRole('link',{name:'Continue to accept invitation',exact:true}).click();await page.getByRole('button',{name:'Accept invitation',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Team Alpha',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Team Beta',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Settings',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Create unit',exact:true}).click();
 await page.getByRole('textbox',{name:'Name',exact:true}).fill('Admin created team');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Admin created team',exact:true})).toBeVisible();
 await openUnit(page,'Team Alpha');
 await expect(page.getByRole('button',{name:'Invite member',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Add unit member',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'Unit role',exact:true})).toBeVisible();
 await expect(page.getByRole('combobox',{name:'Person',exact:true}).locator('option',{hasText:'Nadia Islam'})).toHaveCount(1);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Members',exact:true}).click();
 await expect(page.getByRole('button',{name:'Invite organization member',exact:true})).toHaveCount(0);
});
test("A verified ordinary account creates its company and becomes only that company's owner",async({page})=>{
 await page.goto("/");await page.locator("#login-user").selectOption("recruit-member");
 await page.getByRole("button",{name:"Enter workspace",exact:true}).click();
 await page.getByRole("button",{name:"Create company",exact:true}).click();
 await page.getByRole("textbox",{name:"Name",exact:true}).fill("Avery Company");
 await page.getByRole("button",{name:"Save changes",exact:true}).click();
 await expect(page.getByRole("status")).toContainText("Organization Owner");
 await expect(page.getByRole("button",{name:"Create unit",exact:true})).toBeVisible();
 await expect(page.getByText("Organization Owner",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Organizations",exact:true}).click();
 const company=page.getByRole("button",{name:/Avery Company.*Open organization/});
 await expect(company).toBeVisible();
 await page.reload();
 await expect(company).toBeVisible();
 await company.click();
 await expect(page.getByRole("button",{name:"Create unit",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Members",exact:true}).click();
 await expect(page.getByRole("button",{name:"Invite organization member",exact:true})).toBeVisible();
 const created=await (await page.request.get("/api/rbac/organizations")).json();
 expect(created.actor.superAdmin).toBe(false);
 expect(created.organizations.some((o:{id:string})=>o.id==="de")).toBe(false);
 expect((await page.request.get("/api/rbac/organizations/de")).status()).toBe(403);
 await page.getByRole("button",{name:"Organizations",exact:true}).click();
 await expect(company).toBeVisible();
});
