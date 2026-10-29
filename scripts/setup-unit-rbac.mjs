import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
const cli = (process.env.BLOCKS_CLI||"blocks"),
  workspace = resolve("blocks/rbac"),
  common = [
    "--account",
    "default",
    "--project",
    "Daeef3775f1414219a348639860aa66f0",
    "--json",
  ];
function call(args) {
  try {
    const output = execFileSync(cli, [...args, ...common], {
        cwd: workspace,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 4e6,
      });
    // Composite CLI commands emit a JSON document per named stage.
    const stages = output.split(/^== .* ==\s*$/m).filter((part) => part.trim());
    const results = stages.map((part) => JSON.parse(part));
    const assertSuccess = (value) => {
      if (value.code || value.isSuccess === false) throw new Error();
      for (const result of value.results || []) assertSuccess(result);
      if (value.gatewayReload) assertSuccess(value.gatewayReload);
    };
    results.forEach(assertSuccess);
    const r = results.at(-1);
    if (r.code || r.isSuccess === false) throw new Error();
    return r;
  } catch {
    throw new Error(
      `Blocks CLI ${args.slice(0, 3).join(" ")} failed. Sensitive output suppressed.`,
    );
  }
}
const permission = [
  "iam",
  "roles",
  "assign-permissions",
  "atlas-data-backend",
  "--add-permissions",
  "blocks-iam::iam::create-organizations",
  "--organization-id",
  "default",
];
const index = {
  schemaDefinitionItemId: "resolved-from-OrganizationRBACState",
  name: "unique_organization_rbac",
  isUnique: true,
  fields: [{ fieldName: "organizationKey", direction: "ASC" }],
};
if (!process.argv.includes("--apply")) {
  writeFileSync(
    resolve(workspace, "index-preview.json"),
    JSON.stringify(index, null, 2) + "\n",
  );
  for (const args of [
    ["data", "validate"],
    ["data", "sync", "--dry-run"],
    ["data", "rules", "deploy", "--dry-run"],
    [
      "data",
      "schema",
      "indexes",
      "create",
      "--file",
      "index-preview.json",
      "--dry-run",
    ],
    [...permission, "--dry-run"],
  ])
    console.log(JSON.stringify(call(args), null, 2));
  process.exit(0);
}
// Run --apply only after approval for this exact dev setup; it never creates real orgs/users or imports memberships.
call(["data", "sync", "--dry-run"]);
call(["data", "sync", "--yes"]);
const response = call([
  "data",
  "schema",
  "list",
  "--page",
  "1",
  "--page-size",
  "100",
]);
const schema = response.data?.items?.find(
  (s) => s.schemaName === "OrganizationRBACState",
);
const id = schema?.id || schema?.itemId;
if (!id) throw new Error("Cannot resolve the newly created RBAC schema.");
if (
  ![
    "readAccessLevel",
    "writeAccessLevel",
    "editAccessLevel",
    "deleteAccessLevel",
  ].every((key) => schema[key] === 3)
)
  throw new Error(
    "RBAC schema is not protected by Custom access. No state records created.",
  );
const policies = call([
  "data",
  "rules",
  "policy",
  "get",
  "OrganizationRBACState",
]);
const rules = policies.data;
if (
  !Array.isArray(rules) ||
  rules.length !== 4 ||
  ![0, 1, 2, 3].every((op) =>
    rules.some(
      (p) =>
        p.operation === op &&
        p.isAllowPolicy === true &&
        p.ruleGroup?.rules?.length === 1 &&
        p.ruleGroup.rules[0].leftOperand === "roles" &&
        p.ruleGroup.rules[0].operator === 6 &&
        p.ruleGroup.rules[0].staticValue === "atlas-data-backend" &&
        p.ruleGroup.nestedGroups?.length === 0,
    ),
  )
)
  throw new Error(
    "Backend-only policies not confirmed. No state records created.",
  );
writeFileSync(
  resolve(workspace, "security-readback.json"),
  JSON.stringify(
    {
      schemaId: id,
      accessLevels: {
        read: schema.readAccessLevel,
        write: schema.writeAccessLevel,
        edit: schema.editAccessLevel,
        delete: schema.deleteAccessLevel,
      },
      policies,
    },
    null,
    2,
  ) + "\n",
);
const existing =
  call(["data", "schema", "indexes", "list", id]).data?.indexes || [];
if (
  !existing.some(
    (i) =>
      i.name === index.name &&
      i.isUnique &&
      i.fields?.length === 1 &&
      i.fields[0].fieldName === "organizationKey",
  )
) {
  const body = { ...index, schemaDefinitionItemId: id };
  writeFileSync(
    resolve(workspace, "index.json"),
    JSON.stringify(body, null, 2) + "\n",
  );
  call([
    "data",
    "schema",
    "indexes",
    "create",
    "--file",
    "index.json",
    "--dry-run",
  ]);
  call([
    "data",
    "schema",
    "indexes",
    "create",
    "--file",
    "index.json",
    "--yes",
  ]);
}
const verified =
  call(["data", "schema", "indexes", "list", id]).data?.indexes || [];
if (
  !verified.some(
    (i) =>
      i.name === index.name &&
      i.isUnique &&
      i.fields?.length === 1 &&
      i.fields[0].fieldName === "organizationKey",
  )
)
  throw new Error("Unique organization index not confirmed.");
call([...permission, "--dry-run"]);
call([...permission, "--yes"]);
const readback = call([
  "iam",
  "permissions",
  "list",
  "--search",
  "Create Organizations",
  "--page",
  "1",
]);
if (
  !readback.data?.some(
    (p) =>
      p.resource === "blocks-iam::iam::create-organizations" &&
      p.roles?.includes("atlas-data-backend"),
  )
)
  throw new Error("Organization creation permission not confirmed.");
console.log(
  "RBAC schema, Custom security, unique index and organization-create permission applied. Run verify-unit-rbac.ts before enabling the runtime contract.",
);
