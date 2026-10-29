import { PERMISSIONS, type Permission } from "./model";
import type { HierarchyStore } from "./store";
export const PROJECT_ID = "rbac-poc";
export function seed(store: HierarchyStore) {
  if (store.all("users").length) return;
  store.transaction(() => {
    const now = new Date().toISOString();
    for (const [id, name, code] of [
      ["bd", "Bangladesh", "BD"],
      ["de", "Germany", "DE"],
      ["np", "Nepal", "NP"],
    ])
      store.put("countries", { id, name, code, status: "active" });
    const users = [
      ["super", "Alex Morgan", "Application super-admin", ["bd", "de", "np"]],
      ["hr-admin", "Ayesha Rahman", "Bangladesh HRM admin", ["bd"]],
      ["recruit-admin", "Farhan Ahmed", "Recruitment group admin", ["bd"]],
      ["recruit-member", "Nadia Islam", "Recruitment member", ["bd"]],
      ["payroll-member", "Rafiq Hasan", "Payroll member", ["bd"]],
      ["germany-admin", "Lena Weber", "Germany HRM admin", ["de"]],
      ["unassigned", "Sam Taylor", "No assignments", ["bd"]],
    ] as const;
    for (const [id, name, , countryIds] of users)
      store.put("users", {
        id,
        name,
        email: `${id}@demo.local`,
        verified: true,
        projectId: PROJECT_ID,
        countryIds: [...countryIds],
      });
    store.put("admins", {
      id: "bootstrap-super",
      userId: "super",
      grantedBy: "explicit-seed-provisioning",
      createdAt: now,
    });
    for (const [id, countryOrganizationId, name] of [
      ["hrm", "bd", "HRM"],
      ["legal", "bd", "Legal"],
      ["de-hrm", "de", "HRM"],
      ["technical", "np", "Technical Team"],
    ])
      store.put("departments", {
        id,
        countryOrganizationId,
        name,
        status: "active",
        createdBy: "super",
        createdAt: now,
        updatedAt: now,
      });
    for (const [id, departmentId, name] of [
      ["recruitment", "hrm", "Recruitment"],
      ["payroll", "hrm", "Payroll"],
      ["contract", "legal", "Contract Review"],
    ])
      store.put("groups", {
        id,
        departmentId,
        countryOrganizationId: "bd",
        name,
        status: "active",
        createdBy: "super",
        createdAt: now,
        updatedAt: now,
      });
    const admin = PERMISSIONS.filter((p) => p !== "department.create");
    const group = PERMISSIONS.filter(
      (p) => !p.startsWith("department.") && p !== "group.create",
    );
    const member: Permission[] = ["group.view", "resource.view"];
    for (const countryOrganizationId of ["bd", "de", "np"])
      for (const [key, name, permissions, delegablePermissions] of [
        ["dept", "Department admin", admin, admin],
        ["group", "Group admin", group, member],
        ["member", "Member", member, []],
      ] as const)
        store.put("roles", {
          id: `${countryOrganizationId}-${key}`,
          countryOrganizationId,
          name,
          permissions: [...permissions],
          delegablePermissions: [...delegablePermissions],
        });
    for (const [userId, countryOrganizationId, scopeType, scopeId, roleId] of [
      ["hr-admin", "bd", "department", "hrm", "bd-dept"],
      ["recruit-admin", "bd", "group", "recruitment", "bd-group"],
      ["recruit-member", "bd", "group", "recruitment", "bd-member"],
      ["payroll-member", "bd", "group", "payroll", "bd-member"],
      ["germany-admin", "de", "department", "de-hrm", "de-dept"],
    ] as const)
      store.put("memberships", {
        id: `m-${userId}`,
        userId,
        countryOrganizationId,
        scopeType,
        scopeId,
        roleId,
        status: "active",
      });
    for (const [
      id,
      countryOrganizationId,
      departmentId,
      groupId,
      title,
      content,
    ] of [
      [
        "r-recruit",
        "bd",
        "hrm",
        "recruitment",
        "Recruitment handbook",
        "Interview stages, candidate scorecards, and onboarding guidelines for the Recruitment team.",
      ],
      [
        "r-payroll",
        "bd",
        "hrm",
        "payroll",
        "Payroll processing checklist",
        "Confidential payroll approval workflow. Visible only within the Payroll scope.",
      ],
      [
        "r-germany",
        "de",
        "de-hrm",
        null,
        "Germany HR operations",
        "Local onboarding and HR operations for the Germany organization.",
      ],
    ] as const)
      store.put("resources", {
        id,
        countryOrganizationId,
        departmentId,
        groupId,
        title,
        content,
        createdBy: "super",
      });
    store.put("audit", {
      id: "seed-event",
      actorId: "super",
      action: "workspace.provisioned",
      countryOrganizationId: "bd",
      scopeId: "hrm",
      targetId: "rbac-poc",
      timestamp: now,
    });
  });
}
