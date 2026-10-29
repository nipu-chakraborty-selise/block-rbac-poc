import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stateContract, type Introspection } from "../src/lib/rbac/contract";
const fixture = () => {
  const source = readFileSync(
    "blocks/data/runtime-schema.json",
    "utf8",
  ).replaceAll("Department", "OrganizationRBACState");
  const data = JSON.parse(source) as Introspection;
  const record = data.__schema.types.find(
    (t) => t.name === "OrganizationRBACState",
  )!;
  record.fields!.push(
    { name: "organizationKey", type: { kind: "SCALAR", name: "ID" } },
    { name: "stateJson", type: { kind: "SCALAR", name: "String" } },
  );
  const items = data.__schema.types
    .find((t) => t.name === "OrganizationRBACStateResult")!
    .fields!.find((f) => f.name === "items")!;
  items.type = {
    kind: "NON_NULL",
    name: null,
    ofType: {
      kind: "LIST",
      name: null,
      ofType: {
        kind: "NON_NULL",
        name: null,
        ofType: { kind: "OBJECT", name: "OrganizationRBACState" },
      },
    },
  };
  const list = data.__schema.queryType.fields.find(
    (f) => f.name === "getOrganizationRBACStates",
  )!;
  list.name = "readOrganizationBoundary";
  return data;
};
test("RBAC contract uses discovered GraphQL names and a typed revision predicate", () => {
  const spec = stateContract(fixture());
  assert.equal(spec.list.resultField, "readOrganizationBoundary");
  assert.match(spec.list.query, /readOrganizationBoundary\(input:/);
  assert.match(spec.update.query, /where:\$where/);
  assert.deepEqual(spec.fields, ["id", "organizationKey", "stateJson"]);
});
test("RBAC runtime contract refuses schemas without revision equality support", () => {
  const data = fixture();
  data.__schema.types.find(
    (t) => t.name === "DateTimeOperationFilterInput",
  )!.inputFields = [];
  assert.throws(() => stateContract(data), /revision equality/);
});
