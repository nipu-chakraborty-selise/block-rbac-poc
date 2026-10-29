import { randomUUID } from "node:crypto";
import { Authorization } from "./authorization";
import {
  AppError,
  PERMISSIONS,
  type Permission,
  type Scope,
  type ScopeType,
  type User,
} from "./model";
import type { HierarchyStore } from "./store";
const text = (v: unknown, label: string, max = 120) => {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max)
    throw new AppError(422, `${label} must be 1–${max} characters.`);
  return v.trim();
};
export function parseScope(
  countryId: string,
  b: Record<string, unknown>,
): Scope {
  if (b.scopeType !== "department" && b.scopeType !== "group")
    throw new AppError(422, "Choose a department or group scope.");
  return { countryId, type: b.scopeType, id: text(b.scopeId, "Scope ID") };
}
export class Application {
  readonly auth: Authorization;
  constructor(readonly store: HierarchyStore,projectId?:string) {
    this.auth = new Authorization(store,projectId);
  }
  audit(
    user: User,
    action: string,
    countryId: string,
    scopeId: string,
    targetId: string,
  ) {
    this.store.put("audit", {
      id: randomUUID(),
      actorId: user.id,
      action,
      countryOrganizationId: countryId,
      scopeId,
      targetId,
      timestamp: new Date().toISOString(),
    });
  }
  scopeForResource(id: string, countryId: string) {
    const r = this.store.get("resources", id);
    if (!r) throw new AppError(404, "Resource not found.");
    if (r.countryOrganizationId !== countryId)
      throw new AppError(422, "Resource belongs to another country.");
    const dept = this.store.get("departments", r.departmentId);
    if (!dept || dept.countryOrganizationId !== countryId)
      throw new AppError(422, "Invalid resource parent.");
    if (r.groupId) {
      const g = this.store.get("groups", r.groupId);
      if (
        !g ||
        g.departmentId !== r.departmentId ||
        g.countryOrganizationId !== countryId
      )
        throw new AppError(422, "Invalid resource group.");
    }
    return {
      r,
      scope: {
        countryId,
        type: r.groupId ? "group" : "department",
        id: r.groupId || r.departmentId,
      } as Scope,
    };
  }
  snapshot(user: User, countryId: string) {
    this.auth.country(user, countryId);
    const departments = this.store
      .all("departments")
      .filter(
        (d) =>
          d.countryOrganizationId === countryId &&
          this.auth.can(user, "department.view", {
            countryId,
            type: "department",
            id: d.id,
          }),
      );
    const groups = this.store
      .all("groups")
      .filter(
        (g) =>
          g.countryOrganizationId === countryId &&
          this.auth.can(user, "group.view", {
            countryId,
            type: "group",
            id: g.id,
          }),
      );
    const scopes: Scope[] = [
      ...departments.map((d) => ({
        countryId,
        type: "department" as const,
        id: d.id,
      })),
      ...groups.map((g) => ({ countryId, type: "group" as const, id: g.id })),
    ];
    const resources = this.store.all("resources").filter((r) => {
      if (r.countryOrganizationId !== countryId) return false;
      try {
        return this.auth.can(
          user,
          "resource.view",
          this.scopeForResource(r.id, countryId).scope,
        );
      } catch {
        return false;
      }
    });
    const memberships = this.store
      .all("memberships")
      .filter(
        (m) =>
          m.countryOrganizationId === countryId &&
          (m.userId === user.id ||
            this.auth.can(user, "member.assign-role", {
              countryId,
              type: m.scopeType,
              id: m.scopeId,
            })),
      );
    const invitations = this.store
      .all("invitations")
      .filter(
        (i) =>
          i.countryOrganizationId === countryId &&
          (i.email === user.email ||
            this.auth.can(user, "member.invite", {
              countryId,
              type: i.scopeType,
              id: i.scopeId,
            })),
      )
      .map((i) => ({
        ...i,
        status:
          i.status === "pending" && Date.parse(i.expiresAt) <= Date.now()
            ? "expired"
            : i.status,
      }));
    const roles = this.store
      .all("roles")
      .filter(
        (r) =>
          r.countryOrganizationId === countryId &&
          (this.auth.super(user) ||
            scopes.some((s) => this.auth.can(user, "member.assign-role", s)) ||
            memberships.some((m) => m.userId === user.id && m.roleId === r.id)),
      );
    const userIds = new Set(memberships.map((m) => m.userId));
    userIds.add(user.id);
    const users = this.store
      .all("users")
      .filter((u) => userIds.has(u.id) || (this.auth.super(user) && u.countryIds.includes(countryId)))
      .map((u) => ({ id: u.id, name: u.name, email: u.email, verified:u.verified, applicationAdmin:this.auth.super(user)&&this.auth.super(u) }));
    // Breadcrumb labels give context; no parent record or parent authorization is returned.
    const breadcrumbs = groups.map((g) => ({
      groupId: g.id,
      departmentName: this.store.get("departments", g.departmentId)!.name,
    }));
    return {
      departments,
      groups,
      resources,
      memberships,
      invitations,
      roles,
      users,
      breadcrumbs,
      superAdmin: this.auth.super(user),
      access: scopes.map((s) => ({
        ...s,
        permissions: PERMISSIONS.filter((p) => this.auth.can(user, p, s)),
        delegablePermissions: this.auth.super(user)
          ? [...PERMISSIONS]
          : [
              ...new Set(
                this.auth.roles(user, s).flatMap((r) => r.delegablePermissions),
              ),
            ],
      })),
      audit: this.store
        .all("audit")
        .filter(
          (e) =>
            e.countryOrganizationId === countryId &&
            (this.auth.super(user) || e.actorId === user.id),
        )
        .slice(-30)
        .reverse(),
    };
  }
  countrySave(user: User, id: string, b: Record<string, unknown>) {
    if (!this.auth.super(user))
      throw new AppError(403, "Application super-admin required.");
    const old = this.store.get("countries", id);
    if (!old) throw new AppError(404, "Country not found.");
    const name = b.name === undefined ? old.name : text(b.name, "Country name");
    const status = b.status === undefined ? old.status : b.status;
    if (status !== "active" && status !== "archived")
      throw new AppError(422, "Invalid status.");
    return this.store.transaction(() => {
      const row = { ...old, name, status: status as "active" | "archived" };
      this.store.put("countries", row);
      this.audit(user, "country.updated", id, id, id);
      return row;
    });
  }
  hierarchySave(
    user: User,
    countryId: string,
    type: ScopeType,
    id: string | undefined,
    b: Record<string, unknown>,
  ) {
    this.auth.country(user, countryId);
    const table = type === "group" ? "groups" : "departments";
    const old = id ? this.store.get(table, id) : undefined;
    if (id && !old) throw new AppError(404, "Scope not found.");
    if (old)
      this.auth.require(user, `${type}.update`, {
        countryId,
        type,
        id: old.id,
      });
    else if (type === "department") {
      if (!this.auth.super(user))
        throw new AppError(
          403,
          "Only application super-admin creates departments.",
        );
    } else {
      const parent = text(b.departmentId, "Department");
      this.auth.require(user, "group.create", {
        countryId,
        type: "department",
        id: parent,
      });
    }
    const name = text(b.name, "Name");
    const now = new Date().toISOString();
    const departmentId =
      type === "group"
        ? text(
            old && "departmentId" in old ? old.departmentId : b.departmentId,
            "Department",
          )
        : undefined;
    if (departmentId)
      this.auth.target({ countryId, type: "department", id: departmentId });
    return this.store.transaction(() => {
      const row = {
        id: old?.id || randomUUID(),
        countryOrganizationId: countryId,
        name,
        status: "active" as const,
        createdBy: old?.createdBy || user.id,
        createdAt: old?.createdAt || now,
        updatedAt: now,
      };
      if (type === "group")
        this.store.put("groups", { ...row, departmentId: departmentId! });
      else this.store.put("departments", row);
      this.audit(
        user,
        `${type}.${old ? "updated" : "created"}`,
        countryId,
        row.id,
        row.id,
      );
      return row;
    });
  }
  archive(user: User, countryId: string, type: ScopeType, id: string) {
    this.auth.require(user, `${type}.archive`, { countryId, type, id });
    return this.store.transaction(() => {
      if (type === "group") {
        const row = this.store.get("groups", id)!;
        this.store.put("groups", {
          ...row,
          status: "archived",
          updatedAt: new Date().toISOString(),
        });
      } else {
        const row = this.store.get("departments", id)!;
        this.store.put("departments", {
          ...row,
          status: "archived",
          updatedAt: new Date().toISOString(),
        });
      }
      this.audit(user, `${type}.archived`, countryId, id, id);
      return { archived: true };
    });
  }
  resourceSave(
    user: User,
    countryId: string,
    id: string | undefined,
    b: Record<string, unknown>,
  ) {
    let scope: Scope;
    if (id) {
      scope = this.scopeForResource(id, countryId).scope;
      this.auth.require(user, "resource.update", scope);
    } else {
      scope = parseScope(countryId, b);
      this.auth.require(user, "resource.create", scope);
    }
    const title = text(b.title, "Title");
    const content = text(b.content, "Content", 10000);
    const group =
      scope.type === "group" ? this.store.get("groups", scope.id) : undefined;
    const old = id ? this.store.get("resources", id) : undefined;
    return this.store.transaction(() => {
      const row = {
        id: id || randomUUID(),
        countryOrganizationId: countryId,
        departmentId: group?.departmentId || scope.id,
        groupId: group?.id || null,
        title,
        content,
        createdBy: old?.createdBy || user.id,
      };
      this.store.put("resources", row);
      this.audit(
        user,
        `resource.${id ? "updated" : "created"}`,
        countryId,
        scope.id,
        row.id,
      );
      return row;
    });
  }
  resourceDelete(user: User, countryId: string, id: string) {
    const { scope } = this.scopeForResource(id, countryId);
    this.auth.require(user, "resource.delete", scope);
    return this.store.transaction(() => {
      this.store.remove("resources", id);
      this.audit(user, "resource.deleted", countryId, scope.id, id);
      return { deleted: true };
    });
  }
  roleSave(
    user: User,
    countryId: string,
    id: string | undefined,
    b: Record<string, unknown>,
  ) {
    const scope = parseScope(countryId, b);
    this.auth.require(user, "member.assign-role", scope);
    const old = id ? this.store.get("roles", id) : undefined;
    if (id && (!old || old.countryOrganizationId !== countryId))
      throw new AppError(422, "Invalid role.");
    const check = (v: unknown): Permission[] => {
      if (!Array.isArray(v) || v.some((p) => !PERMISSIONS.includes(p)))
        throw new AppError(422, "Unknown application permission.");
      return [...new Set(v)] as Permission[];
    };
    const permissions = check(b.permissions),
      delegablePermissions = check(b.delegablePermissions);
    if (delegablePermissions.some((p) => !permissions.includes(p)))
      throw new AppError(
        422,
        "Delegable permissions must be included in role permissions.",
      );
    if (!this.auth.super(user)) {
      const allowed = new Set(
        this.auth.roles(user, scope).flatMap((r) => r.delegablePermissions),
      );
      if (
        [...permissions, ...delegablePermissions].some((p) => !allowed.has(p))
      )
        throw new AppError(403, "Permissions exceed your delegation set.");
      if (id)
        throw new AppError(
          403,
          "Only super-admin can edit shared role definitions. Create a new scoped role instead.",
        );
    }
    return this.store.transaction(() => {
      const row = {
        id: id || randomUUID(),
        countryOrganizationId: countryId,
        name: text(b.name, "Role name"),
        permissions,
        delegablePermissions,
      };
      this.store.put("roles", row);
      this.audit(user, "role.saved", countryId, scope.id, row.id);
      return row;
    });
  }
  validateUserAddition(user: User, countryId: string, b: Record<string, unknown>) {
    if (!this.auth.super(user)) throw new AppError(403, "Application super-admin required.");
    this.auth.country(user, countryId);
    if (b.level === "country") return undefined;
    if (b.level !== "department" && b.level !== "group") throw new AppError(422, "Choose an access level.");
    const scope = parseScope(countryId, {scopeType:b.level, scopeId:b.scopeId});
    this.auth.delegate(user, scope, text(b.roleId, "Role"));
    return scope;
  }
  addUser(user: User, countryId: string, target: User, b: Record<string, unknown>) {
    const scope = this.validateUserAddition(user, countryId, b);
    if (target.projectId !== this.auth.projectId || !target.verified) throw new AppError(422, "An active, verified project user is required.");
    return this.store.transaction(() => {
      const known=this.store.get("users",target.id);
      this.store.put("users", {...target, countryIds:[...new Set([...(known?.countryIds||[]),...target.countryIds, countryId])]});
      if (scope) {
        const existing=this.store.all("memberships").find(m=>m.userId===target.id&&m.countryOrganizationId===countryId&&m.scopeType===scope.type&&m.scopeId===scope.id);
        this.store.put("memberships", {id:existing?.id||randomUUID(),userId:target.id,countryOrganizationId:countryId,scopeType:scope.type,scopeId:scope.id,roleId:text(b.roleId,"Role"),status:"active"});
      }
      this.audit(user,"user.added",countryId,scope?.id||"country",target.id);
      return {success:true, userId:target.id};
    });
  }
  membershipChange(
    user: User,
    countryId: string,
    id: string,
    b: Record<string, unknown>,
    remove = false,
  ) {
    const m = this.store.get("memberships", id);
    if (!m || m.countryOrganizationId !== countryId)
      throw new AppError(422, "Invalid membership.");
    const scope = { countryId, type: m.scopeType, id: m.scopeId };
    this.auth.require(
      user,
      remove ? "member.remove" : "member.assign-role",
      scope,
    );
    if (!remove) this.auth.delegate(user, scope, text(b.roleId, "Role"));
    return this.store.transaction(() => {
      this.store.put("memberships", {
        ...m,
        status: remove ? "archived" : "active",
        roleId: remove ? m.roleId : text(b.roleId, "Role"),
      });
      this.audit(
        user,
        remove ? "membership.removed" : "membership.role-changed",
        countryId,
        scope.id,
        id,
      );
      return { success: true };
    });
  }
  invite(user: User, countryId: string, b: Record<string, unknown>) {
    const scope = parseScope(countryId, b);
    this.auth.require(user, "member.invite", scope);
    const role = this.auth.delegate(user, scope, text(b.roleId, "Role"));
    const email = text(b.email, "Email", 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new AppError(422, "Enter a valid email address.");
    return this.store.transaction(() => {
      const row = {
        id: randomUUID(),
        email,
        countryOrganizationId: countryId,
        scopeType: scope.type,
        scopeId: scope.id,
        roleId: role.id,
        signupLinkId: null,
        invitedBy: user.id,
        status: "pending" as const,
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        acceptedBy: null,
        acceptedAt: null,
      };
      this.store.put("invitations", row);
      this.audit(user, "invitation.created", countryId, scope.id, row.id);
      return { ...row, mockUrl: `/invite/${row.id}` };
    });
  }
  revoke(user: User, countryId: string, id: string) {
    const i = this.store.get("invitations", id);
    if (!i || i.countryOrganizationId !== countryId)
      throw new AppError(422, "Invalid invitation.");
    this.auth.require(user, "member.invite", {
      countryId,
      type: i.scopeType,
      id: i.scopeId,
    });
    if (i.status !== "pending")
      throw new AppError(409, "Only pending invitations can be revoked.");
    return this.store.transaction(() => {
      this.store.put("invitations", { ...i, status: "revoked" });
      this.audit(user, "invitation.revoked", countryId, i.scopeId, id);
      return { revoked: true };
    });
  }
  accept(user: User, id: string) {
    return this.store.transaction(() => {
      const i = this.store.get("invitations", id);
      if (!i) throw new AppError(404, "Invitation not found.");
      if (!user.verified || user.email.toLowerCase() !== i.email)
        throw new AppError(
          403,
          "Sign in with the verified invitation recipient.",
        );
      if (i.status === "accepted") {
        if (i.acceptedBy !== user.id)
          throw new AppError(409, "Invitation consumed.");
        return {
          accepted: true,
          alreadyAccepted: true,
          countryId: i.countryOrganizationId,
          scopeId: i.scopeId,
        };
      }
      if (i.status !== "pending" || Date.parse(i.expiresAt) <= Date.now())
        throw new AppError(410, "Invitation is expired or revoked.");
      const scope = {
        countryId: i.countryOrganizationId,
        type: i.scopeType,
        id: i.scopeId,
      };
      this.auth.target(scope);
      const inviter = this.auth.identity(i.invitedBy);
      this.auth.require(inviter, "member.invite", scope);
      this.auth.delegate(inviter, scope, i.roleId);
      const existing = this.store
        .all("memberships")
        .find(
          (m) =>
            m.userId === user.id &&
            m.countryOrganizationId === scope.countryId &&
            m.scopeType === scope.type &&
            m.scopeId === scope.id,
        );
      if (
        existing &&
        existing.status === "active" &&
        existing.roleId !== i.roleId
      )
        throw new AppError(
          409,
          "An active assignment already exists. Ask an admin to change its role.",
        );
      this.store.put("memberships", {
        id: existing?.id || randomUUID(),
        userId: user.id,
        countryOrganizationId: scope.countryId,
        scopeType: scope.type,
        scopeId: scope.id,
        roleId: i.roleId,
        status: "active",
      });
      this.store.put("users", {
        ...user,
        countryIds: [...new Set([...user.countryIds, scope.countryId])],
      });
      this.store.put("invitations", {
        ...i,
        status: "accepted",
        acceptedBy: user.id,
        acceptedAt: new Date().toISOString(),
      });
      this.audit(user, "invitation.accepted", scope.countryId, scope.id, id);
      return {
        accepted: true,
        countryId: scope.countryId,
        scopeId: scope.id,
        scopeType: scope.type,
        location: this.auth.target(scope).name,
      };
    });
  }
  grantSuper(user: User, targetId: string) {
    if (!this.auth.super(user))
      throw new AppError(403, "Only super-admin may grant super-admin.");
    const target = this.auth.identity(targetId);
    return this.store.transaction(() => {
      if (!this.auth.super(target))
        this.store.put("admins", {
          id: randomUUID(),
          userId: target.id,
          grantedBy: user.id,
          createdAt: new Date().toISOString(),
        });
      this.audit(user, "super-admin.granted", "bd", "application", target.id);
      return { success: true };
    });
  }
}
