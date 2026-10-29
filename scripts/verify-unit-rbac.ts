import env from "@next/env";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { backendClient, runtimeConfig } from "../src/lib/blocks-runtime";
import { BlocksDataRepository } from "../src/lib/blocks-data";
import { stateContract, type Introspection } from "../src/lib/rbac/contract";
import { emptyState } from "../src/lib/rbac/model";
env.loadEnvConfig(process.cwd());
try {
  const client = backendClient(),
    config = runtimeConfig();
  const result = (await client.data.graphql({
    operationName: "InspectUnitRbac",
    query:
      "query InspectUnitRbac { __schema { queryType { fields { name args { name type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } } mutationType { fields { name args { name type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } type { kind name ofType { kind name } } } } types { name fields { name type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } inputFields { name type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } } } }",
  })) as { data?: Introspection; errors?: unknown };
  if (result.errors || !result.data) throw new Error("Introspection failed.");
  const contract = stateContract(result.data),
    repository = new BlocksDataRepository(
      {
        apiUrl: config.apiUrl,
        xBlocksKey: config.projectKey,
        accessToken: () => client.auth.accessToken(),
      },
      { rbacState: contract },
    );
  const previous = JSON.parse(
    readFileSync("blocks/rbac/contract.json", "utf8"),
  ) as { schemaName?: string };
  if (!previous.schemaName && (await repository.list("rbacState")).total !== 0)
    throw new Error(
      "Unexpected existing RBAC records require review before first enablement.",
    );
  const anonymous = new BlocksDataRepository(
    { apiUrl: config.apiUrl, xBlocksKey: config.projectKey },
    { rbacState: contract },
  );
  let denied = false;
  try {
    await anonymous.list("rbacState");
  } catch {
    denied = true;
  }
  if (!denied) throw new Error("Anonymous RBAC access allowed.");
  const organizationKey = `rbac-verification-${randomUUID()}`,
    state = emptyState({
      id: organizationKey,
      name: "Temporary RBAC verification",
      status: "active",
    }),
    row = {
      id: organizationKey,
      organizationKey,
      stateJson: JSON.stringify(state),
    };
  const itemId = await repository.create("rbacState", row);
  let duplicateItemId: string | undefined;
  let unique = false,
    concurrent = false;
  try {
    try {
      duplicateItemId = await repository.create("rbacState", {
        ...row,
        id: `duplicate-${randomUUID()}`,
      });
    } catch {
      unique = true;
    }
    if (!unique) throw new Error("Unique organization index not enforced.");
    const saved = await repository.get("rbacState", itemId);
    if (!saved?.revision) throw new Error("No revision.");
    const edits = await Promise.allSettled([
      repository.compareAndSet(
        "rbacState",
        itemId,
        {
          ...row,
          stateJson: JSON.stringify({ ...state, layerLabel: "Teams" }),
        },
        saved.revision,
      ),
      repository.compareAndSet(
        "rbacState",
        itemId,
        {
          ...row,
          stateJson: JSON.stringify({ ...state, layerLabel: "Departments" }),
        },
        saved.revision,
      ),
    ]);
    concurrent =
      edits.filter((e) => e.status === "fulfilled").length === 1 &&
      edits.filter((e) => e.status === "rejected").length === 1;
    if (!concurrent)
      throw new Error(
        "Concurrent writes did not reject exactly one stale revision.",
      );
    const current = await repository.get("rbacState", itemId);
    if (
      !current ||
      JSON.parse(current.record.stateJson).organizationId !== organizationKey
    )
      throw new Error("State readback failed.");
  } finally {
    // Delete only item IDs created by this test, after checking their ownership marker.
    for (const ownedId of [itemId, duplicateItemId].filter(
      (id): id is string => !!id,
    )) {
      const owned = await repository.get("rbacState", ownedId);
      if (owned?.record.organizationKey !== organizationKey)
        throw new Error(
          "Verification cleanup ownership could not be confirmed.",
        );
      await repository.remove("rbacState", ownedId);
      if (await repository.get("rbacState", ownedId))
        throw new Error("Temporary verification record remains.");
    }
  }
  const evidence = {
    verifiedAt: new Date().toISOString(),
    storage: "Blocks Data Gateway",
    anonymousDenied: denied,
    uniqueOrganizationIndexEnforced: unique,
    concurrentStaleWriteRejected: concurrent,
    temporaryRecordsRemoved: true,
    businessRecordsMigrated: false,
    realMembershipsChanged: false,
  };
  // Publishing the contract enables live reads only after security, uniqueness and CAS checks pass.
  writeFileSync(
    "blocks/rbac/contract.json",
    JSON.stringify(contract, null, 2) + "\n",
  );
  writeFileSync(
    "docs/unit-rbac-live-evidence.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
} catch {
  console.error(
    "Live RBAC verification failed; sensitive cloud response suppressed. Contract was not enabled.",
  );
  process.exitCode = 1;
}
