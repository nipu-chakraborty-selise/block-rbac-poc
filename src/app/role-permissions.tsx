"use client";
import {useState} from "react";
import {Check, Minus, TableProperties} from "lucide-react";
import {rolePermissions, type WorkspacePermissionPolicy, type WorkspacePermission} from "@/lib/rbac/permissions";
const roleNames = [
  "Platform Super Admin",
  "Organization Owner",
  "Organization Admin",
  "Unit Admin",
  "Unit Member",
  "Membership only",
];

const permissions = [
  ["Access scope", "All configured organizations", "Own company", "Authorized units", "Assigned units", "Assigned units", "Organization only; no units"],
  ["Create units", "Yes", "Yes", "Yes; automatically authorized", "No", "No", "No"],
  ["Rename, archive or restore units", "All units", "Own company", "Authorized units", "No", "No", "No"],
  ["Change organization settings", "Yes", "Yes", "No", "No", "No", "No"],
  ["Invite organization members", "Yes", "Yes", "No", "No", "No", "No"],
  ["Appoint Organization Admins and set authorized units", "Yes", "Yes", "No", "No", "No", "No"],
  ["Invite or assign Unit Admins", "All units", "Own company", "Authorized units", "No", "No", "No"],
  ["Invite, add or remove regular Unit Members", "All units", "Own company", "Authorized units", "Assigned units; regular members only", "No", "No"],
  ["Remove organization membership", "Yes", "Yes", "No", "No", "No", "No"],
  ["Transfer ownership or remove organization workspace", "Yes", "Yes", "No", "No", "No", "No"],
  ["Manage native Blocks IAM roles", "Yes", "No", "No", "No", "No", "No"],
];

const rowPermissions: Record<string, WorkspacePermission[]> = {
  'Create units': ['createUnit'],
  'Rename, archive or restore units': ['renameUnit','changeUnitStatus'],
  'Invite or assign Unit Admins': ['inviteAdmins','manageAdmins'],
  'Invite, add or remove regular Unit Members': ['inviteMembers','manageMembers'],
  'Manage unit content in connected applications': ['manageContent'],
};
export default function RolePermissions({ legacyOrganization, policy, units }: { legacyOrganization: boolean; policy: WorkspacePermissionPolicy; units: {id:string;name:string}[] }) {
  const [scope,setScope]=useState('');
  const rows=[...permissions,['Manage unit content in connected applications','All units','Own company','Authorized units','Assigned units','No','No']].map(row=>{
    const keys=rowPermissions[row[0]];if(!keys)return row;
    const next=[...row];
    for(const [index,role] of ['organization-admin','unit-admin','unit-user'].entries()) {
      const grants=rolePermissions(policy,role as 'organization-admin'|'unit-admin'|'unit-user',scope||undefined);
      const enabled=keys.filter(key=>(legacyOrganization&&role==='organization-admin')||grants[key]);
      next[index+3]=enabled.length===0?'No':enabled.length===keys.length?(role==='organization-admin'?'Authorized units':role==='unit-admin'?'Assigned units':'Assigned units'):enabled.map(key=>key==='inviteMembers'||key==='inviteAdmins'?'Invite only':key==='manageMembers'||key==='manageAdmins'?'Manage assignments only':key==='renameUnit'?'Rename only':'Archive/restore only').join('; ');
      if(row[0]==='Create units'&&enabled.length)next[index+3]='Yes; automatically authorized';
    }
    return next;
  });
  return (
    <section className="role-comparison" aria-labelledby="role-permissions-heading">
      <header className="role-section-heading"><div className="role-section-icon"><TableProperties size={20} aria-hidden="true"/></div><div><span className="role-eyebrow">ACCESS OVERVIEW</span><h2 id="role-permissions-heading">Permissions by role</h2><p>Compare the current permissions across every role.</p></div><span className="role-scope-tag">6 access levels</span></header>
      {legacyOrganization && (
        <p className="rbac-alert" role="note">
          This organization has no recorded owner. Its Organization Admins retain
          legacy access to organization settings, organization membership and all units.
          Organization invitations, ownership transfer and workspace removal still require an owner or platform Super Admin.
        </p>
      )}
      <div className="role-comparison-toolbar"><label>Permission comparison scope <select value={scope} onChange={e=>setScope(e.target.value)}><option value="">Company defaults</option>{units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label><p><span className="role-legend-yes"><Check size={13} aria-hidden="true"/>Allowed within scope</span><span><Minus size={13} aria-hidden="true"/>Not permitted</span></p></div>
      <div className="rbac-panel rbac-permissions-scroll" role="region" aria-label="Role permissions comparison" tabIndex={0}>
        <table aria-label="Role permissions">
          <caption>Current role permissions · {units.find(u=>u.id===scope)?.name||"Company defaults"}</caption>
          <thead><tr><th scope="col">Permission</th>{roleNames.map(role => <th scope="col" key={role}>{role}</th>)}</tr></thead>
          <tbody>{rows.map(([permission, ...values]) => (
            <tr key={permission}>
              <th scope="row">{permission}</th>
              {values.map((value, index) => <td key={roleNames[index]}><span className={value==='No'?'role-cell-denied':'role-cell-allowed'}>{value==='No'?<Minus size={13} aria-hidden="true"/>:<Check size={13} aria-hidden="true"/>}{value}</span></td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="rbac-note">
        Verified signup followed by company creation grants Organization Owner for that company.
        Unit Admins cannot appoint or remove admins. Archived units cannot be used until restored. Management actions also depend on the permission settings shown above.
        Document, template and contract permissions are enforced by the separate application.
      </p>
    </section>
  );
}
