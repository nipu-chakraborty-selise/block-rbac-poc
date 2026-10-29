import { AppError } from "../model";
import { mode } from "../adapters";
import { backendClient } from "../blocks-runtime";
import { application } from "../http";
import { invitationRoleLabel } from "./invitation-mail";
import { tokenHash } from "./service";
import { liveStateRepository, sharedMockRepository } from "./repository";
import type { Invitation, OrganizationState } from "./model";

export type InvitationPreview = {
  organizationId: string;
  organization: string;
  inviteId: string;
  email: string;
  role: string;
  roleLabel: string;
  scope: "organization" | "unit";
  unit: string;
  expiresAt: string;
  accountStatus: "missing" | "active" | "inactive";
};
export function activationFailed(response:Record<string,unknown>){
  const errors=response.errors;
  return response.isSuccess===false || !!response.error || (Array.isArray(errors)?errors.length>0:!!errors);
}

async function loadState(organizationId: string) {
  if (mode() === "mock") {
    const saved = await sharedMockRepository.load(organizationId);
    if (!saved) throw new AppError(404, "Invitation not found.");
    return saved.state;
  }
  const saved = await liveStateRepository().load(organizationId);
  if (!saved) throw new AppError(404, "Invitation not found.");
  return saved.state;
}

function requirePendingInvite(state: OrganizationState, inviteId: string, token: string) {
  const invite = state.invitations.find((i) => i.id === inviteId);
  if (!invite || tokenHash(token) !== invite.tokenHash)
    throw new AppError(403, "Invitation link is invalid.");
  if (invite.status === "accepted")
    throw new AppError(410, "This invitation was already accepted. Sign in to open the workspace.");
  if (invite.status === "revoked")
    throw new AppError(410, "This invitation was revoked. Ask your administrator for a new link.");
  if (Date.parse(invite.expiresAt) <= Date.now())
    throw new AppError(410, "This invitation has expired. Ask your administrator for a new link.");
  if (invite.status !== "pending")
    throw new AppError(410, "Invitation is no longer available.");
  return invite;
}

async function accountStatus(email: string): Promise<"missing" | "active" | "inactive"> {
  if (mode() === "mock") {
    const user = application()
      .store.all("users")
      .find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!user) return "missing";
    return user.verified ? "active" : "inactive";
  }
  const result = await backendClient().iam.users.list({
    page: 0,
    pageSize: 100,
    filter: { email },
  });
  if (result.isSuccess === false || !Array.isArray(result.data) || Number(result.totalCount) > 100)
    throw new AppError(503, "Blocks account lookup unavailable.");
  const matches = result.data.filter((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (matches.length > 1) throw new AppError(422, "Multiple accounts match this email.");
  const found = matches[0];
  if (!found?.itemId) return "missing";
  return found.active === true && found.isVerified === true ? "active" : "inactive";
}

function unitLabel(state: OrganizationState, invite: Invitation) {
  if (invite.scope === "organization" || !invite.unitId) return "Organization";
  return state.units.find((u) => u.id === invite.unitId)?.name || "Unit";
}

export async function previewInvitation(input: {
  organizationId: string;
  inviteId: string;
  token: string;
}): Promise<InvitationPreview> {
  const state = await loadState(input.organizationId);
  const invite = requirePendingInvite(state, input.inviteId, input.token);
  return {
    organizationId: input.organizationId,
    organization: state.displayName,
    inviteId: invite.id,
    email: invite.email,
    role: invite.role,
    roleLabel: invitationRoleLabel(invite.role),
    scope: invite.scope === "organization" ? "organization" : "unit",
    unit: unitLabel(state, invite),
    expiresAt: invite.expiresAt,
    accountStatus: await accountStatus(invite.email),
  };
}

export async function activateInvitationAccount(input: {
  organizationId: string;
  inviteId: string;
  token: string;
  firstName: string;
  lastName: string;
  password: string;
  code?: string;
}) {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const password = input.password;
  if (!firstName || firstName.length > 60) throw new AppError(422, "Enter a first name of 1–60 characters.");
  if (!lastName || lastName.length > 60) throw new AppError(422, "Enter a last name of 1–60 characters.");
  if (password.length < 8 || password.length > 128)
    throw new AppError(422, "Password must be 8–128 characters.");
  const state = await loadState(input.organizationId);
  const invite = requirePendingInvite(state, input.inviteId, input.token);
  const status = await accountStatus(invite.email);
  if (status === "active")
    return { status: "ready" as const, next: "signin" as const, email: invite.email };
  if (mode() === "mock") {
    const store = application().store;
    const existing = store.all("users").find((u) => u.email.toLowerCase() === invite.email);
    if (existing) {
      store.put("users", { ...existing, verified: true, name: `${firstName} ${lastName}`.trim() });
    } else {
      store.put("users", {
        id: `invitee-${invite.id.slice(0, 8)}`,
        email: invite.email,
        name: `${firstName} ${lastName}`.trim(),
        verified: true,
        projectId: "mock",
        countryIds: [],
      });
    }
    return { status: "activated" as const, next: "signin" as const, email: invite.email };
  }
  const iam = backendClient().iam.users;
  if (status === "inactive") {
    const code = typeof input.code === "string" ? input.code.trim() : "";
    if (!code)
      throw new AppError(
        422,
        "This email already has a pending Blocks account. Enter the activation code from your Blocks activation email.",
      );
    const activated = await backendClient().auth.activate({
      code,
      password,
      firstName,
      lastName,
    });
    if (activationFailed(activated))
      throw new AppError(422, "Activation code is invalid or expired.");
    return { status: "activated" as const, next: "signin" as const, email: invite.email };
  }
  // Create the identity without company membership. Accept joins the invited organization.
  const created = await iam.create({
    email: invite.email,
    userName: invite.email,
    firstName,
    lastName,
    password,
    organizationId: "default",
    roles: [],
    permissions: [],
    sendMail: false,
    notifyUser: false,
  });
  if (created.isSuccess !== true)
    throw new AppError(502, "Blocks could not create the account for this invitation.");
  const listed = await iam.list({ page: 0, pageSize: 100, filter: { email: invite.email } });
  const target = Array.isArray(listed.data)
    ? listed.data.find((u) => u.email?.toLowerCase() === invite.email)
    : undefined;
  if (!target?.itemId)
    throw new AppError(503, "Account was created but could not be confirmed. Sign in before retrying.");
  const activated = await iam.activate({
    userId: target.itemId,
    reason: "Activated from Atlas invitation accept page",
  });
  if (activated.isSuccess !== true)
    throw new AppError(
      503,
      "Account was created but activation failed. Use the Blocks activation email or contact an administrator.",
    );
  return { status: "activated" as const, next: "signin" as const, email: invite.email };
}
