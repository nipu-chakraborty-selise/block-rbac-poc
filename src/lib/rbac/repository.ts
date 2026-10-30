import { AppError } from "../model";
import {validPermissionPolicy} from './permissions';
import {
  BlocksDataRepository,
  type GatewayCollectionContract,
} from "../blocks-data";
import { backendClient, runtimeConfig } from "../blocks-runtime";
import { type OrganizationState, emptyState, type Organization } from "./model";
import contract from "../../../blocks/rbac/contract.json";
export interface SavedState {
  state: OrganizationState;
  revision: string;
  itemId: string;
}
export interface StateRepository {
  load(organizationId: string): Promise<SavedState | undefined>;
  commit(
    state: OrganizationState,
    expected: SavedState | undefined,
  ): Promise<void>;
  remove(organizationId: string, expected: SavedState): Promise<void>;
}
export function validateState(
  value: unknown,
  organizationId: string,
): OrganizationState {
  if (!value || typeof value !== "object")
    throw new AppError(503, "Invalid organization RBAC state.");
  const s = value as OrganizationState;
  if (
    s.version !== 1 ||
    s.organizationId !== organizationId ||
    typeof s.displayName !== "string" ||
    typeof s.layerLabel !== "string" ||
    !Array.isArray(s.units) ||
    !Array.isArray(s.members) ||
    !Array.isArray(s.assignments) ||
    !Array.isArray(s.events) ||
    !Array.isArray(s.invitations)
  )
    throw new AppError(503, "Invalid organization RBAC state.");
  if (
    !validPermissionPolicy(s.permissionPolicy, s.units.map(u => u.id)) || s.units.some(
      (u) =>
        typeof u.id !== "string" ||
        typeof u.name !== "string" ||
        !["active", "archived"].includes(u.status),
    ) ||
    s.members.some(
      (m) =>
        typeof m.userId !== "string" ||
        !["organization-admin", "member"].includes(m.role) ||
        !["active", "removed"].includes(m.status),
    ) ||
    s.members.some(m=>m.managedUnitIds!==undefined&&(!Array.isArray(m.managedUnitIds)||m.managedUnitIds.some(id=>!s.units.some(u=>u.id===id)))) ||
    s.invitations.some(i=>i.managedUnitIds!==undefined&&(!Array.isArray(i.managedUnitIds)||i.managedUnitIds.some(id=>!s.units.some(u=>u.id===id)))) ||
    s.assignments.some(
      (m) =>
        typeof m.userId !== "string" ||
        !s.units.some((u) => u.id === m.unitId) ||
        !["unit-admin", "unit-user"].includes(m.role) ||
        !["active", "removed"].includes(m.status),
    ) ||
    s.invitations.some(i=>
      typeof i.id!=="string" || typeof i.email!=="string" || typeof i.recipientId!=="string" ||
      (i.scope==="organization"
        ? i.unitId!=="" || !["organization-admin","member"].includes(i.role)
        : (i.scope!==undefined&&i.scope!=="unit") || !s.units.some(u=>u.id===i.unitId) || !["unit-admin","unit-user"].includes(i.role))
    ) ||
    new Set(s.units.map((u) => u.id)).size !== s.units.length ||
    (s.ownerId!==undefined && (typeof s.ownerId!=="string" || !s.members.some(m=>m.userId===s.ownerId && m.status==="active" && m.role==="organization-admin"))) ||
    new Set(s.members.map((m) => m.userId)).size !== s.members.length ||
    new Set(s.assignments.map((m) => `${m.unitId}:${m.userId}`)).size !==
      s.assignments.length
  )
    throw new AppError(503, "Inconsistent organization RBAC state.");
  return s;
}
export class MockStateRepository implements StateRepository {
  private rows = new Map<string, SavedState>();
  async load(id: string) {
    const row = this.rows.get(id);
    return row ? structuredClone(row) : undefined;
  }
  async commit(state: OrganizationState, expected: SavedState | undefined) {
    validateState(state, state.organizationId);
    const current = this.rows.get(state.organizationId);
    if (current?.revision !== expected?.revision)
      throw new AppError(409, "Organization changed. Refresh before retrying.");
    this.rows.set(state.organizationId, {
      state: structuredClone(state),
      itemId: state.organizationId,
      revision: String(Number(current?.revision || 0) + 1),
    });
  }
  async remove(organizationId: string, expected: SavedState) {
    const current = this.rows.get(organizationId);
    if (!current || current.revision !== expected.revision)
      throw new AppError(409, "Organization changed. Refresh before retrying.");
    this.rows.delete(organizationId);
  }
}
/** Shared mock org-state store so invitation preview/activate see the same invites as the portal. */
export const sharedMockRepository = new MockStateRepository();
export function liveStateRepository(): StateRepository {
  const spec = contract as Partial<GatewayCollectionContract>;
  if (!spec.schemaName)
    throw new AppError(
      503,
      "The organization/unit RBAC schema is awaiting approved Blocks setup. No mock fallback was used.",
    );
  const client = backendClient(),
    config = runtimeConfig(),
    repository = new BlocksDataRepository(
      {
        apiUrl: config.apiUrl,
        xBlocksKey: config.projectKey,
        accessToken: () => client.auth.accessToken(),
      },
      { rbacState: spec as GatewayCollectionContract },
    );
  const api: StateRepository = {
    async load(organizationId) {
      const result = await repository.list("rbacState", {
        page: 1,
        pageSize: 2,
        filter: { organizationKey: organizationId },
      });
      if (result.total > 1)
        throw new AppError(503, "Duplicate organization state records.");
      const row = result.items[0];
      if (!row) return;
      if (row.record.organizationKey !== organizationId || !row.revision)
        throw new AppError(503, "Organization state revision is unavailable.");
      let state;
      try {
        state = JSON.parse(row.record.stateJson);
      } catch {
        throw new AppError(503, "Cannot parse organization RBAC state.");
      }
      return {
        state: validateState(state, organizationId),
        revision: row.revision,
        itemId: row.itemId,
      };
    },
    async commit(state, expected) {
      validateState(state, state.organizationId);
      const stateJson = JSON.stringify(state);
      if (Buffer.byteLength(stateJson) > 750000)
        throw new AppError(409, "Organization RBAC state capacity reached.");
      const record = {
        id: state.organizationId,
        organizationKey: state.organizationId,
        stateJson,
      };
      if (expected)
        await repository.compareAndSet(
          "rbacState",
          expected.itemId,
          record,
          expected.revision,
        );
      else await repository.create("rbacState", record);
    },
    async remove(organizationId, expected) {
      const current = await api.load(organizationId);
      if (!current || current.revision !== expected.revision)
        throw new AppError(409, "Organization changed. Refresh before retrying.");
      await repository.remove("rbacState", expected.itemId);
    },
  };
  return api;
}
export function legacyImport(
  org: Organization,
  departments: { id: string; name: string; status: "active" | "archived" }[],
  groups: {
    id: string;
    name: string;
    status: "active" | "archived";
    departmentId: string;
  }[],
): OrganizationState {
  const state = emptyState(org);
  state.units = departments.map((d) => ({ ...d, id: `department:${d.id}` }));
  for (const group of groups) {
    const parent = departments.find((d) => d.id === group.departmentId);
    if (!parent) throw new AppError(422, "Legacy group has no parent.");
    state.units.push({
      id: `group:${group.id}`,
      name: `${parent.name} / ${group.name}`,
      status: parent.status === "archived" ? "archived" : group.status,
    });
  }
  // Memberships are deliberately not copied: old permissions inherit through parents.
  // Every new fixed role must be explicitly assigned after reviewing the flattened units.
  return state;
}
