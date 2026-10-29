import {
  createBlocksClient,
  type BlocksClientConfig,
} from "@seliseblocks/client";
import { AppError } from "./model";
// Runtime helpers verified against SDK 0.2.0. No CLI state or credentials are read.
export class BlocksRuntimeAdapters {
  readonly client;
  constructor(config: BlocksClientConfig) {
    this.client = createBlocksClient(config);
  }
  identity() {
    return this.client.iam.me();
  }
  organizations() {
    return this.client.iam.organizations.my();
  }
  switchOrganization(organizationId: string) {
    return this.client.auth.switchOrganization({
      organization_id: organizationId,
    });
  }
  generateInvitation(payload: {
    configurationId: string;
    email: string;
    organizationId: string;
    expiresInMinutes: number;
    maxRedemptions: number;
  }) {
    return this.client.http.request("/iam/v4/iam/signup-links", {
      method: "POST",
      body: payload,
    });
  }
  // Operation names must be taken from the configured project's schema; no guessed GraphQL CRUD.
  hierarchyQuery(query: string, variables: Record<string, unknown>) {
    return this.client.data.graphql({ query, variables });
  }
}
export function mode() {
  const value = process.env.APP_MODE || "mock";
  if (value !== "mock" && value !== "live")
    throw new AppError(503, "APP_MODE must be mock or live.");
  return value;
}
export function mockDevelopment() {
  return mode() === "mock" && process.env.NODE_ENV === "development";
}
export function requireMockRuntime() {
  if (mode() === "live")
    throw new AppError(
      503,
      "The mock runtime cannot be used in live Blocks mode.",
    );
}
