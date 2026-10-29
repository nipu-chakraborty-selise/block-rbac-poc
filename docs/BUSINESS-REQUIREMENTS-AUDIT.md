# Business requirements audit — 14 October 2026

Historical snapshot before the RBAC-only rebuild. The current organization/unit implementation and its pending live setup are documented in [RBAC.md](RBAC.md). Template/contract features were excluded at the user’s request.

**Verdict: the current application does not fully implement the PDF and is not ready to accept as the Legal Template Generator.** It is an RBAC infrastructure POC with live Blocks IAM and Data Gateway integration. Passing its current tests does not establish compliance with the newly supplied requirements.

Source: `/Users/nipu/Downloads/Legal_Template_Generator_Roles_Simple.pdf` (all three pages read as text and visually inspected).

The document was used as the acceptance checklist, not as permission to change the application or cloud tenant. No application behavior, cloud settings, live memberships, or business records were changed during this audit. Audit scripts and reports were added locally. Existing browser tests refresh their screenshot artifacts.

## Requirement-by-requirement findings

Status meanings: **Present** = implemented for the current resource/RBAC model; **Partial** = some behavior exists, with a gap or incomplete live evidence; **Mismatch** = current behavior conflicts with the PDF; **Missing** = no corresponding application workflow/model.

| PDF requirement | Status | Finding |
|---|---|---|
| Organization name configurable | Partial | Global application super-admin can edit the app display name. A separate organization-limited admin does not exist; the label does not rename the IAM organization. |
| Choose layer label: Units, Departments, Teams, etc. | Missing | Departments/groups are hard-coded. No layer-label setting or schema field. |
| Exactly one unit layer under an organization | Mismatch | Country → Department → Group is implemented; department permissions inherit into groups. The PDF reserves nested units for later. |
| Create multiple units | Partial | Department/group CRUD exists. Only global super-admin creates departments, rather than a country Organization Admin. The POC also imposes a 10,000-record read ceiling per collection. |
| A person belongs to multiple units with different roles | Present | ScopeMembership carries a separate role per user/country/scope. Unique tuple index prevents duplicate scoped rows. Live ordinary-user login and switching coverage is incomplete. |
| Three fixed roles: Organization Admin, Unit Admin, Unit User | Mismatch | Application super-admin, department admin, group admin/member and editable custom roles are implemented. No organization-level application-admin role exists. A global super-admin can remain as a separate platform role, but cannot substitute for an organization-limited admin. |
| Organization Admin manages only their own organization | Missing | Scoped admins have department/group authority; explicit application super-admin has cross-country authority. Neither matches the required country-wide, country-limited role. |
| Only Organization Admin creates, renames and archives units | Mismatch | Creation is super-admin-only for departments. Department admins can rename/archive their own department and create nested groups. Executable probes reproduced rename/archive acceptance. |
| Unique unit names inside the organization | Missing | No service uniqueness validation or unit-name index. A duplicate HRM was accepted in an isolated probe. Membership uniqueness is a different constraint. |
| Renaming preserves permissions | Present | Rename retains scope ID; memberships reference that ID. This does not fix who is allowed to rename. |
| Only Organization Admin appoints/removes admins | Mismatch | There is no fixed-role classification or target-admin removal guard. A department admin assigned an admin role to a member; a group admin removed another group admin in isolated probes. |
| Unit Admin adds/removes regular users only in their unit | Partial | Scoped removal is implemented, but admin targets are not protected. Direct existing-user addition is restricted to global super-admin. Live invitations are disabled. |
| Add an existing member with immediate scoped access | Partial | Super-admin Add user implements this through IAM membership and scoped Data rows. Ordinary unit admins cannot directly add an existing member. End-to-end live write verification remains incomplete; mock browser coverage passes. |
| Invite new users by email; grant access after valid acceptance | Missing in live | Live invitation create/accept returns 503. Mock acceptance checks recipient, expiry, revocation, current inviter authority and duplicate membership. New account creation with an admin-set password is a different workflow and does not satisfy invitation acceptance. |
| Unassigned organization members have no private template access | Partial | Zero resource access is verified for an unassigned member. Actual templates do not exist. |
| Organization Admin sees/manages all active units and templates | Partial | Global super-admin sees all active hierarchy/resources in a selected country. The required organization-limited admin and actual template library are missing. |
| Unit selector, lists and search expose permitted content only | Partial | Resource lists are backend-filtered and search operates on that filtered data. Template library/selector and draft-aware template search are missing. |
| Unit User sees published templates; admins also see drafts | Missing | DemoResource has no draft/published state. Current members can read any permitted resource content. |
| Required no-assignment message | Partial | Access-denied/empty-state screens exist, but use wording such as “No resource access”; the PDF's unit assignment message is not implemented. |
| Create or upload a template belonging to exactly one unit | Missing | Only title/text resource editing exists. There is no legal Template entity, file upload UI, document parsing, or unit-template ownership model. |
| Save Draft, then Publish | Missing | No lifecycle fields, publish action, transition validation or role-sensitive draft visibility. |
| Archive templates to stop new use while preserving contracts | Missing | Resources are hard-deleted. There is no template archive state or contract snapshot/version relationship. |
| Use a published template to create a separate contract after checking current access | Missing | No contract model, generation endpoint, rendering workflow or template-use action. |
| Template access must not expose other users' contracts | Missing | Separate contract ownership/ACLs are not implemented. There are no contracts to exercise this rule against. |
| Removing unit access revokes that unit immediately and retains other memberships | Present for resources | Scoped membership is archived individually and authorization uses active memberships. Existing tests cover immediate denial and unaffected other scopes. Live request projections reload records; no live ordinary-user revocation test was performed in this audit. |
| Removing organization membership revokes every unit | Partial | Ordinary-user requests re-read IAM organization membership, then require the selected country. There is no organization-member removal UI/endpoint and the full IAM removal-to-app-denial flow is unverified. Super-admin bypass is a separate platform authority. |
| Backend checks lists, search, previews, downloads, direct links and every change | Partial | Current resource/hierarchy endpoints enforce backend scope checks and changed-ID denial. Template preview/download/generation routes are absent and therefore cannot be considered protected or tested. |
| Separate organizations; reject inactive users/disabled organizations | Present in code, partial live coverage | Country checks reject cross-country access; IAM identity verification requires active account and verified identity; IAM country disabled state is reflected in the projection. Current tests/read-only checks pass. Live deactivate/disable/revoke scenarios were not exercised. |
| Archived units unusable, retained and restorable by Organization Admin | Partial | Archive retains records and blocks access to archived parents/descendants. No restore endpoint/UI exists; PATCH of an archived unit is rejected even for super-admin. |
| Keep at least one active Organization Admin | Missing | No organization-admin model, assignment/removal workflow, or last-active-admin invariant. The existing global admin grant is not a substitute. |
| Record actor for role/member/template changes | Partial | AuditEvent records actor/action/target and intent records precede live mutations. Existing role/member/resource auditing is implemented; actual template events are absent. Multi-service writes can leave pending intents. Scoped admins see their own events rather than an organization-wide admin log. |
| First release excludes custom roles, nesting and cross-unit template sharing | Mismatch | Custom roles and nested groups already exist. Cross-unit legal-template sharing is absent, but legal templates themselves are also absent. |

## Verification performed today

- **34 backend/unit tests pass**, including scope isolation, delegation, invitation mock acceptance, session/state handling, Gateway contracts and IAM provisioning fake-transport cases.
- **Six Playwright browser tests pass**, using mock mode: hierarchy/country navigation, scoped identities, nested group creation, mock invitations, responsive layout, and super-admin Add user. These are not six live business acceptance tests.
- **TypeScript, ESLint and production build pass.**
- Fresh backend SDK reads successfully loaded all three live IAM countries and their directories. Visible hierarchy: Bangladesh 3 departments/4 groups, Germany 1 department/0 groups, Nepal 1 department/0 groups. Directory output includes the verification operator projected into the workspace, so its count is not a count of newly provisioned real users.
- Fresh Blocks CLI schema read shows **nine schemas**, with **no Template or Contract schema**: ApplicationAdminGrant, AuditEvent, CountryMetadata, DemoResource, Department, Group, Invitation, ScopeMembership, ScopedRole.
- Blocks CLI returned one storage configuration. Upload/download authorization or persistence was not tested. No workflow was returned by the workflow list query.
- Eight isolated in-memory business-rule probes ran: six mismatches and two conforming checks. See `business-requirements-probes.json`; the executable reproduction is `../scripts/audit-business-requirements.ts`.
- Prior 13 October evidence records live Gateway CRUD/CAS, anonymous denial and actual hosted OIDC login. Those write/login tests were **not rerun** today. New IAM account activation, empty-role country grants, refresh and ordinary-user organization switching remain incompletely verified. Permission assignment readback alone does not prove write-endpoint operation.

## Blocks OS capabilities and limitations

**No verified Blocks OS limitation requires SQLite or an external SQL database for this business model.** The missing legal-template and contract flows are application/schema work, not demonstrated platform impossibilities. Current persistence is Blocks Data Gateway; request-local memory is only an authorization projection. Development mock mode uses process memory.

1. **Records and uniqueness:** Data Gateway exposes schema-based GraphQL reads/mutations. The installed Blocks CLI supports compound unique indexes. Organization/unit name uniqueness can be implemented with a normalized-name field and an appropriate country/name unique constraint; it is not blocked by the platform. Such changes have not been applied in this audit. [Official Data Gateway reference](https://docs.seliseblocks.com/reference/data-gateway/).
2. **Uploads/downloads:** Blocks documents signed upload and short-lived download URLs, using configured storage backends such as Azure Blob or AWS S3. One storage configuration exists in this tenant, but private file ACLs and download revocation need verification. Backend authorization must precede issuing a URL; an already-issued URL may remain usable for its lifetime, so strict immediate revocation requires a deliberate expiry/proxy design. Object storage is distinct from an external application database. [Official Storage reference](https://docs.seliseblocks.com/reference/storage/).
3. **Invitations/account activation:** Blocks documents activation using an invitation code. The app currently blocks live invitations because delivery plus safe scoped activation has not been implemented/verified. This is an integration gap, not proof that Blocks cannot support invitations. [Official Authentication reference](https://docs.seliseblocks.com/reference/authentication/).
4. **Atomic multi-record/multi-service changes:** The current adapter performs separate IAM/Data operations and sequential Data writes. CAS and a unique membership index do not make them atomic. A verified transaction/workflow or idempotent recoverable state machine is needed for invitation redemption, contract creation, and last-admin changes. CLI workflow commands exist, but no workflow transaction guarantee was established. Do not treat lack of a helper in this SDK as proof the platform lacks the capability.
5. **Document generation:** No legal document renderer or generation integration is implemented. Storage can hold files; that is not evidence of a ready-made legal template engine. A renderer can be application code or a verified service, while metadata remains in Blocks. Output formats/merge fields are not specified in this PDF.
6. **Permission granularity:** Built-in IAM Manage Users grants broad user-management capability to the server credential. PDF unit roles are custom application rules; the backend must enforce them before using IAM or Data. The previously approved permission does not automatically implement the PDF's delegation policy.
7. **Scale:** Loading every collection on each request with a 10,000-record limit is a POC design limitation, not a verified Blocks service limit. Targeted, paginated repositories are required before larger deployment.

## Implementation order to meet the document

1. Add a country-limited Organization Admin role alongside the existing platform super-admin; enforce three fixed business roles and their member-management rules.
2. Use one Unit layer with configurable label, normalized unique names, archive/restore and a safe last-active-organization-admin invariant. Reconcile/migrate existing departments/groups rather than silently deleting them.
3. Implement Template and Contract models: private uploads, draft/publish/archive, template version snapshot, generated contract ownership/ACLs, authorized preview/download/use.
4. Implement existing-member addition for Unit Admin (regular-user role only), invitation delivery/acceptance and organization removal with recoverable multi-service operations.
5. Run live acceptance tests with Organization Admin, Unit Admin, Unit User and unassigned accounts across organizations; verify drafts, direct URLs, downloads, deactivation, membership removal and concurrent admin/invitation changes.

The earlier accepted global super-admin and country-membership-only behavior can remain, but country membership is not the same as the new PDF's Organization Admin authority. No business-model migration was made as part of this verification request.
