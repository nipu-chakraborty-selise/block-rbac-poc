import {createCompanyOrganization} from './create-company';
import { randomUUID } from "node:crypto";
import {listNativeRoles,saveNativeRole} from './native-roles';
import { sendInvitationMail } from "./invitation-mail";
import { rbacContext } from "./context";
import { Rbac } from "./service";
import { emptyState } from "./model";
import { legacyImport } from "./repository";
import { AppError } from "../model";
import { mode } from "../adapters";
import { backendClient } from "../blocks-runtime";
import { liveRepository } from "../live-workspace";
import { alreadyOrganizationMember, provisionUser } from "../live-users";
import { application } from "../http";
const fixedRoles = ["organization-owner", "organization-admin", "unit-admin", "unit-user"];
export async function rbacHandler(req: Request): Promise<Response> {
  const url = new URL(req.url),
    path = url.pathname
      .replace(/^\/api\/rbac\/?/, "")
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent),
    method = req.method;
  let refreshedCookie: string | undefined;
  const json = (data: unknown, status = 200) =>
    Response.json(data, {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(refreshedCookie ? { "Set-Cookie": refreshedCookie } : {}),
      },
    });
  try {
    if (method !== "GET") {
      const expected =
        mode() === "live"
          ? process.env["APP_ORIGIN"]
          : `${url.protocol}//${req.headers.get("host") || url.host}`;
      if (req.headers.get("origin") !== expected)
        throw new AppError(403, "Same-origin request required.");
    }
    let body: Record<string, unknown> = {};
    if (method === "POST" || method === "PATCH") {
      const raw = await req.text();
      if (raw.length > 32000) throw new AppError(413, "Request is too large.");
      try {
        body = raw ? JSON.parse(raw) : {};
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new Error();
      } catch {
        throw new AppError(400, "Invalid JSON body.");
      }
    }
    const ctx = await rbacContext(req);
    refreshedCookie = ctx.cookie;
    if (!ctx.actor.active || !ctx.actor.verified)
      throw new AppError(403, "An active, verified account is required.");
    if (!path.length && method === "GET")
      return json({ actor: ctx.actor, roles: fixedRoles });
    if(path[0]==='native-roles'){
      if(!ctx.actor.superAdmin)throw new AppError(403,'Platform Super Admin required for tenant-wide Blocks role management.');
      if(mode()==='mock')throw new AppError(503,'Native Blocks roles require live mode. Mock workspace roles are shown below.');
      try{
        if(path.length===1&&method==='GET'){
          const roles=await listNativeRoles();let assignable:unknown;
          try{assignable=await ctx.assignableRoles();}catch{assignable={unavailable:true};}
          return json({roles,assignable});
        }
        if(path.length===1&&method==='POST')return json(await saveNativeRole(body),201);
        if(path.length===2&&method==='PATCH')return json(await saveNativeRole(body,path[1]));
      }catch(e){if(e instanceof AppError)throw e;throw new AppError(503,'Blocks role management is unavailable. The backend requires View Roles and Manage Roles permissions; the caller also needs IAM access to assignable roles. No fallback was used.');}
      throw new AppError(404,'Endpoint not found.');
    }
    if (path[0] !== "organizations")
      throw new AppError(404, "Endpoint not found.");
    if (!path[1]) {
      if (method === "GET") {
        const visible = [];
        for (const org of ctx.organizations.filter((o) => o.status === "active")) {
          if (ctx.actor.superAdmin) {
            const state = ctx.ready
              ? await ctx.repository.load(org.id)
              : undefined;
            visible.push({
              ...org,
              name: state?.state.displayName || org.name,
            });
            continue;
          }
          const saved = await ctx.repository.load(org.id);
          const member = saved?.state.members.find(
            (m) => m.userId === ctx.actor.id && m.status === "active",
          );
          // Owners always see their company; IAM membership can lag right after create.
          if (
            member &&
            (ctx.actor.organizationIds.includes(org.id) ||
              saved?.state.ownerId === ctx.actor.id)
          )
            visible.push({ ...org, name: saved!.state.displayName });
        }
        return json({ actor: ctx.actor, organizations: visible });
      }
      if (method === "POST") {
        // Any verified account may create its own company; platform authority is never granted.
        // Blocks allows duplicate organization names — always create a new IAM org for this user.
        const initializeCompany=async(id:string,name:string)=>{
          await ctx.joinOrganization(id);
          const state=emptyState({id,name,status:"active"});
          state.ownerId=ctx.actor.id;
          const creator={...ctx.actor,organizationIds:[...new Set([...ctx.actor.organizationIds,id])]};
          // Bootstrap authority belongs solely to the creating identity in this new state.
          state.members.push({userId:creator.id,role:"organization-admin",status:"active"});
          new Rbac(state,creator).event("company.created",id);
          await ctx.repository.commit(state,undefined);
        };
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name || name.length > 120)
          throw new AppError(
            422,
            "Enter an organization name of 1–120 characters.",
          );
        if (mode() === "mock") {
          const id = randomUUID();
          application().store.put("countries", {
            id,
            name,
            code: name.slice(0, 2).toUpperCase(),
            status: "active",
          });
          const creator = application().store.get("users", ctx.actor.id)!;
          application().store.put("users", {
            ...creator,
            countryIds: [...new Set([...creator.countryIds, id])],
          });
          if(!ctx.actor.superAdmin)await initializeCompany(id,name);
          return json({ id,name,initialized:!ctx.actor.superAdmin,companyOwner:!ctx.actor.superAdmin }, 201);
        }
        const orgId=await createCompanyOrganization(backendClient().iam.organizations,name);
        try {
          await liveRepository().create("countryMetadata", {
            id: orgId,
            countryOrganizationId: orgId,
            countryCode: name.slice(0, 2).toUpperCase(),
            displayName: name,
            status: "active",
          });
        } catch {
          throw new AppError(
            503,
            "IAM organization created; app metadata save failed. Record its IAM ID and reconcile metadata before retrying.",
          );
        }
        if(!ctx.actor.superAdmin){
          try{await initializeCompany(orgId,name);}
          catch{throw new AppError(503,`Company ${orgId} was created, but owner setup did not finish. Contact the platform administrator with this ID before retrying creation.`);}
        }
        return json({ id: orgId,name,initialized:!ctx.actor.superAdmin,companyOwner:!ctx.actor.superAdmin }, 201);
      }
    }
    const org = ctx.organizations.find(
      (o) => o.id === path[1] && o.status === "active",
    );
    if (!org) throw new AppError(403, "Organization is unavailable.");
    const accepting=path.length===5 && path[2]==="invitations" && !!path[3] && path[4]==="accept" && method==="POST";
    let saved = await ctx.repository.load(org.id);
    if (
      !accepting &&
      !ctx.actor.superAdmin &&
      !ctx.actor.organizationIds.includes(org.id) &&
      saved?.state.ownerId !== ctx.actor.id
    )
      throw new AppError(403, "No IAM membership in this organization.");
    if (path[2] === "directory" && method === "GET" && ctx.actor.superAdmin)
      return json({ users: await ctx.directory(org.id) });
    if (path[2] === "initialize" && method === "POST") {
      if (!ctx.actor.superAdmin)
        throw new AppError(403, "Application super-admin required.");
      if (saved)
        throw new AppError(409, "Organization is already initialized.");
      const people = await ctx.directory(org.id);
      let admin = people.find(
        (u) => u.id === body.adminId && u.active && u.verified,
      );
      if (!admin && typeof body.adminEmail === "string" && mode() === "live") {
        const user = await provisionUser(org.id, {
          ...body,
          email: body.adminEmail,
        });
        admin = {
          id: user.id,
          name: user.name,
          email: user.email,
          active: true,
          verified: user.verified,
          organizationIds: [org.id],
          superAdmin: false,
        };
      }
      if (!admin)
        throw new AppError(
          422,
          "Choose an active, verified IAM member as the first Organization Admin.",
        );
      const legacy =
        body.importLegacy === true ? await ctx.legacy(org.id) : undefined;
      const state = legacy
          ? legacyImport(org, legacy.departments, legacy.groups)
          : emptyState(org),
        service = new Rbac(state, ctx.actor);
      const names = state.units.map((u) =>
        u.name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(),
      );
      if (new Set(names).size !== names.length)
        throw new AppError(
          409,
          "Imported units have duplicate names. Resolve them in Blocks before importing.",
        );
      if (state.units.length > 300)
        throw new AppError(409, "Too many units to import in this release.");
      service.addOrganizationMember(admin, "organization-admin");
      service.event("organization.initialized", org.id);
      await ctx.repository.commit(state, undefined);
      saved = await ctx.repository.load(org.id);
      return json({ initialized: true, revision: saved?.revision }, 201);
    }
    if (
      path[2] === "import-preview" &&
      method === "GET" &&
      ctx.actor.superAdmin
    ) {
      const legacy = await ctx.legacy(org.id);
      return json({
        units: legacyImport(org, legacy.departments, legacy.groups).units,
      });
    }
    if (!saved) {
      if (method !== "GET")
        throw new AppError(
          409,
          "Initialize this organization with an Organization Admin first.",
        );
      return json({
        organization: org,
        initialized: false,
        canInitialize: ctx.actor.superAdmin,
      });
    }
    const service = new Rbac(saved.state, ctx.actor);
    if(accepting) {
      const invite=saved.state.invitations.find(i=>i.id===path[3]);
      if(!invite)throw new AppError(404,"Invitation not found.");
      const issuer=await ctx.issuer(invite.invitedBy,org.id);
      if(!issuer)throw new AppError(403,"Inviter is no longer in this organization.");
      // Validate recipient/token/expiry and apply RBAC membership + unit assignment in memory first.
      const result=service.accept(path[3],String(body.token||""),issuer);
      // IAM join is idempotent: a prior attempt may have granted Blocks membership before RBAC committed.
      try {await ctx.joinOrganization(org.id);}
      catch(error){if(!alreadyOrganizationMember(error))throw error;}
      if(!result.alreadyAccepted) {
        try {await ctx.repository.commit(saved.state,saved);}
        catch {throw new AppError(409,"Organization changed. Membership may be in place; retry the invitation to finish accepting. No unit access was granted by this failed save.");}
      }
      return json(result);
    }
    if (!path[2] && method === "GET")
      return json({
        initialized: true,
        revision: saved.revision,
        ...service.snapshot(),
      });
    if (path[2] === "access" && method === "GET") {
      service.country();
      const unitId = url.searchParams.get("unitId");
      const role = unitId
        ? service.unitRole(unitId)
        : service.organizationAdmin()
          ? "organization-admin"
          : undefined;
      if (unitId && !role)
        throw new AppError(403, "No assignment to this unit.");
      return json({
        organizationId: org.id,
        unitId,
        role: role || "member",
        effectiveOrganizationRole: service.companyOwner()?"organization-owner":service.orgMember()?.role||"member",
        canManageOrganization: service.canManageOrganization(),
        canCreateUnit: service.organizationAdmin(),
        canManageUnit: !!unitId && service.canManageUnit(unitId),
        canManageMembers: unitId ? role === "organization-admin" || role === "unit-admin" : service.canManageOrganization(),
        canUseUnit: !!unitId && !!role,
        canManageUnitContent:
          !!unitId && (role === "organization-admin" || role === "unit-admin"),
      });
    }
    if (path[2] === "directory" && method === "GET") {
      const snapshot = service.snapshot();
      const managesUnit = snapshot.units.some((u) => u.canManage);
      const users = await ctx.directory(org.id);
      return json({
        users: users
          .filter(
            (u) =>
              snapshot.canManageOrganization ||
              (managesUnit &&
                saved!.state.members.some(
                  (m) => m.userId === u.id && m.status === "active",
                )) ||
              snapshot.members.some((m) => m.userId === u.id),
          )
          .map((u) => ({
            ...u,
            organizationRole: saved!.state.members.find(
              (m) => m.userId === u.id && m.status === "active",
            )?.role,
          })),
      });
    }
    if (path[2] === "import-preview" && method === "GET") {
      service.requireOrganizationManager();
      const legacy = await ctx.legacy(org.id);
      return json({
        units: legacyImport(org, legacy.departments, legacy.groups).units,
      });
    }
    service.country();
    if (method !== "POST" && method !== "PATCH" && method !== "DELETE")
      throw new AppError(404, "Endpoint not found.");
    // Every mutation carries the read revision. All invariants and audit events commit by one CAS.
    const revision =
      method === "DELETE" ? req.headers.get("if-match") : body.revision;
    if (typeof revision !== "string" || revision !== saved.revision)
      throw new AppError(409, "Organization changed. Refresh before retrying.");
    let result: unknown = { success: true };
    const target = async () => {
      const people = await ctx.directory(org.id);
      const user = people.find((u) => u.id === body.userId);
      if (!user)
        throw new AppError(422, "Choose an IAM member of this organization.");
      return user;
    };
    if (!path[2] && method === "DELETE") {
      service.dissolveOrganization();
      await ctx.repository.remove(org.id, saved);
      return json({ removed: true });
    } else if (path[2] === "ownership" && method === "POST") {
      service.transferOwnership(String(body.userId || ""));
    } else if (path[2] === "settings" && method === "PATCH")
      service.settings(body);
    else if (path[2] === "units" && !path[3] && method === "POST")
      result = service.saveUnit(undefined, body);
    else if (path[2] === "units" && path[3] && !path[4] && method === "PATCH")
      result = service.saveUnit(path[3], body);
    else if (
      path[2] === "units" &&
      path[3] &&
      path[4] === "status" &&
      method === "POST"
    ) {
      if (body.status !== "active" && body.status !== "archived")
        throw new AppError(422, "Invalid unit status.");
      service.statusUnit(path[3], body.status);
    } else if (path[2] === "members" && !path[3] && method === "POST") {
      service.requireOrganizationManager();
      if (body.role !== "organization-admin" && body.role !== "member")
        throw new AppError(
          422,
          "Choose Organization Admin or organization membership only.",
        );
      const users = await ctx.directory(org.id);
      let selected = users.find(
        (u) =>
          u.id === body.userId ||
          (typeof body.email === "string" &&
            u.email.toLowerCase() === body.email.trim().toLowerCase()),
      );
      if (
        !selected &&
        (ctx.actor.superAdmin || service.companyOwner()) &&
        typeof body.email === "string" &&
        mode() === "live"
      ) {
        const created = await provisionUser(org.id, body);
        selected = {
          id: created.id,
          name: created.name,
          email: created.email,
          active: true,
          verified: created.verified,
          organizationIds: [org.id],
          superAdmin: false,
        };
      }
      if (!selected)
        throw new AppError(
          422,
          "Select an existing IAM member. A super-admin can provision accounts by email.",
        );
      service.addOrganizationMember(selected, body.role,body.managedUnitIds);
    } else if (path[2] === "members" && path[3] && method === "DELETE")
      service.removeOrganizationMember(path[3]);
    else if (
      path[2] === "units" &&
      path[3] &&
      path[4] === "members" &&
      !path[5] &&
      method === "POST"
    )
      service.assign(await target(), path[3], body.role);
    else if (
      path[2] === "units" &&
      path[3] &&
      path[4] === "members" &&
      path[5] &&
      method === "DELETE"
    )
      service.removeUnitMember(path[3], path[5]);
    else if (path[2] === "invitations" && !path[3] && method === "POST") {
      if(body.scope!==undefined&&body.scope!=="organization"&&body.scope!=="unit")throw new AppError(422,"Choose organization or unit invitation scope.");
      const organizationInvite=body.scope==="organization";
      if(organizationInvite){
        if(!service.canInviteOrganization())throw new AppError(403,"Only Super Admin or this company owner can invite organization members.");
        if(body.unitId)throw new AppError(422,"Organization invitations cannot specify a unit.");
      }else service.requireUnitAdmin(String(body.unitId||""));
      const email=typeof body.email==="string"?body.email.trim().toLowerCase():"";
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)
        throw new AppError(422,"Enter a valid email address.");
      const recipient=await ctx.findAccount(email);
      if (recipient && (!recipient.active || !recipient.verified))
        throw new AppError(
          422,
          "This Blocks account is inactive or unverified. Activate and verify it before accepting an invitation.",
        );
      if (
        !service.organizationAdmin() &&
        (saved.state.members.some(
          (m) =>
            m.userId === recipient?.id &&
            m.role === "organization-admin" &&
            m.status === "active",
        ) ||
          saved.state.assignments.some(
            (m) =>
              m.userId === recipient?.id &&
              m.unitId === body.unitId &&
              m.role === "unit-admin" &&
              m.status === "active",
          ))
      )
        throw new AppError(403, "Unit Admins cannot invite or change admins.");
      result = organizationInvite?service.inviteOrganization(recipient||{email},body.role,body.managedUnitIds):service.invite(recipient || {email}, String(body.unitId || ""), body.role);
    } else if (path[2] === "invitations" && path[3] && method === "DELETE")
      service.revokeInvitation(path[3]);
    else throw new AppError(404, "Endpoint not found.");
    if (path[2] === "members") {
      const directory = await ctx.directory(org.id);
      if (
        !saved.state.members.some(
          (m) =>
            m.status === "active" &&
            m.role === "organization-admin" &&
            directory.some((u) => u.id === m.userId && u.active && u.verified),
        )
      )
        throw new AppError(
          409,
          "Keep at least one active, verified IAM member as Organization Admin.",
        );
    }
    try {
      await ctx.repository.commit(saved.state, saved);
    } catch (e) {
      if (path[2] === "members" && body.email)
        throw new AppError(
          409,
          "IAM account/country membership may be in place, but the RBAC save failed. Refresh and retry with the existing account.",
        );
      throw e;
    }
    if(path[2]==="invitations" && !path[3] && method==="POST") {
      const link=result as {id:string;token:string};
      const invite=saved.state.invitations.find(i=>i.id===link.id)!;
      const unit=saved.state.units.find(u=>u.id===invite.unitId);
      const emailStatus=await sendInvitationMail({
        email:invite.email,
        organization:saved.state.displayName,
        unit:invite.scope==="organization"?"Organization":unit!.name,
        role:invite.role,
        organizationId:org.id,
        scope:invite.scope==="organization"?"organization":"unit",
        ...link,
      });
      return json({...link,emailStatus});
    }
    return json(result);
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message }, e.status);
    console.error(
      "Organization RBAC request failed; sensitive response suppressed.",
    );
    return json(
      {
        error:
          "Blocks could not complete this RBAC operation. Refresh before retrying.",
      },
      502,
    );
  }
}
