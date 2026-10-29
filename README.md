# Atlas organization and unit RBAC

A Next.js RBAC control app using Blocks OS IAM and Blocks Data Gateway. It manages organizations, one layer of independent units, members, fixed roles and activity. Verified users can create their company and become its owner/first Organization Admin, with access limited to that company. Templates and contracts are handled by the separate business application.

Business authority: **Organization Owner**, **Organization Admin**, **Unit Admin**, **Unit User**. Company creators automatically become Organization Owners; owners select the units each Organization Admin may manage. Admins can also create and manage new units. The existing explicit **application super-admin** manages the platform across organizations. Organization membership alone grants no unit access.

The app includes unit uniqueness, rename/archive/restore, role-limited member management, last-admin protection, concurrent edit rejection, and recipient-bound email invitations for existing and new email addresses. New recipients use hosted Blocks signup and email verification; organization membership and the stored unit role are added on acceptance. Automatic mail uses the AtlasUnitInvitation template and the tenant’s existing default sender. The approved mail-template/signup setup is applied. Hosted signup initiation and a test mail request have been verified; inbox delivery remains unconfirmed.

No SQLite or external SQL database is used. Live operations do not fall back to mock data.

## Run

```sh
pnpm install --frozen-lockfile
pnpm dev:live
```

Use the configured registered HTTPS origin for OIDC. Runtime credentials remain in ignored .env.local. The new RBAC schema setup awaits explicit approval; until enabled, live unit-state operations return a setup error. Existing IAM countries and platform admin grants are preserved.

Development mock:

```sh
APP_MODE=mock pnpm dev
```

Mock data is process memory. Select Alex Morgan for platform super-admin, Ayesha Rahman for Bangladesh Organization Admin, Farhan Ahmed for HRM Unit Admin or Nadia Islam for HRM Unit User.

## Verify

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
```

## Blocks setup and integration

See [docs/RBAC.md](docs/RBAC.md) for the exact cloud setup, preservation/import behavior, limits and API integration. Dry run:

```sh
node scripts/setup-unit-rbac.mjs
```

The setup applies one new schema, backend-only access, a unique organization index and the organization-create permission only after approval. It preserves the old nine schemas. A live verification script discovers the actual GraphQL contract and enables runtime reads after checks pass.

The separate application's backend checks the signed-in user's current unit capabilities through `GET /api/rbac/organizations/:id/access?unitId=...`. It must enforce its own content and contract rules. The old hierarchy/resource control HTTP endpoints are retired.

Platform Super Admins have a Blocks native role hierarchy panel in Roles & access (parent roles, canCreateOwn and caller-assignable roles), alongside a workspace “who manages whom” matrix. The approved backend View Roles/Manage Roles grant is applied and live hierarchy reads are verified. See docs/RBAC.md for limits and permissions.

Use pnpm 11.6.0 (pinned by packageManager). pnpm-workspace.yaml explicitly allows esbuild and unrs-resolver installation scripts; other dependency build scripts still require review. After changing this policy on an existing installation, run `pnpm rebuild esbuild unrs-resolver`.
