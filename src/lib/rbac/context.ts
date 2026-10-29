import {organizationDirectory} from './directory';
import { createHash } from "node:crypto";
import { application } from "../http";
import { mode } from "../adapters";
import { liveSession, verifyIdentity } from "../live-auth";
import { liveRepository } from "../live-workspace";
import { backendClient, userClient } from "../blocks-runtime";
import { AppError, type User } from "../model";
import { type Identity, type Organization, emptyState } from "./model";
import {
  sharedMockRepository,
  liveStateRepository,
  type StateRepository,
} from "./repository";
import rbacContract from "../../../blocks/rbac/contract.json";
import type { MemoryStore } from "../store";
import { provisionUser } from "../live-users";
const mockRepository = sharedMockRepository;
let initializing: Promise<void> | undefined;
export interface Context {
  actor: Identity;
  organizations: Organization[];
  repository: StateRepository;
  ready: boolean;
  assignableRoles:()=>Promise<unknown>;
  cookie?: string;
  issuer: (id: string, organizationId: string) => Promise<Identity | undefined>;
  directory: (id: string) => Promise<Identity[]>;
  findAccount: (email: string) => Promise<Identity | undefined>;
  joinOrganization: (id: string) => Promise<void>;
  legacy: (id: string) => Promise<{
    departments: import("../model").Department[];
    groups: import("../model").Group[];
  }>;
}
const identity = (user: User, superAdmin: boolean): Identity => ({
  id: user.id,
  name: user.name,
  email: user.email,
  active: true,
  verified: user.verified,
  organizationIds: user.countryIds,
  superAdmin,
});
export async function rbacContext(req: Request): Promise<Context> {
  if (mode() === "mock") {
    const app = application(),
      store = app.store as MemoryStore;
    const token = req.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("poc_session="))
      ?.slice(12);
    const session = token
      ? store.session(createHash("sha256").update(token).digest("hex"))
      : undefined;
    const user = app.auth.identity(session?.userId);
    const organizations = store
      .all("countries")
      .map((c) => ({ id: c.id, name: c.name, status: c.status }));
    initializing ||= (async () => {
      for (const org of organizations) {
        const state = emptyState(org);
        state.members = store
          .all("users")
          .filter((u) => u.countryIds.includes(org.id))
          .map((u) => ({
            userId: u.id,
            role:
              (org.id === "bd" && u.id === "hr-admin") ||
              (org.id === "de" && u.id === "germany-admin") ||
              (org.id === "np" && u.id === "super")
                ? ("organization-admin" as const)
                : ("member" as const),
            status: "active" as const,
          }));
        state.units = store
          .all("departments")
          .filter((d) => d.countryOrganizationId === org.id)
          .map((d) => ({ id: d.id, name: d.name, status: d.status }));
        state.assignments = store
          .all("memberships")
          .filter(
            (m) =>
              m.countryOrganizationId === org.id &&
              m.scopeType === "department",
          )
          .map((m) => ({
            userId: m.userId,
            unitId: m.scopeId,
            role: "unit-admin" as const,
            status: "active" as const,
          }));
        if (org.id === "bd") {
          state.assignments.push(
            {
              userId: "recruit-admin",
              unitId: "hrm",
              role: "unit-admin",
              status: "active",
            },
            {
              userId: "recruit-member",
              unitId: "hrm",
              role: "unit-user",
              status: "active",
            },
          );
        }
        if (!(await mockRepository.load(org.id)))
          await mockRepository.commit(state, undefined);
      }
    })();
    await initializing;
    return {
      actor: identity(user, app.auth.super(user)),
      organizations,
      repository: mockRepository,
      ready: true,
      assignableRoles:async()=>[],
      findAccount: async (email) => {
        const found=store.all("users").find(u=>u.email.toLowerCase()===email);
        return found ? identity(found,app.auth.super(found)) : undefined;
      },
      joinOrganization: async (id) => {
        const current=store.get("users",user.id)!;
        store.put("users",{...current,countryIds:[...new Set([...current.countryIds,id])]});
      },
      issuer: async (id) => {
        const u = store.get("users", id);
        return u ? identity(u, app.auth.super(u)) : undefined;
      },
      directory: async (id) =>
        store
          .all("users")
          .filter((u) => u.countryIds.includes(id))
          .map((u) => identity(u, app.auth.super(u))),
      legacy: async (id) => ({
        departments: store
          .all("departments")
          .filter((d) => d.countryOrganizationId === id),
        groups: store
          .all("groups")
          .filter((g) => g.countryOrganizationId === id),
      }),
    };
  }
  const bearer = req.headers.get("authorization");
  const session = bearer?.startsWith("Bearer ")
    ? undefined
    : await liveSession(req);
  const user = bearer?.startsWith("Bearer ")
    ? await verifyIdentity(bearer.slice(7))
    : session!.user;
  if (!user.verified)
    throw new AppError(403, "An active, verified account is required.");
  const repo = liveRepository();
  async function all<
    K extends "countryMetadata" | "admins" | "departments" | "groups",
  >(table: K, organizationId?: string) {
    const rows = [];
    let page = 1,
      count = 0,
      total = 0;
    do {
      const batch = await repo.list(table, {
        page,
        pageSize: 100,
        filter: organizationId
          ? { countryOrganizationId: organizationId }
          : undefined,
      });
      rows.push(...batch.items.map((r) => r.record));
      total = batch.total;
      count += batch.items.length;
      if (total > 10000 || (!batch.items.length && count < total))
        throw new AppError(503, "Cannot completely load organization records.");
      page++;
    } while (count < total);
    return rows;
  }
  const [metadata, admins] = await Promise.all([
    all("countryMetadata"),
    all("admins"),
  ]);
  const superAdmin = admins.some((a) => a.userId === user.id),
    iam = backendClient().iam;
  const organizations = await Promise.all(
    metadata.map(async (meta) => {
      const response = await iam.organizations.get(meta.countryOrganizationId);
      const org = (response.organization || response.data) as
        Record<string, unknown> | undefined;
      if (
        response.isSuccess === false ||
        org?.itemId !== meta.countryOrganizationId
      )
        throw new AppError(503, "Organization cannot be verified with IAM.");
      return {
        id: meta.countryOrganizationId,
        name: meta.displayName,
        status: org.isDisabled === true ? ("archived" as const) : meta.status,
      };
    }),
  );
  async function directory(id: string) {
    return organizationDirectory(iam.users,id,admins);
  }
  return {
    actor: identity(user, superAdmin),
    organizations,
    cookie: session?.cookie,
    ready: Boolean((rbacContract as { schemaName?: string }).schemaName),
    assignableRoles:()=>userClient(bearer?.startsWith('Bearer ')?bearer.slice(7):session!.session.access).iam.roles.assignable(),
    async findAccount(email) {
      const result=await iam.users.list({page:0,pageSize:100,filter:{email}});
      if(result.isSuccess===false || !Array.isArray(result.data) || Number(result.totalCount)>100)
        throw new AppError(503,"Blocks account lookup unavailable.");
      const matches=result.data.filter(u=>u.email?.toLowerCase()===email);
      if(matches.length>1)throw new AppError(422,"Multiple accounts match this email.");
      const found=matches[0];
      if(!found?.itemId)return undefined;
      return {id:found.itemId,email:found.email!,name:[found.firstName,found.lastName].filter(Boolean).join(" ")||email,active:found.active===true,verified:found.isVerified===true,organizationIds:[],superAdmin:admins.some(a=>a.userId===found.itemId)};
    },
    async joinOrganization(id) {
      const joined=await provisionUser(id,{email:user.email,accountMode:"existing"});
      if(joined.id!==user.id)throw new AppError(403,"Invitation account changed.");
    },
    async issuer(id, organizationId) {
      const member = (await directory(organizationId)).find((u) => u.id === id);
      if (member) return member;
      if (!admins.some((a) => a.userId === id)) return undefined;
      try {
        const user = (await iam.users.get(id)).data;
        if (!user?.itemId) return undefined;
        return {
          id: user.itemId,
          name:
            [user.firstName, user.lastName].filter(Boolean).join(" ") ||
            user.email ||
            id,
          email: user.email || "",
          active: user.active === true,
          verified: user.isVerified === true,
          organizationIds: [],
          superAdmin: true,
        };
      } catch {
        return undefined;
      }
    },
    repository: {
      load: async (id) => liveStateRepository().load(id),
      commit: async (state, expected) =>
        liveStateRepository().commit(state, expected),
      remove: async (id, expected) => liveStateRepository().remove(id, expected),
    },
    directory,
    async legacy(id) {
      const [departments, groups] = await Promise.all([
        all("departments", id),
        all("groups", id),
      ]);
      return { departments, groups };
    },
  };
}
