import {
  AppError,
  type Permission,
  type Scope,
  type ScopedRole,
  type User,
} from "./model";
import type { HierarchyStore } from "./store";
import { PROJECT_ID } from "./seed";
export class Authorization {
  constructor(readonly store: HierarchyStore, readonly projectId=PROJECT_ID) {}
  identity(userId: string | undefined): User {
    const u = userId ? this.store.get("users", userId) : undefined;
    if (!u) throw new AppError(401, "Sign in to continue.");
    if (u.projectId !== this.projectId || !u.verified)
      throw new AppError(403, "Verified identity in this project is required.");
    return u;
  }
  super(user: User) {
    return this.store.all("admins").some((a) => a.userId === user.id);
  }
  country(user: User, countryId: string) {
    const country = this.store.get("countries", countryId);
    if (!country || country.status !== "active")
      throw new AppError(403, "Country is unavailable or archived.");
    if (!this.super(user) && !user.countryIds.includes(countryId))
      throw new AppError(403, "No access to this country.");
    return country;
  }
  target(scope: Scope) {
    const c = this.store.get("countries", scope.countryId);
    if (!c || c.status !== "active")
      throw new AppError(403, "Country is unavailable or archived.");
    const row =
      scope.type === "department"
        ? this.store.get("departments", scope.id)
        : this.store.get("groups", scope.id);
    if (!row || row.countryOrganizationId !== scope.countryId)
      throw new AppError(422, "Scope does not belong to the selected country.");
    if (row.status !== "active") throw new AppError(403, "Scope is archived.");
    if (scope.type === "group") {
      const group = this.store.get("groups", scope.id)!;
      const dept = this.store.get("departments", group.departmentId);
      if (!dept || dept.countryOrganizationId !== scope.countryId)
        throw new AppError(422, "Invalid parent relationship.");
      if (dept.status !== "active")
        throw new AppError(403, "Parent department is archived.");
    }
    return row;
  }
  roles(user: User, scope: Scope): ScopedRole[] {
    this.country(user, scope.countryId);
    this.target(scope);
    const group =
      scope.type === "group" ? this.store.get("groups", scope.id) : undefined;
    return this.store
      .all("memberships")
      .filter(
        (m) =>
          m.userId === user.id &&
          m.status === "active" &&
          m.countryOrganizationId === scope.countryId &&
          ((m.scopeType === scope.type && m.scopeId === scope.id) ||
            (group &&
              m.scopeType === "department" &&
              m.scopeId === group.departmentId)),
      )
      .flatMap((m) => {
        const role = this.store.get("roles", m.roleId);
        return role && role.countryOrganizationId === scope.countryId
          ? [role]
          : [];
      });
  }
  can(user: User, permission: Permission, scope: Scope) {
    try {
      this.require(user, permission, scope);
      return true;
    } catch {
      return false;
    }
  }
  require(user: User, permission: Permission, scope: Scope) {
    this.country(user, scope.countryId);
    this.target(scope);
    if (
      !this.super(user) &&
      !this.roles(user, scope).some((r) => r.permissions.includes(permission))
    )
      throw new AppError(403, `Permission denied: ${permission}.`);
  }
  delegate(user: User, scope: Scope, roleId: string) {
    this.require(user, "member.assign-role", scope);
    const role = this.store.get("roles", roleId);
    if (!role || role.countryOrganizationId !== scope.countryId)
      throw new AppError(
        422,
        "Role belongs to another country or does not exist.",
      );
    if (!this.super(user)) {
      const allowed = new Set(
        this.roles(user, scope).flatMap((r) => r.delegablePermissions),
      );
      if (
        [...role.permissions, ...role.delegablePermissions].some(
          (p) => !allowed.has(p),
        )
      )
        throw new AppError(
          403,
          "This role exceeds your delegation permissions.",
        );
    }
    return role;
  }
}
