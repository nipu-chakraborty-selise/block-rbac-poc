import type { GatewayCollectionContract } from "../blocks-data";
interface TypeRef {
  kind: string;
  name: string | null;
  ofType?: TypeRef | null;
}
interface Field {
  name: string;
  type: TypeRef;
  args?: { name: string; type: TypeRef }[];
}
interface Definition {
  name: string;
  fields?: Field[];
  inputFields?: Field[];
}
export interface Introspection {
  __schema: {
    queryType: { fields: Field[] };
    mutationType: { fields: Field[] };
    types: Definition[];
  };
}
const base = (type?: TypeRef | null): string =>
  type?.name || (type?.ofType ? base(type.ofType) : "");
function printed(type: TypeRef): string {
  if (type.kind === "NON_NULL") return `${printed(type.ofType!)}!`;
  if (type.kind === "LIST") return `[${printed(type.ofType!)}]`;
  if (!type.name || !/^[_a-zA-Z][_0-9a-zA-Z]*$/.test(type.name))
    throw new Error("Invalid GraphQL type.");
  return type.name;
}
/** Discover operations by their inspected input/result types, never by pluralization. */
export function stateContract(data: Introspection): GatewayCollectionContract {
  const schema = data.__schema,
    types = new Map(schema.types.map((t) => [t.name, t])),
    record = types.get("OrganizationRBACState");
  const required = [
    "ItemId",
    "LastUpdatedDate",
    "id",
    "organizationKey",
    "stateJson",
  ];
  if (
    !record?.fields ||
    required.some((name) => !record.fields!.some((f) => f.name === name))
  )
    throw new Error("Organization RBAC fields are unavailable.");
  const list = schema.queryType.fields.find((f) =>
    types
      .get(base(f.type))
      ?.fields?.some((p) => p.name === "items" && base(p.type) === record.name),
  );
  const mutation = (suffix: string) =>
    schema.mutationType.fields.find((f) =>
      f.args?.some(
        (a) =>
          a.name === "input" &&
          base(a.type) === `${record.name}${suffix}Input` &&
          !printed(a.type).startsWith("["),
      ),
    );
  const create = mutation("Insert"),
    update = mutation("Update"),
    remove = mutation("Delete");
  const argument = (field: Field | undefined, name: string) => {
    const arg = field?.args?.find((a) => a.name === name);
    if (!arg) throw new Error(`GraphQL argument ${name} unavailable.`);
    return printed(arg.type);
  };
  if (!list || !create || !update || !remove)
    throw new Error("Organization RBAC operations are unavailable.");
  const where = update.args?.find((a) => a.name === "where");
  const revision =
    where &&
    types
      .get(base(where.type))
      ?.inputFields?.find((f) => f.name === "LastUpdatedDate");
  if (
    !revision ||
    !types
      .get(base(revision.type))
      ?.inputFields?.some((f) => f.name === "eq" && base(f.type) === "DateTime")
  )
    throw new Error("Typed revision equality filter is unavailable.");
  const result = "acknowledged itemId message totalImpactedData";
  return {
    schemaName: record.name,
    fields: ["id", "organizationKey", "stateJson"],
    list: {
      query: `query ${list.name}($input:${argument(list, "input")}){${list.name}(input:$input){items{${required.join(" ")}} totalCount}}`,
      operationName: list.name,
      resultField: list.name,
    },
    create: {
      query: `mutation ${create.name}($input:${argument(create, "input")}){${create.name}(input:$input){${result}}}`,
      operationName: create.name,
      resultField: create.name,
    },
    update: {
      query: `mutation ${update.name}($filter:${argument(update, "filter")},$where:${argument(update, "where")},$input:${argument(update, "input")}){${update.name}(filter:$filter,where:$where,input:$input){${result}}}`,
      operationName: update.name,
      resultField: update.name,
    },
    delete: {
      query: `mutation ${remove.name}($filter:${argument(remove, "filter")},$input:${argument(remove, "input")}){${remove.name}(filter:$filter,input:$input){${result}}}`,
      operationName: remove.name,
      resultField: remove.name,
    },
  };
}
