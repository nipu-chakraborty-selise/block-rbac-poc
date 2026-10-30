import {rolePermissions, editableRoles, permissionKeys, validGrants, type EditableRole, type WorkspacePermission} from './permissions';
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AppError } from "../model";
import { type OrganizationState, type Identity } from "./model";
const text = (v: unknown, label: string, max = 120) => {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max)
    throw new AppError(422, `${label} must be 1–${max} characters.`);
  return v.trim();
};
export const normalizedName = (name: string) =>
  name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export class Rbac {
  constructor(
    readonly state: OrganizationState,
    readonly actor: Identity,
  ) {
    if (!actor.active || !actor.verified)
      throw new AppError(403, "An active, verified account is required.");
  }
  orgMember() {
    return this.state.members.find(
      (m) => m.userId === this.actor.id && m.status === "active",
    );
  }
  organizationAdmin() {
    return (
      this.actor.superAdmin ||
      this.companyOwner() ||
      !!(
        this.actor.organizationIds.includes(this.state.organizationId) &&
        this.orgMember()?.role === "organization-admin"
      )
    );
  }
  companyOwner() {
    return (
      this.state.ownerId === this.actor.id &&
      this.orgMember()?.role === "organization-admin"
    );
  }
  canInviteOrganization() {
    return this.actor.superAdmin || this.companyOwner();
  }
  canManageOrganization() {
    return this.actor.superAdmin || this.companyOwner() || (!this.state.ownerId && this.organizationAdmin());
  }
  requireOrganizationManager() {
    this.country();
    if(!this.canManageOrganization())throw new AppError(403,"Organization Owner required to manage organization membership and settings.");
  }
  canManageUnit(id:string) {
    if (!this.state.units.some((u) => u.id === id)) return false;
    if (this.canManageOrganization()) return true;
    if (!this.organizationAdmin()) return false;
    // Owner-managed orgs: Organization Admins only manage authorized units (or units they create).
    if (this.state.ownerId) {
      const managed = this.orgMember()?.managedUnitIds;
      return Array.isArray(managed) && managed.includes(id);
    }
    // Legacy orgs without ownerId retain full Organization Admin unit authority.
    return true;
  }
  private parseManagedUnitIds(raw: unknown, role: string) {
    if (role !== "organization-admin") return undefined;
    if (raw === undefined || raw === null) return [] as string[];
    const list = Array.isArray(raw)
      ? raw
      : typeof raw === "string"
        ? raw.split(",").map((s) => s.trim()).filter(Boolean)
        : null;
    if (!list)
      throw new AppError(422, "Choose zero or more units for this Organization Admin.");
    const ids = [
      ...new Set(
        list.map((id) => {
          if (typeof id !== "string" || !id)
            throw new AppError(422, "Each authorized unit id must be a string.");
          return id;
        }),
      ),
    ];
    for (const id of ids)
      if (!this.state.units.some((u) => u.id === id))
        throw new AppError(
          422,
          "Choose authorized units that exist in this organization.",
        );
    return ids;
  }
  private sameManagedUnits(a?: string[], b?: string[]) {
    const left = [...(a || [])].sort();
    const right = [...(b || [])].sort();
    return (
      left.length === right.length && left.every((id, index) => id === right[index])
    );
  }
  permissions(role: EditableRole, unitId?: string) {
    return rolePermissions(this.state.permissionPolicy, role, unitId);
  }
  can(permission: WorkspacePermission, unitId?: string): boolean {
    if (this.canManageOrganization()) return true;
    if (permission === 'createUnit') return this.organizationAdmin() && this.permissions('organization-admin').createUnit;
    if (!unitId) return false;
    if (this.canManageUnit(unitId)) return this.permissions('organization-admin')[permission];
    const role = this.state.assignments.find(a => a.userId === this.actor.id && a.unitId === unitId && a.status === 'active')?.role;
    return !!role && this.permissions(role, unitId)[permission];
  }
  requirePermission(permission: WorkspacePermission, unitId?: string) {
    this.country();
    if (unitId) this.unit(unitId, permission === 'renameUnit' || permission === 'changeUnitStatus');
    if (!this.can(permission, unitId)) throw new AppError(403, 'Your workspace role does not permit this action.');
  }
  updatePermissions(body: Record<string, unknown>) {
    this.country();
    if (body.unitId !== undefined && typeof body.unitId !== "string") throw new AppError(422, "Choose a valid unit scope.");
    const role = body.role as EditableRole;
    const unitId = typeof body.unitId === 'string' && body.unitId ? body.unitId : undefined;
    if (!editableRoles.includes(role) || !validGrants(body.permissions, role)) throw new AppError(422, 'Choose a workspace role and valid permissions within its hierarchy.');
    if (unitId) this.unit(unitId, true);
    if (!this.actor.superAdmin && !this.companyOwner()) {
      if (!this.organizationAdmin() || !unitId || role === 'organization-admin' || !this.canManageUnit(unitId)) throw new AppError(403, 'Only a parent role can edit lower-role permissions within authorized units.');
      for (const key of permissionKeys) if (body.permissions[key] && !this.can(key, unitId)) throw new AppError(403, 'You cannot delegate a permission you do not have.');
    }
    if (unitId && role === 'organization-admin') throw new AppError(422, 'Organization Admin permissions are configured at organization scope.');
    const policy = this.state.permissionPolicy ||= {};
    const target = unitId ? ((policy.units ||= {})[unitId] ||= {}) : (policy.roles ||= {});
    target[role] = {...body.permissions};
    this.event('role.permissions-changed', `${unitId || this.state.organizationId}:${role}`);
  }
  requireUnitManager(id:string) {
    this.unit(id,true);
    if(!this.canManageUnit(id))throw new AppError(403,"Organization Admin required to manage this unit.");
  }
  country() {
    if (this.actor.superAdmin) return;
    const member = this.orgMember();
    // Company owners keep access even if IAM membership has not refreshed yet.
    if (this.state.ownerId === this.actor.id && member) return;
    if (
      !this.actor.organizationIds.includes(this.state.organizationId) ||
      !member
    )
      throw new AppError(403, "No access to this organization.");
  }
  requireAdmin() {
    this.country();
    if (!this.organizationAdmin())
      throw new AppError(403, "Organization Admin required.");
  }
  unit(id: string, includeArchived = false) {
    this.country();
    const unit = this.state.units.find((u) => u.id === id);
    if (!unit) throw new AppError(404, "Unit not found.");
    if (!includeArchived && unit.status !== "active")
      throw new AppError(403, "Unit is archived.");
    return unit;
  }
  unitRole(id: string) {
    this.unit(id);
    if (this.canManageUnit(id)) return "organization-admin" as const;
    return this.state.assignments.find(
      (m) =>
        m.userId === this.actor.id && m.unitId === id && m.status === "active",
    )?.role;
  }
  requireUnitAdmin(id: string) {
    const role = this.unitRole(id);
    if (role !== "organization-admin" && role !== "unit-admin")
      throw new AppError(403, "Unit Admin required.");
  }
  event(action: string, targetId: string) {
    this.state.events.push({
      id: randomUUID(),
      actorId: this.actor.id,
      action,
      targetId,
      timestamp: new Date().toISOString(),
    });
    if (this.state.events.length > 2000)
      throw new AppError(
        409,
        "Organization audit capacity reached. Export/archive audit history before further changes.",
      );
  }
  snapshot() {
    this.country();
    const admin = this.canManageOrganization();
    const units = this.state.units
      .filter(
        (u) =>
          this.canManageUnit(u.id) ||
          ((u.status === "active" || this.can("renameUnit",u.id) || this.can("changeUnitStatus",u.id)) &&
            this.state.assignments.some(
              (m) =>
                m.userId === this.actor.id &&
                m.unitId === u.id &&
                m.status === "active",
            )),
      )
      .map((u) => ({
        ...u,
        role:
          u.status === "active" && this.companyOwner()
            ? "organization-owner"
            : u.status === "active"
              ? this.unitRole(u.id)
              : this.canManageUnit(u.id) ? "organization-admin" : this.state.assignments.find(a=>a.userId===this.actor.id && a.unitId===u.id && a.status==="active")?.role,
        permissions: Object.fromEntries(permissionKeys.map(key => [key, this.can(key, u.id)])) as import("./permissions").PermissionGrants,
        canManage:
          this.canManageUnit(u.id) ||
          (u.status === "active" && this.unitRole(u.id) === "unit-admin"),
      }));
    const ids = new Set(units.map((u) => u.id));
    const assignments = this.state.assignments.filter(
      (m) =>
        m.status === "active" &&
        ids.has(m.unitId) &&
        (this.canManageUnit(m.unitId) ||
          units.some(u=>u.id===m.unitId && u.role==="unit-admin") ||
          m.userId === this.actor.id),
    );
    const visibleUsers = new Set(assignments.map((m) => m.userId));
    visibleUsers.add(this.actor.id);
    return {
      organizationId: this.state.organizationId,
      name: this.state.displayName,
      layerLabel: this.state.layerLabel,
      organizationAdmin: this.organizationAdmin(),
      canManageOrganization: admin,
      canCreateUnit: this.can("createUnit"),
      permissionPolicy: {roles: this.state.permissionPolicy?.roles, units: Object.fromEntries(Object.entries(this.state.permissionPolicy?.units || {}).filter(([id]) => ids.has(id)))},
      canEditRolePermissions: this.organizationAdmin(),
      canConfigureCompanyPermissions: this.actor.superAdmin || this.companyOwner(),
      effectiveRole: this.companyOwner()?"organization-owner":this.orgMember()?.role||"member",
      superAdmin: this.actor.superAdmin,
      companyOwner: this.companyOwner(),
      ownerId: this.state.ownerId,
      canInviteOrganization: this.canInviteOrganization(),
      units,
      members: this.state.members.filter(
        (m) => m.status === "active" && (admin || visibleUsers.has(m.userId)),
      ),
      assignments,
      invitations: this.state.invitations
        .filter(
          (i) =>
            admin ||
            (ids.has(i.unitId) &&
              units.some((u) => u.id === i.unitId && u.canManage)),
        )
        .map((i) => ({
          id: i.id,
          email: i.email,
          unitId: i.unitId,
          scope: i.scope || "unit",
          role: i.role,
          managedUnitIds: i.managedUnitIds,
          invitedBy: i.invitedBy,
          expiresAt: i.expiresAt,
          expired: Date.parse(i.expiresAt) <= Date.now(),
          status: i.status,
          acceptedBy: i.acceptedBy,
        })),
      events: this.state.events
        .filter((e) => admin || e.actorId === this.actor.id)
        .slice(-100)
        .reverse(),
      roles: ["Organization Owner", "Organization Admin", "Unit Admin", "Unit Member"],
      noAssignmentMessage:
        "You have not been assigned to a unit. Contact your Organization Admin.",
    };
  }
  settings(b: Record<string, unknown>) {
    this.requireOrganizationManager();
    this.state.displayName = text(b.name, "Organization name");
    this.state.layerLabel = text(b.layerLabel, "Layer label", 40);
    this.event("organization.settings-changed", this.state.organizationId);
  }
  saveUnit(id: string | undefined, b: Record<string, unknown>) {
    this.requirePermission(id ? "renameUnit" : "createUnit", id);
    const name = text(b.name, "Unit name");
    if (
      this.state.units.some(
        (u) => u.id !== id && normalizedName(u.name) === normalizedName(name),
      )
    )
      throw new AppError(
        409,
        "A unit with that name already exists, including archived units.",
      );
    if (id) {
      const unit = this.unit(id, true);
      unit.name = name;
    } else {
      if (this.state.units.length >= 300)
        throw new AppError(
          409,
          "This RBAC release supports 300 units per organization.",
        );
      id = randomUUID();
      this.state.units.push({ id, name, status: "active" });
      // Units created by a scoped Organization Admin are automatically authorized for them.
      const member = this.orgMember();
      if (
        member?.role === "organization-admin" &&
        !this.canManageOrganization() &&
        this.state.ownerId
      ) {
        member.managedUnitIds = [
          ...new Set([...(member.managedUnitIds || []), id]),
        ];
      }
    }
    this.event("unit.saved", id);
    return { id };
  }
  statusUnit(id: string, status: "active" | "archived") {
    this.requirePermission("changeUnitStatus", id);
    this.unit(id, true).status = status;
    this.event(status === "active" ? "unit.restored" : "unit.archived", id);
  }
  addOrganizationMember(
    target: Identity,
    role: "organization-admin" | "member" = "member",
    managedUnitIds?: unknown,
  ) {
    this.requireOrganizationManager();
    this.validateTarget(target);
    if(target.id===this.state.ownerId && role!=="organization-admin")throw new AppError(409,"The company owner must remain an Organization Admin.");
    const scoped = this.parseManagedUnitIds(managedUnitIds, role);
    const old = this.state.members.find((m) => m.userId === target.id);
    if (
      old?.status === "active" &&
      old.role === role &&
      this.sameManagedUnits(old.managedUnitIds, scoped)
    )
      return;
    this.protectLastAdmin(target.id, role, "active");
    if (old) {
      old.role = role;
      old.status = "active";
      old.managedUnitIds = scoped;
    } else {
      if (this.state.members.length >= 1000)
        throw new AppError(
          409,
          "This RBAC release supports 1,000 members per organization.",
        );
      this.state.members.push({
        userId: target.id,
        role,
        status: "active",
        managedUnitIds: scoped,
      });
    }
    this.event("organization.member-added", target.id);
  }
  transferOwnership(userId: string) {
    if (!this.actor.superAdmin && !this.companyOwner())
      throw new AppError(
        403,
        "Only the company owner or platform Super Admin can transfer ownership.",
      );
    this.country();
    if (typeof userId !== "string" || !userId)
      throw new AppError(422, "Choose the next Organization Owner.");
    if (userId === this.state.ownerId) return;
    const next = this.state.members.find(
      (m) =>
        m.userId === userId &&
        m.status === "active" &&
        m.role === "organization-admin",
    );
    if (!next)
      throw new AppError(
        422,
        "Ownership can only transfer to an active Organization Admin.",
      );
    const previousId = this.state.ownerId;
    const previous = previousId
      ? this.state.members.find((m) => m.userId === previousId)
      : undefined;
    if (previous && previous.userId !== userId) {
      previous.role = "organization-admin";
      previous.status = "active";
      previous.managedUnitIds = this.state.units.map((u) => u.id);
    }
    next.role = "organization-admin";
    next.status = "active";
    next.managedUnitIds = undefined;
    this.state.ownerId = userId;
    this.event("organization.ownership-transferred", userId);
  }
  dissolveOrganization() {
    if (!this.actor.superAdmin && !this.companyOwner())
      throw new AppError(
        403,
        "Only the company owner or platform Super Admin can remove this organization workspace.",
      );
    this.country();
    for (const invite of this.state.invitations)
      if (invite.status === "pending") invite.status = "revoked";
    for (const member of this.state.members)
      if (member.status === "active") member.status = "removed";
    for (const assignment of this.state.assignments)
      if (assignment.status === "active") assignment.status = "removed";
    this.event("organization.removed", this.state.organizationId);
  }
  validateTarget(target: Identity) {
    if (
      !target.active ||
      !target.verified ||
      !target.organizationIds.includes(this.state.organizationId)
    )
      throw new AppError(
        422,
        "Select an active, verified IAM member of this organization.",
      );
  }
  protectLastAdmin(userId: string, role: string, status: string) {
    const old = this.state.members.find((m) => m.userId === userId);
    if (
      old?.status === "active" &&
      old.role === "organization-admin" &&
      (role !== "organization-admin" || status !== "active") &&
      this.state.members.filter(
        (m) => m.status === "active" && m.role === "organization-admin",
      ).length <= 1
    )
      throw new AppError(
        409,
        "Keep at least one active Organization Admin. Appoint another before removing or demoting this admin.",
      );
  }
  removeOrganizationMember(userId: string) {
    this.requireOrganizationManager();
    if(userId===this.state.ownerId)throw new AppError(409,"Company ownership must be transferred before removing the owner.");
    const member = this.state.members.find(
      (m) => m.userId === userId && m.status === "active",
    );
    if (!member) throw new AppError(404, "Member not found.");
    this.protectLastAdmin(userId, member.role, "removed");
    member.status = "removed";
    for (const a of this.state.assignments)
      if (a.userId === userId) a.status = "removed";
    for (const i of this.state.invitations)
      if (
        (i.recipientId === userId || i.invitedBy === userId) &&
        i.status === "pending"
      )
        i.status = "revoked";
    this.event("organization.member-removed", userId);
  }
  assign(target: Identity, unitId: string, role: unknown, fromInvitation = false) {
    this.requireUnitAdmin(unitId);
    this.requirePermission(role === "unit-admin" ? (fromInvitation ? "inviteAdmins" : "manageAdmins") : (fromInvitation ? "inviteMembers" : "manageMembers"), unitId);
    this.validateTarget(target);
    if (role !== "unit-admin" && role !== "unit-user")
      throw new AppError(422, "Choose Unit Admin or Unit Member.");
    const orgMember = this.state.members.find(
      (m) => m.userId === target.id && m.status === "active",
    );
    if (!orgMember)
      throw new AppError(422, "Add the person to the organization first.");
    const old = this.state.assignments.find(
      (m) => m.userId === target.id && m.unitId === unitId,
    );
    if (
      !this.organizationAdmin() &&
      (role !== "unit-user" ||
        (old?.status === "active" && old.role === "unit-admin") ||
        orgMember.role === "organization-admin")
    )
      throw new AppError(
        403,
        "Unit Admins can manage regular Unit Members only.",
      );
    if (old?.status === "active" && old.role === "unit-admin") this.requirePermission("manageAdmins", unitId);
    if (old) {
      old.role = role;
      old.status = "active";
    } else
      this.state.assignments.push({
        userId: target.id,
        unitId,
        role,
        status: "active",
      });
    this.event("unit.member-assigned", `${unitId}:${target.id}`);
  }
  removeUnitMember(unitId: string, userId: string) {
    this.requireUnitAdmin(unitId);
    const old = this.state.assignments.find(
      (m) =>
        m.userId === userId && m.unitId === unitId && m.status === "active",
    );
    if (!old) throw new AppError(404, "Unit membership not found.");
    this.requirePermission(old.role === "unit-admin" ? "manageAdmins" : "manageMembers", unitId);
    if (
      !this.organizationAdmin() &&
      (old.role === "unit-admin" ||
        this.state.members.some(
          (m) =>
            m.userId === userId &&
            m.role === "organization-admin" &&
            m.status === "active",
        ))
    )
      throw new AppError(403, "Only Organization Admin can remove admins.");
    old.status = "removed";
    for (const i of this.state.invitations)
      if (
        i.unitId === unitId &&
        i.status === "pending" &&
        (i.recipientId === userId || i.invitedBy === userId)
      )
        i.status = "revoked";
    this.event("unit.member-removed", `${unitId}:${userId}`);
  }
  invite(target: Identity | { email: string }, unitId: string, role: unknown) {
    this.requireUnitAdmin(unitId);
    this.requirePermission(role === "unit-admin" ? "inviteAdmins" : "inviteMembers", unitId);
    if("id" in target && (!target.active || !target.verified))
      throw new AppError(422,"Choose an active, verified Blocks account.");
    const recipientId="id" in target?target.id:"";
    const member = this.state.members.find(
      (m) => m.userId === recipientId && m.status === "active",
    );
    if (
      !this.organizationAdmin() &&
      (member?.role === "organization-admin" ||
        this.state.assignments.some(
          (m) =>
            m.userId === recipientId &&
            m.unitId === unitId &&
            m.role === "unit-admin" &&
            m.status === "active",
        ))
    )
      throw new AppError(403, "Unit Admins cannot invite or change admins.");
    const address = text(target.email, "Email", 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
      throw new AppError(422, "Enter a valid email.");
    if (role !== "unit-admin" && role !== "unit-user")
      throw new AppError(422, "Choose a fixed unit role.");
    if (!this.organizationAdmin() && role !== "unit-user")
      throw new AppError(403, "Only Organization Admin can invite admins.");
    return this.createInvitation(target,unitId,role,"unit");
  }
  inviteOrganization(target: Identity | {email:string},role:unknown,managedUnitIds?:unknown) {
    if(!this.canInviteOrganization())throw new AppError(403,"Only Super Admin or this company owner can invite organization members.");
    if(role!=="organization-admin"&&role!=="member")throw new AppError(422,"Choose Organization Admin or organization membership only.");
    return this.createInvitation(target,"",role,"organization",managedUnitIds);
  }
  private createInvitation(target:Identity|{email:string},unitId:string,role:"unit-admin"|"unit-user"|"organization-admin"|"member",scope:"unit"|"organization",managedUnitIds?:unknown) {
    if("id" in target&&(!target.active||!target.verified))throw new AppError(422,"Choose an active, verified Blocks account.");
    const recipientId="id" in target?target.id:"";
    const address=text(target.email,"Email",254).toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))throw new AppError(422,"Enter a valid email.");
    const scoped =
      scope === "organization"
        ? this.parseManagedUnitIds(managedUnitIds, role)
        : undefined;
    const token = randomBytes(32).toString("base64url"),
      id = randomUUID();
    for (const previous of this.state.invitations) {
      if (
        previous.status === "pending" &&
        previous.email === address &&
        previous.scope === scope &&
        previous.unitId === unitId &&
        previous.role === role
      )
        previous.status = "revoked";
    }
    this.state.invitations.push({
      id,
      email: address,
      recipientId,
      unitId,
      role,
      scope,
      managedUnitIds: scoped,
      tokenHash: tokenHash(token),
      invitedBy: this.actor.id,
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      status: "pending",
    });
    this.event("invitation.created", id);
    return { id, token };
  }
  revokeInvitation(id: string) {
    const i = this.state.invitations.find((i) => i.id === id);
    if (!i) throw new AppError(404, "Invitation not found.");
    if(i.scope==="organization") {
      if(!this.canInviteOrganization())throw new AppError(403,"Only Super Admin or this company owner can revoke organization invitations.");
    }else this.requireUnitAdmin(i.unitId);
    if (
      !this.organizationAdmin() &&
      (i.role === "unit-admin" ||
        this.state.members.some(
          (m) =>
            m.userId === i.recipientId &&
            m.role === "organization-admin" &&
            m.status === "active",
        ))
    )
      throw new AppError(
        403,
        "Only Organization Admin can revoke admin invitations.",
      );
    if (i.status !== "pending")
      throw new AppError(409, "Invitation is no longer pending.");
    i.status = "revoked";
    this.event("invitation.revoked", id);
  }
  accept(id: string, token: string, issuer: Identity) {
    const i = this.state.invitations.find((i) => i.id === id);
    if (
      !i ||
      tokenHash(token) !== i.tokenHash ||
      i.email !== this.actor.email.toLowerCase() ||
      (i.recipientId !== "" && i.recipientId !== this.actor.id)
    )
      throw new AppError(403, "Invitation does not match your account.");
    if (i.status === "accepted" && i.acceptedBy === this.actor.id)
      return { alreadyAccepted: true };
    if (i.status === "accepted")
      throw new AppError(410, "This invitation was already accepted.");
    if (i.status === "revoked")
      throw new AppError(410, "This invitation was revoked. Ask your administrator for a new link.");
    if (Date.parse(i.expiresAt) <= Date.now())
      throw new AppError(410, "This invitation has expired. Ask your administrator for a new link.");
    if (i.status !== "pending")
      throw new AppError(410, "Invitation is no longer available.");
    const issuing = new Rbac(this.state, issuer);
    if(i.scope==="organization") {
      if(!issuing.canInviteOrganization())throw new AppError(403,"Inviter no longer has company-owner or Super Admin permission.");
      if(i.role!=="organization-admin"&&i.role!=="member")throw new AppError(422,"Invalid organization invitation role.");
      issuing.addOrganizationMember({...this.actor,organizationIds:[...new Set([...this.actor.organizationIds,this.state.organizationId])]},i.role,i.managedUnitIds);
      i.status="accepted";i.recipientId=this.actor.id;i.acceptedBy=this.actor.id;
      this.event("invitation.accepted",id);return {alreadyAccepted:false};
    }
    issuing.requireUnitAdmin(i.unitId);
    issuing.requirePermission(i.role === "unit-admin" ? "inviteAdmins" : "inviteMembers", i.unitId);
    if (!issuing.organizationAdmin() && i.role !== "unit-user")
      throw new AppError(
        403,
        "Inviter no longer has permission to appoint admins.",
      );
    // Consent creates membership and the unit assignment in the same state commit.
    let member=this.state.members.find(m=>m.userId===this.actor.id);
    if(!member || member.status!=="active") {
      if(!member && this.state.members.length>=1000)
        throw new AppError(409,"This RBAC release supports 1,000 members per organization.");
      if(member){member.status="active";member.role="member";}
      else {member={userId:this.actor.id,role:"member",status:"active"};this.state.members.push(member);}
      this.event("organization.member-added",this.actor.id);
    }
    issuing.assign({...this.actor,organizationIds:[...new Set([...this.actor.organizationIds,this.state.organizationId])]}, i.unitId, i.role, true);
    i.status = "accepted";
    i.recipientId = this.actor.id;
    i.acceptedBy = this.actor.id;
    this.event("invitation.accepted", id);
    return { alreadyAccepted: false };
  }
}
