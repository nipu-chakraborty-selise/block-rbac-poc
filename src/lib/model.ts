export const PERMISSIONS = [
  "department.view",
  "department.create",
  "department.update",
  "department.archive",
  "group.view",
  "group.create",
  "group.update",
  "group.archive",
  "member.invite",
  "member.remove",
  "member.assign-role",
  "resource.view",
  "resource.create",
  "resource.update",
  "resource.delete",
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export type Status = "active" | "archived";
export type ScopeType = "department" | "group";
export interface Country {
  id: string;
  name: string;
  code: string;
  status: Status;
}
export interface User {
  id: string;
  name: string;
  email: string;
  verified: boolean;
  projectId: string;
  countryIds: string[];
}
export interface Department {
  id: string;
  countryOrganizationId: string;
  name: string;
  status: Status;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
export interface Group extends Department {
  departmentId: string;
}
export interface ScopedRole {
  id: string;
  countryOrganizationId: string;
  name: string;
  permissions: Permission[];
  delegablePermissions: Permission[];
}
export interface ScopeMembership {
  id: string;
  userId: string;
  countryOrganizationId: string;
  scopeType: ScopeType;
  scopeId: string;
  roleId: string;
  status: Status;
}
export interface Invitation {
  id: string;
  email: string;
  countryOrganizationId: string;
  scopeType: ScopeType;
  scopeId: string;
  roleId: string;
  signupLinkId: string | null;
  invitedBy: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  acceptedBy: string | null;
  acceptedAt: string | null;
}
export interface DemoResource {
  id: string;
  countryOrganizationId: string;
  departmentId: string;
  groupId: string | null;
  title: string;
  content: string;
  createdBy: string;
}
export interface AuditEvent {
  id: string;
  actorId: string;
  action: string;
  countryOrganizationId: string;
  scopeId: string;
  targetId: string;
  timestamp: string;
}
export interface AdminGrant {
  id: string;
  userId: string;
  grantedBy: string;
  createdAt: string;
}
export interface CountryMetadata {id:string;countryOrganizationId:string;countryCode:string;displayName:string;status:Status}
export interface RbacStateRecord {id:string;organizationKey:string;stateJson:string}
export interface Tables {
  rbacState:RbacStateRecord;
  countryMetadata:CountryMetadata;
  countries: Country;
  users: User;
  departments: Department;
  groups: Group;
  roles: ScopedRole;
  memberships: ScopeMembership;
  invitations: Invitation;
  resources: DemoResource;
  audit: AuditEvent;
  admins: AdminGrant;
}
export type Table = keyof Tables;
export interface Scope {
  countryId: string;
  type: ScopeType;
  id: string;
}
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
