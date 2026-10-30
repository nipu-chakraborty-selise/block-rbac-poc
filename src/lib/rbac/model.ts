export type UnitRole = "unit-admin" | "unit-user";
export interface Unit {
  id: string;
  name: string;
  status: "active" | "archived";
}
export interface OrganizationMember {
  userId: string;
  role: "organization-admin" | "member";
  status: "active" | "removed";
  managedUnitIds?: string[];
}
export interface UnitMember {
  userId: string;
  unitId: string;
  role: UnitRole;
  status: "active" | "removed";
}
export interface Event {
  id: string;
  actorId: string;
  action: string;
  targetId: string;
  timestamp: string;
}
export interface Invitation {
  id: string;
  email: string;
  recipientId: string;
  unitId: string;
  role: UnitRole | "organization-admin" | "member";
  scope?: "organization" | "unit";
  managedUnitIds?: string[];
  tokenHash: string;
  invitedBy: string;
  expiresAt: string;
  status: "pending" | "accepted" | "revoked";
  acceptedBy?: string;
}
export interface OrganizationState {
  permissionPolicy?: import('./permissions').WorkspacePermissionPolicy;
  version: 1;
  organizationId: string;
  ownerId?: string;
  displayName: string;
  layerLabel: string;
  members: OrganizationMember[];
  units: Unit[];
  assignments: UnitMember[];
  invitations: Invitation[];
  events: Event[];
}
export interface Identity {
  id: string;
  name: string;
  email: string;
  active: boolean;
  verified: boolean;
  organizationIds: string[];
  superAdmin: boolean;
  organizationRole?: "organization-admin" | "member";
}
export const roles = ["organization-owner", "organization-admin", "unit-admin", "unit-user"] as const;
export interface Organization {
  id: string;
  name: string;
  status: "active" | "archived";
}
export function emptyState(org: Organization): OrganizationState {
  return {
    version: 1,
    organizationId: org.id,
    displayName: org.name,
    layerLabel: "Units",
    members: [],
    units: [],
    assignments: [],
    invitations: [],
    events: [],
  };
}
