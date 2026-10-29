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

export default function RolePermissions({ legacyOrganization }: { legacyOrganization: boolean }) {
  return (
    <section aria-labelledby="role-permissions-heading">
      <h2 id="role-permissions-heading">Permissions by role</h2>
      <p className="rbac-note">
        Organization Admins manage owner-authorized units and units they create.
        A person can have different roles in different units. Membership alone grants no unit access.
      </p>
      {legacyOrganization && (
        <p className="rbac-alert" role="note">
          This organization has no recorded owner. Its Organization Admins retain
          legacy access to organization settings, organization membership and all units.
          Organization invitations, ownership transfer and workspace removal still require an owner or platform Super Admin.
        </p>
      )}
      <div className="rbac-panel rbac-permissions-scroll" role="region" aria-label="Role permissions comparison" tabIndex={0}>
        <table aria-label="Role permissions">
          <caption>Permissions for companies with an Organization Owner</caption>
          <thead><tr><th scope="col">Permission</th>{roleNames.map(role => <th scope="col" key={role}>{role}</th>)}</tr></thead>
          <tbody>{permissions.map(([permission, ...values]) => (
            <tr key={permission}>
              <th scope="row">{permission}</th>
              {values.map((value, index) => <td key={roleNames[index]}>{value}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="rbac-note">
        Verified signup followed by company creation grants Organization Owner for that company.
        Unit Admins cannot appoint or remove admins. Archived units cannot be used until restored.
        Document, template and contract permissions are enforced by the separate application.
      </p>
    </section>
  );
}
