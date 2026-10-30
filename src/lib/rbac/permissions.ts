export const workspacePermissions = {
  createUnit: 'Create units',
  renameUnit: 'Rename units',
  changeUnitStatus: 'Archive and restore units',
  inviteMembers: 'Invite Unit Members',
  inviteAdmins: 'Invite Unit Admins',
  manageMembers: 'Add and remove Unit Members',
  manageAdmins: 'Assign and remove Unit Admins',
  manageContent: 'Manage unit content in connected applications',
} as const;
export type WorkspacePermission = keyof typeof workspacePermissions;
export type EditableRole = 'organization-admin' | 'unit-admin' | 'unit-user';
export type PermissionGrants = Record<WorkspacePermission, boolean>;
export type RoleGrants = Partial<Record<EditableRole, PermissionGrants>>;
export interface WorkspacePermissionPolicy { roles?: RoleGrants; units?: Record<string, RoleGrants> }
export const editableRoles: EditableRole[] = ['organization-admin', 'unit-admin', 'unit-user'];
export const permissionKeys = Object.keys(workspacePermissions) as WorkspacePermission[];
export function allowedPermissions(role: EditableRole): WorkspacePermission[] {
  if (role === 'organization-admin') return permissionKeys;
  if (role === 'unit-admin') return ['renameUnit', 'changeUnitStatus', 'inviteMembers', 'manageMembers', 'manageContent'];
  return ['manageContent'];
}
export function defaultPermissions(role: EditableRole): PermissionGrants {
  return Object.fromEntries(permissionKeys.map(key => [key, role === 'organization-admin' || (role === 'unit-admin' && ['inviteMembers', 'manageMembers', 'manageContent'].includes(key))])) as PermissionGrants;
}
export function rolePermissions(policy: WorkspacePermissionPolicy | undefined, role: EditableRole, unitId?: string): PermissionGrants {
  return { ...defaultPermissions(role), ...policy?.roles?.[role], ...(unitId ? policy?.units?.[unitId]?.[role] : {}) };
}
export function validGrants(value: unknown, role: EditableRole): value is PermissionGrants {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const grants = value as Record<string, unknown>;
  return Object.keys(grants).length === permissionKeys.length && permissionKeys.every(key => typeof grants[key] === 'boolean' && (!grants[key] || allowedPermissions(role).includes(key)));
}
export function validPermissionPolicy(value: unknown, unitIds: string[]): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const policy = value as Record<string, unknown>;
  if (Object.keys(policy).some(key => !['roles', 'units'].includes(key))) return false;
  const validRoles = (v: unknown, unit: boolean) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([role, grants]) => editableRoles.includes(role as EditableRole) && (!unit || role !== 'organization-admin') && validGrants(grants, role as EditableRole));
  return (policy.roles === undefined || validRoles(policy.roles, false)) &&
    (policy.units === undefined || (!!policy.units && typeof policy.units === 'object' && !Array.isArray(policy.units) && Object.entries(policy.units).every(([id, roles]) => unitIds.includes(id) && validRoles(roles, true))));
}
