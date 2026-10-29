# Live Blocks integration — 13 October 2026

Historical integration notes for the earlier hierarchy POC. The current organization/unit RBAC implementation and verified October 14 setup are documented in [RBAC.md](RBAC.md).

The app uses **Blocks OS IAM and Blocks Data Gateway**. No SQLite, SQL service, or external database connection is used by the application. Unused historical SQLite files and their database-path setting have been deleted. Request-local memory is only a projection of freshly fetched Gateway records for authorization; it is neither durable storage nor a fallback. Mock mode is a separate, explicitly selected development demo.

## Applied configuration

Tenant `Daeef3775f1414219a348639860aa66f0` (RBAC POC, dev):

- Nine Entity schemas: ApplicationAdminGrant, AuditEvent, CountryMetadata, DemoResource, Department, Group, Invitation, ScopeMembership, ScopedRole.
- Custom read/write/edit/delete access on all nine schemas, with 36 allowing policies matching only the `atlas-data-backend` role. These are server-only collections; browser roles are not application scope grants.
- Unique ScopeMembership index on `(userId,countryOrganizationId,scopeType,scopeId)`.
- Multi-org enabled with explicit consent; actual Bangladesh, Germany, and Nepal IAM organizations created. IAM organization list pagination is zero-based, unlike user/permission list CLI flags.
- Atlas Data Backend machine credential; separately approved read-only IAM organization/user permissions.
- Atlas RBAC Portal public OIDC client with PKCE and hosted IdP login. Callback registered at `https://dbzxpj.slsblx.com:3000/login/callback` and the portless domain.
- Four departments, three groups, nine scoped roles, three resources, country metadata, audit records, and an explicit bootstrap admin grant. No fake demo user identities or memberships were inserted into live Data.

Runtime credentials were generated for the application and stored only in ignored `.env.local`. CLI tokens were not copied into the app. The global CLI was not upgraded; a temporary CLI 0.9.1 installation was used. No application deployment was performed.

## Runtime behavior

The browser navigates to `/api/auth/oidc/start`; the server uses the official SDK to initiate hosted login and complete `/login/callback`. The server verifies the bearer with IAM, checks its tenant and active identity, and stores access/refresh credentials in an encrypted HttpOnly/Secure cookie. App admin authority comes only from ApplicationAdminGrant, never from profile attributes. Protected API requests reload live records and enforce country, parent, scoped permission, and delegation checks before writes.

Gateway documents in `blocks/data/contracts.json` were generated from actual authenticated introspection. App IDs are separate from Gateway ItemIds. Updates use the introspected typed `LastUpdatedDate` filter for optimistic concurrency; JSON string date equality was tested and did not match. Business writes persist through Gateway, with audit intent records written first. Multi-record changes are sequential: failure after partial progress returns an explicit refresh/reconciliation error. These writes are not advertised as remote transactions. Country archive changes application metadata while preserving IAM organizations.

## Verified and remaining limits

`blocks-live-runtime-evidence.json` records actual live create/read/update/delete, stale revision rejection, domain-service flush, audit persistence, anonymous Data denial, and a live workspace containing all three IAM countries. Temporary verification departments were removed. Audit history of verification remains. Backend/session tests and the four mock browser workflows pass. TypeScript, lint, and the production build pass.

The live HTTPS login page and actual redirect to `iam.seliseblocks.com` were verified in Chromium using a temporary browser DNS mapping; a complete hosted-browser login has now passed with the requested dev admin. Refresh, scoped-user organization switching, and direct authenticated ordinary-user Data denial still require separate verification. IAM GET user returned HTTP 500 for the CLI cloud operator, while IAM me returned an active, verified cloud identity and the project user list was empty. The original bootstrap grant targets that explicit CLI identity. The requested development account has a separate explicit grant and its hosted login is verified. If it returns another project user ID, verify that identity and explicitly provision its grant through the admin process—never grant the first login automatically. No unknown user is assigned scoped access by default.

**Live invitation creation and acceptance return 503.** Signup delivery and an atomic or equivalently safe recoverable activation operation have not been verified. The unique index and conditional updates alone do not make separate invitation/membership writes atomic. Mock invitations remain demonstrable in mock mode. This limitation does not require SQLite; it requires a verified Blocks server workflow or a revised activation design. Existing live memberships, hierarchy, roles, and resources use Gateway.

The POC loads a maximum of 10,000 records per collection per request. This provides fresh authorization decisions for the demo and needs a more targeted repository design for larger deployments.

## Local live preview

`.env.local` is already configured with `APP_MODE=live`. Certificates are in ignored `certificates/*.pem`. Start with:

```sh
npm run dev:live
```

Blocks callbacks must return to the registered hostname. This Mac requires an administrator password to change `/etc/hosts`; automatic noninteractive sudo failed without modifying it. Add this line once using your own terminal:

```sh
sudo sh -c 'echo "127.0.0.1 dbzxpj.slsblx.com # Atlas RBAC development" >> /etc/hosts'
```

Then open [the live workspace](https://dbzxpj.slsblx.com:3000) and use **Sign in with Blocks**. The HTTPS login page can also be reviewed at [localhost](https://localhost:3000), but the registered domain must resolve locally for the complete login round trip. Do not enter passwords into chat. The trusted local certificate was generated with the existing mkcert installation.

To run the mock demo instead:

```sh
APP_MODE=mock npm run dev
```

Browser regressions use port 3100 and `.next-e2e`, independently of the live review server.

## Sources

The [official SDK authentication reference](https://docs.seliseblocks.com/reference/authentication/), [Data Gateway reference](https://docs.seliseblocks.com/reference/data-gateway/), and actual tenant introspection guided the implementation. IAM API findings are recorded in `blocks-capability-evidence.json`; schema readback is in `blocks-live-schema-evidence.json`. No absence of a transaction helper is treated as proof that Blocks cannot support an atomic workflow.

## Super-admin navigation

Super-admins land on country cards for all active country organizations. Opening a country shows its departments/groups and management screens. Members includes the full IAM directory for that country, including unassigned users, plus the signed-in administrator. Ordinary users receive only authorized member profiles. Directory reads were exercised against the live backend; currently no additional IAM country users exist, so each directory contains only the administrator. No mock profiles are substituted. Super-admin country navigation uses the explicit application grant and per-request country authorization without requiring an IAM organization-token switch; scoped users retain IAM organization switching.

## Requested development admin account

The requested `pro.nipu@gmail.com` IAM account was created, explicitly activated, read back as active/verified, and given an ApplicationAdminGrant. Its requested password was accepted by live Blocks authentication. Server identity verification and encrypted-cookie size checks passed; temporary verification sessions were revoked. The password was never saved in the repository or documentation. Server OIDC clients now include the registered callback URL, which the SDK requires outside a browser.

## OIDC callback repair

The old browser callback consumed a valid Blocks state but did not receive tokens needed to establish the app session. A retry then reused consumed state and returned `invalid_state`. The registered callback is now a server Route Handler. It verifies a signed, HttpOnly five-minute login-state cookie, exchanges the code with Blocks on the server, verifies IAM identity, sets the encrypted app session, and redirects to `/`. Concurrent callback requests share one in-flight exchange. Expired or used states show a fresh-login action rather than replaying the failed callback. The platform timeout was not extended, and state checks remain enforced. Next’s internal bind hostname is handled using the original public Host/protocol.

A real provider password login, server callback, encrypted session, super-admin identity, all three country organizations, and rejected callback replay were verified in `oidc-login-evidence.json`. This test uses the documented headless OIDC password endpoint for the provider step; it does not replace provider code/state validation.

The repaired flow also passed the actual hosted browser login: real IAM form submission, server callback, encrypted app cookie, and a country overview containing three countries. The browser made zero token-exchange requests to the IdP callback. The test signed out afterward.

## Super-admin user provisioning

The Add user dialog supports existing IAM accounts and new accounts with an initial password. It targets country membership only, a department, or a group. Country membership alone creates no scoped assignment. Department and group targets require a role in that country, and archived parents are rejected before IAM writes. Only an explicit application super-admin can call POST /api/countries/:id/users.

IAM account creation/activation and country access use the server SDK. New accounts receive no IAM roles or permissions, and no email notifications are sent. Existing country members keep their IAM access untouched. IAM membership is reread before any scoped Data record is saved. The live empty-role country grant still needs verification against this tenant; if Blocks does not retain it, the endpoint stops without granting scoped access. No external database is used.

The backend needs the built-in `blocks-iam::iam::mutate-users` permission. Its CLI dry run passed, the user approved the exact grant, and the permission was applied and read back on 2026-10-13. IAM and Data writes are separate operations: an audit intent precedes IAM provisioning, and failures report that country membership/account creation may already exist. Retry resolves an existing email and membership instead of creating a second scoped row. Existing-account lookup for the requested super-admin passed using the backend credential. Live activation and empty-role membership have not yet been tested with this credential. No live test users have been created. Evidence is in docs/user-provisioning-evidence.json.
