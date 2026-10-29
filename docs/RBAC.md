# Organization and unit RBAC — 29 October 2026

This app manages RBAC only. Templates, contracts and document processing belong to the separate application. There is one unit layer with Organization Owner, Organization Admin, Unit Admin and Unit User authority. The existing explicit application super-admin remains a separate platform authority.

| Role | Authority |
|---|---|
| Organization Owner | Automatic after verified signup and company creation. Manages all company units and members; appoints Organization Admins and selects their authorized units. |
| Organization Admin | Creates units and manages/invites members only in owner-authorized units or units they create. Cannot appoint Organization Admins or change company settings. |
| Unit Admin | Assigned unit only; add/remove regular Unit Users and create their unit invitation links. Cannot change units or appoint/remove admins. |
| Unit User | Assigned units only; no member administration. |

Organization membership alone grants no unit access. A person may hold a different role in every unit. There are no custom business roles or nested-unit inheritance. Each request validates the IAM identity, active organization, membership and fixed role in the backend.

## Included controls

- Super-admin organization creation, explicit first-admin setup, and access to all configured organizations.
- Organization display name and configurable layer label (Units, Departments, Teams, etc.). Display names are stored with RBAC state; IAM organization IDs remain stable.
- Create/rename/archive/restore independent units. Names are unique within the organization after Unicode normalization, whitespace normalization and case folding, including archived units. Renaming preserves IDs and memberships.
- Organization Owner or platform Super Admin can add organization members, appoint Organization Admins and choose their authorized units. Organization Admins manage unit memberships only within authorized units.
- Assign Unit Admin/Unit User; Unit Admin can assign only regular Unit Users and cannot change existing admin targets.
- Unit removal preserves other memberships. Organization removal atomically removes all app RBAC assignments and revokes affected pending invitation links. It does not delete the IAM account or revoke access in unrelated applications.
- Last Organization Admin removal/demotion is rejected. Concurrent changes use a single-record compare-and-set, so two admins cannot both demote the other using an old revision.
- Invitations for **existing accounts and new email addresses**: one-time high-entropy links, hashed token storage, fragment token URLs for copied/in-app links (email uses `/invite/continue` then moves the token into the fragment client-side because many mail clients strip `#...`), seven-day expiry, bound recipient ID/email, current inviter-authority checks, revocation and atomic acceptance. Super Admins can invite at organization scope as Organization Admin or membership-only, and at unit scope as Unit Admin or Unit User. Organization invitations grant the selected organization role without individual unit assignments. Unit invitations add IAM organization membership plus app membership-only access and the invited unit assignment. Unit Admins may invite outsiders as Unit Users, but cannot appoint admins. After the state commit, the app sends the link with Blocks Mail using AtlasUnitInvitation. Mail failures are reported with a manual-copy fallback; queued does not mean inbox delivery is confirmed. New recipients use hosted Blocks signup and verification, then accept the stored role. New-address invitations bind to the first verified account with that exact email; existing-account invitations also bind the original IAM ID. Super-admin direct account provisioning uses an initial password and the existing Blocks IAM integration. Live CLI creation, activation and password login were verified for twelve user-approved test accounts on October 14; activation requires a reason, which the app now supplies and its provisioning regression test checks.
- Organization/unit lists and directory visibility follow current roles. Unassigned members see the required contact-your-administrator message. Archived units are inaccessible until restored.
- Actor/action/target activity records commit with the same state update. The UI shows the latest 100 visible events; Organization Admin sees organization events, other users their own events.

## Storage and concurrency

The new `OrganizationRBACState` Entity schema stores `id`, `organizationKey` and `stateJson`. A unique index on organizationKey guarantees one state per organization. Unit names, memberships, admin counts, invitations and audit events are updated together in a single versioned record. The verified Gateway typed LastUpdatedDate predicate rejects stale writes. Clients must refresh after HTTP 409; stale changes are not retried blindly.

No SQLite or external SQL database is used. Live mode has no mock fallback. Mock mode explicitly uses process memory and is available only through the development identity selector.

This initial implementation bounds each organization to 300 units, 1,000 member records, 2,000 retained events and a 750 KB serialized state. Capacity errors stop further writes rather than discard data. Larger installations require a different persistence/archival design; these are app limits, not proven Blocks limits. IAM account changes and the RBAC state are separate services: provisioning can succeed before an RBAC CAS fails, in which case the response requires a refresh/retry with the existing account. No unit role is granted by IAM country membership alone.

The last-admin invariant protects changes made through this app. A cloud operator can still deactivate an admin directly in IAM. Member-role changes also recheck active/verified IAM admins; the explicit platform super-admin can recover access. This app cannot prevent independent IAM administration outside its API.

## Current live setup status

The approved dev setup was applied on October 14, 2026. The new live schema, backend-only Custom policies, unique organization index and organization-create permission are installed. Live verification confirmed anonymous denial, duplicate rejection and concurrent stale-update rejection, and deleted every temporary verification record. `blocks/rbac/contract.json` now contains the discovered live Gateway contract. Evidence is saved in `docs/unit-rbac-live-evidence.json`. Existing country metadata, business records and memberships remain unchanged.

Refresh the app and open an organization as platform super-admin to initialize its first Organization Admin. Existing hierarchy import is optional and reviewed in that form; setup did not initialize real organization state or migrate memberships automatically.

The later, separately approved demo setup initialized Bangladesh, Nepal and Germany where needed and added four test users per country. Each has an Organization Admin, a Demo Team Unit Admin, a Demo Team Unit User and a membership-only user. Live role readback and all twelve password logins passed. The account list is in `docs/demo-users.json`; existing users and assignments were preserved and no emails were sent.

The user subsequently approved replacing these twelve test identities with matching `yopmail.com` accounts. The IAM profile-update endpoint accepted but ignored email/username changes, so replacements received new IAM IDs. All new password logins passed before existing test memberships and unit assignments were transferred and the old `example.com` accounts deactivated. Pending invitations tied to removed identities are revoked. Other users were unchanged; the account list now contains the new addresses.

The reviewed setup contains:

1. Create only `OrganizationRBACState`; old nine schemas are untouched.
2. Custom read/write/edit/delete security with four allowing policies for only `atlas-data-backend`.
3. Unique `unique_organization_rbac` index on organizationKey.
4. Add only `blocks-iam::iam::create-organizations` to the existing backend role; existing read/user-management permissions remain.
5. Reload Gateway and re-read protections/index/permission.
6. Verify temporary RBAC state CRUD, duplicate rejection, anonymous denial and concurrent stale-update rejection. Delete all temporary records before publishing the discovered runtime contract.

`node scripts/setup-unit-rbac.mjs` runs dry runs only. `--apply` is for the exact approved setup. `node_modules/.bin/tsx scripts/verify-unit-rbac.ts` publishes the runtime contract only after the live checks pass. No real organizations/users are created by those scripts and no real memberships are migrated.

The installed Blocks CLI guide requires exact cloud mutation approval; the user approved this dev setup before it was applied. The script stores the resolved schema/index/security readback under blocks/rbac and suppresses sensitive cloud error output.

## Existing data import

Open an uninitialized organization as platform super-admin, choose its first active/verified IAM Organization Admin, review the import preview and optionally copy the old hierarchy. Department units get IDs `department:<oldId>`; groups become independent units with IDs `group:<oldId>` and names `Parent / Group`. Archived parent status is retained. Old country/department/group/role/membership/resource records are not altered.

Old role assignments are not copied because department roles previously inherited into groups and custom delegation differed from the fixed business rules. Assign each new role explicitly after setup. The new unit IDs are returned by the RBAC API; map the separate application's content to those IDs if importing old units.

Legacy hierarchy/resource/admin-grant/invitation HTTP control endpoints now return 410. The authentication/config/current-identity infrastructure is retained. Old invitation pages direct users to the new RBAC workspace. Historical domain code/tests remain to document the previous POC, but are not exposed as the active control API.

## Integration with the separate application

Use the same Blocks project/tenant for the separate application's end-user identity. Tokens from another project are rejected. Your template/contract application's backend can query:

```http
GET /api/rbac/organizations/{organizationId}/access?unitId={unitId}
Authorization: Bearer <the signed-in user's Blocks access token>
```

Same-origin browser calls can use the encrypted HttpOnly app cookie instead. Cross-origin browser CORS is not enabled; proxy this request through the separate application's backend. Never send this app's backend client secret to a browser, and never use the machine token as a substitute for the end user's identity.

Successful responses describe the fixed role and capabilities:

```json
{
  "organizationId": "organization-id",
  "unitId": "unit-id",
  "role": "unit-user",
  "canManageOrganization": false,
  "canManageUnit": false,
  "canManageMembers": false,
  "canUseUnit": true,
  "canManageUnitContent": false
}
```

A missing assignment, removed organization membership, inactive account or archived unit returns 403. Invalid/expired authentication returns 401. Integration/service failures return 5xx: fail closed, never interpret them as permission grants. Check again on every protected action, including lists, preview, downloads and changes. The separate app must implement its own published/draft distinction and contract ownership rules; unit membership is not permission to read other users' contracts.

Other RBAC endpoints:

| Endpoint | Purpose |
|---|---|
| GET /api/rbac/organizations | Visible organizations and signed-in identity |
| POST /api/rbac/organizations | Super-admin creates organization |
| GET /api/rbac/organizations/:id | Scoped units, members, invitations, activity and revision |
| POST /api/rbac/organizations/:id/initialize | Super-admin appoints first Org Admin; optional reviewed import |
| GET /api/rbac/organizations/:id/directory | Role-filtered IAM profiles |
| PATCH /api/rbac/organizations/:id/settings | Organization name/layer label |
| POST /api/rbac/organizations/:id/units | Create unit |
| PATCH /api/rbac/organizations/:id/units/:unitId | Rename unit |
| POST /api/rbac/organizations/:id/units/:unitId/status | Archive/restore |
| POST /api/rbac/organizations/:id/members | Add or change organization role |
| DELETE /api/rbac/organizations/:id | Owner/super-admin removes RBAC workspace (IAM accounts kept) |
| POST /api/rbac/organizations/:id/ownership | Transfer company ownership to an active Organization Admin |
| DELETE /api/rbac/organizations/:id/members/:userId | Remove app organization access and all unit assignments |
| POST /api/rbac/organizations/:id/units/:unitId/members | Assign/change fixed unit role |
| DELETE /api/rbac/organizations/:id/units/:unitId/members/:userId | Remove just that unit assignment |
| POST /api/rbac/organizations/:id/invitations | Create organization or unit email invitation (existing or new email) |
| DELETE /api/rbac/organizations/:id/invitations/:inviteId | Revoke link |
| POST /api/rbac/organizations/:id/invitations/:inviteId/accept | Verified recipient accepts one-time link |

POST/PATCH mutations of initialized state include the last read `revision` in JSON. DELETE sends that raw revision in If-Match. Browser mutations require an Origin matching APP_ORIGIN; server-to-server mutation clients must honor this policy, and a user token is still required. Initialization and organization creation do not require a previous revision. URL-encode imported unit IDs containing colons. Neither user/organization IDs nor roles in a request body establish caller authority.

## Validation

The fixed-role domain/HTTP tests cover cross-organization denial, admin-target protection, archive/restore, uniqueness, independent memberships, immediate revocation, last-admin protection, concurrent updates, recipient-bound invitations and prevention of old invitation reuse after rejoining. Browser tests cover all main management flows and responsive layout. Screenshots: rbac-desktop.png and rbac-mobile.png. Live-specific evidence will be written to unit-rbac-live-evidence.json after the approved setup and verification.

Invitation acceptance does not require prior workspace access or a client revision. The server checks the bound recipient, token, expiry and current issuer authority before adding IAM country membership, then uses the loaded state revision for the atomic RBAC commit. If a concurrent write rejects that commit, no unit assignment is saved; the recipient retries the invitation. IAM membership alone grants no unit access. Missing accounts receive signup invitations; existing inactive or unverified accounts must activate and verify first. No role or permission is selected by the signup form.

Mail/signup setup is prepared in blocks/rbac/invitation-email-template.json and invitation-signup-settings.json. CLI dry runs passed. The user approved the exact setup and test send. The invitation template and email/password signup settings are now applied and read back; hosted signup initiation was verified, and Blocks Mail accepted the delivery-test email to pro.nipu@gmail.com. Inbox delivery remains unconfirmed. Evidence is in docs/invitation-email-setup-evidence.json and docs/invitation-email-live-evidence.json. The default sender is blocks@selise.io; SMTP credentials remain unchanged. Enabling hosted signup is tenant-wide with empty default roles and permissions. Uninvited signup creates an identity but grants no app organization/unit access.

Invitation creation accepts `{email, scope, role, revision}` for `scope: "organization"` (Super Admin only; role `organization-admin` or `member`), or `{email, scope: "unit", unitId, role, revision}` (authorized unit managers; role `unit-admin` or `unit-user`). Unit Admins can invite only `unit-user` in their own units. The recipient cannot choose or alter the stored role during signup/acceptance. Organization invitation creation, acceptance and revocation recheck explicit Super Admin authority. Older invitations without scope continue to behave as unit invitations. Organization invitations are listed under Members for Super Admins.

## Self-service company ownership

Any active, verified Blocks account can create a company from the Organizations screen. An ordinary creator is added to the new IAM organization with no IAM roles or permissions, and the new RBAC state is initialized with server-selected ownerId and an Organization Admin membership for that creator. After creation the dashboard refreshes and shows the new company card. The card remains visible after reload; opening it enters the owner workspace. Signup itself grants no platform admin authority and no access to existing companies. Explicit platform Super Admins retain the existing create-then-appoint-first-admin flow.

Company ownership is a scoped authority in the organization state, not an ApplicationAdminGrant or an IAM super-admin role. It lets the owner manage units/members, provision accounts into this company, and send/revoke organization and unit invitations. Acceptance rechecks the owner’s active IAM membership and Organization Admin role. Other Organization Admins cannot change ownership, demote or remove the owner. The owner or platform Super Admin can transfer ownership to an active Organization Admin (`POST .../ownership`) or remove the organization workspace (`DELETE .../organizations/:id`), which clears RBAC state and revokes pending invitations while leaving IAM accounts intact. Older organization states without ownerId remain valid until ownership is established.

IAM organization creation, metadata, country membership and the initial RBAC commit are separate services. If owner initialization fails after creation, the API returns the created company ID and asks for administrator reconciliation; it does not silently create a second company or grant access to another company. Live self-service company creation has not been exercised against a new real company during this change; mock HTTP/browser workflows and the production build are verified.

## Blocks native role management (CLI 0.11.0)

The CLI was updated from 0.9.0 to 0.11.0. Scripts use `BLOCKS_CLI` or `blocks` on PATH rather than an expired temporary installation. Roles & access shows a workspace management matrix and, for explicit platform Super Admins in live mode, a native Blocks IAM panel. Company owners and Organization/Unit users cannot call its tenant-wide endpoints.

The native panel lists role parents, direct children, canCreateOwn and the assignable-role response obtained with the signed-in user token. It creates atlas-prefixed roles without permissions or assignments and edits their parent, name and canCreateOwn. Existing descriptions are preserved; propagation to other IAM organizations is disabled. clouduser and atlas-data-backend are protected. Parent cycles, unknown parents, duplicate slugs and stale read revisions are rejected. Server readback verifies saves. Blocks update lacks a verified atomic revision predicate here: the preflight revision check cannot guarantee protection from external concurrent writes between read and update.

Native IAM hierarchy is not substituted for app unit assignments. A user may remain a Unit Admin in one unit and a Unit User in another. Workspace management boundaries and last-admin/company-owner protection continue to be enforced by the app. New IAM roles are not automatically assigned to existing business users.

The user approved the exact permission setup on October 29, 2026. View Roles (blocks-iam::iam::roles) and Manage Roles (blocks-iam::iam::mutate-roles) were applied to atlas-data-backend in the default IAM organization and read back. The application runtime credential now successfully reads the live hierarchy. No existing hierarchy or user assignments were changed; no live role edits were made during verification. Evidence is in docs/native-role-setup-evidence.json and docs/native-role-live-evidence.json. The panel reports the live service error without a mock fallback. The UI regression uses intercepted native API fixtures, not live role writes.

## Owner and authorized-unit administration

Creating a company after verified signup automatically records the creator as its Organization Owner. The owner keeps full company authority. Owner identity is persisted as ownerId; for backward compatibility its organization member row remains organization-admin, and API effectiveRole/effectiveOrganizationRole expose organization-owner. Signup alone does not grant platform Super Admin or access to any existing company.

In an owner-managed organization, the owner selects managedUnitIds when adding/changing an Organization Admin or inviting one. The invitation stores those exact IDs; acceptance cannot choose broader scope. Organization Admins can create units (automatically added to their managedUnitIds), rename/archive/restore authorized units, and manage/invite members there. Removing a unit from managedUnitIds immediately blocks management and acceptance of invitations issued by that admin for that unit unless another current role independently permits it. Organization settings, organization membership changes and appointing Organization Admins remain owner/platform operations.

No unit selection means no initial existing-unit management. Owners can change the selection from Members → Change organization role. Invitations and role changes use existing CAS state commits. No new Gateway schema is needed, and no live memberships were rewritten for this change. Legacy organizations without ownerId retain their earlier Organization Admin authority until an explicit migration establishes ownership. The Members screen exposes **Make owner** for active Organization Admins and **Remove organization** for the owner/super-admin.

The access endpoint now reports canManageOrganization separately from canCreateUnit; canManageUnit and canManageMembers for a supplied unit reflect its actual authorization. Separate applications must check these capability fields instead of interpreting an organization-admin label as unrestricted company access.

## October 29 bug fixes

IAM directory queries use organizationIds and defensively verify each profile’s roles-map membership before exposing it or treating it as an invitation issuer. Read-only live verification returns 8 Bangladesh members instead of the earlier unfiltered 37 users. Company creation uses a random request correlation reference in the supported IAM organization description, verifies the returned/listed organization against that reference, and refuses missing or ambiguous matches. It never selects an organization by newest timestamp. Concurrency regressions use mocked IAM; no live companies were created for verification.

New email, copied and activation-continuation links keep the invitation token in the URL fragment. Preview is POST-only with the token in the JSON body and same-origin enforcement. Legacy query-token email links still redirect for compatibility; their previous requests/logs cannot be scrubbed by this code change, and existing invitations were not revoked or rotated. Copies now include the full absolute origin. Provider mail error bodies are suppressed in logs.

Successful activation responses with errors: [] are accepted; nonempty errors and explicit failure still reject activation. Lint ignores generated .next-* directories, including .next-verify, and the continuation component no longer sets state synchronously in an effect. Validation: 94 backend tests, 13 browser workflows, typecheck, lint and production build pass. See docs/bugfix-verification.json.
