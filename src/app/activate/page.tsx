"use client";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, ShieldCheck } from "lucide-react";

type Preview = {
  organizationId: string;
  organization: string;
  inviteId: string;
  email: string;
  roleLabel: string;
  scope: "organization" | "unit";
  unit: string;
  accountStatus: "missing" | "active" | "inactive";
};

type InviteRef = { org: string; id: string; token: string };

function readStoredInvite(): InviteRef | null {
  const stored = sessionStorage.getItem("atlas_pending_invitation");
  if (!stored) return null;
  try {
    const invite = JSON.parse(stored) as InviteRef;
    if (invite.org && invite.id && invite.token) return invite;
  } catch {
    sessionStorage.removeItem("atlas_pending_invitation");
  }
  return null;
}

function readInvite(): InviteRef | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const token =
    url.searchParams.get("token") ||
    new URLSearchParams(url.hash.slice(1)).get("token");
  const org = url.searchParams.get("organization");
  const id = url.searchParams.get("invite");
  if (org && id && token) {
    const invite = { org, id, token };
    sessionStorage.setItem("atlas_pending_invitation", JSON.stringify(invite));
    // Keep organization/invite in the URL; only hide the secret token.
    // Do not clear storage on remount when token is already gone (React Strict Mode).
    url.searchParams.delete("token");
    if (url.hash) url.hash = "";
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    return invite;
  }
  if (org && id) {
    const stored = readStoredInvite();
    if (stored && stored.org === org && stored.id === id) return stored;
    sessionStorage.removeItem("atlas_pending_invitation");
    return null;
  }
  return readStoredInvite();
}

export default function ActivateAccountPage() {
  const [invite, setInvite] = useState<InviteRef | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mock, setMock] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await fetch("/api/config", { cache: "no-store" }).then((r) => r.json());
        if (!cancelled) setMock(Boolean(config.mockSelector));
        const current = readInvite();
        if (!current) {
          if (!cancelled) setError("Open the invitation link from your email to activate this account.");
          return;
        }
        if (!cancelled) setInvite(current);
        const response = await fetch(
          `/api/auth/invitation-preview?organization=${encodeURIComponent(current.org)}&invite=${encodeURIComponent(current.id)}&token=${encodeURIComponent(current.token)}`,
          { cache: "no-store" },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Invitation is unavailable.");
        if (!cancelled) setPreview(data);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Invitation is unavailable.";
        if (/expired or was revoked|Invitation link is invalid|Invitation not found/i.test(message))
          sessionStorage.removeItem("atlas_pending_invitation");
        if (!cancelled) setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invite || !preview) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    const confirm = String(form.get("confirmPassword") || "");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/auth/activate-invitation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: invite.org,
          inviteId: invite.id,
          token: invite.token,
          firstName: String(form.get("firstName") || ""),
          lastName: String(form.get("lastName") || ""),
          password,
          code: String(form.get("code") || ""),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not activate the account.");
      setDone(true);
      setNotice(
        data.status === "ready"
          ? "Your Blocks account is already active. Sign in to accept the invitation."
          : "Account activated. Sign in with this email to accept your invitation.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not activate the account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="rbac-login">
      <section>
        <div className="rbac-brand">
          <ShieldCheck />
          Atlas access
        </div>
        <span className="eyebrow">INVITATION</span>
        <h1>Activate your account</h1>
        <p>
          {preview
            ? `Set your password for ${preview.email} to join ${preview.organization} as ${preview.roleLabel}.`
            : "Complete account activation to accept your workspace invitation."}
        </p>
        {error && <p className="rbac-banner error" role="alert">{error}</p>}
        {notice && <p className="rbac-banner success" role="status">{notice}</p>}
        {loading ? (
          <p>Loading invitation…</p>
        ) : done && preview ? (
          <div className="rbac-activate-next">
            {mock ? (
              <a className="button primary" href={`/?organization=${encodeURIComponent(invite!.org)}&invite=${encodeURIComponent(invite!.id)}&token=${encodeURIComponent(invite!.token)}`}>
                Continue to accept invitation <ArrowUpRight size={17} />
              </a>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- OIDC requires a full HTTP navigation. */}
                <a className="button primary" href="/api/auth/oidc/start">
                  Sign in to accept invitation <ArrowUpRight size={17} />
                </a>
                <p>Use {preview.email} after activation. Your invitation is saved for this browser.</p>
              </>
            )}
          </div>
        ) : preview?.accountStatus === "active" ? (
          <div className="rbac-activate-next">
            {mock ? (
              <a className="button primary" href={`/?organization=${encodeURIComponent(invite!.org)}&invite=${encodeURIComponent(invite!.id)}&token=${encodeURIComponent(invite!.token)}`}>
                Continue to accept invitation <ArrowUpRight size={17} />
              </a>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- OIDC requires a full HTTP navigation. */}
                <a className="button primary" href="/api/auth/oidc/start">
                  Sign in to accept invitation <ArrowUpRight size={17} />
                </a>
                <p>This email already has an active Blocks account.</p>
              </>
            )}
          </div>
        ) : preview ? (
          <form onSubmit={(e) => void onSubmit(e)} aria-label="Activate account">
            <label>
              Work email
              <input value={preview.email} readOnly aria-label="Work email" />
            </label>
            <label>
              First name
              <input name="firstName" required maxLength={60} autoComplete="given-name" />
            </label>
            <label>
              Last name
              <input name="lastName" required maxLength={60} autoComplete="family-name" />
            </label>
            <label>
              Password
              <input name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" />
            </label>
            <label>
              Confirm password
              <input name="confirmPassword" type="password" required minLength={8} maxLength={128} autoComplete="new-password" />
            </label>
            {preview.accountStatus === "inactive" && (
              <label>
                Activation code
                <input name="code" required maxLength={200} autoComplete="one-time-code" placeholder="From your Blocks activation email" />
              </label>
            )}
            <button className="button primary" disabled={busy}>
              Activate account <ArrowUpRight size={17} />
            </button>
          </form>
        ) : null}
        <small>
          {preview
            ? `${preview.scope === "organization" ? "Organization" : preview.unit} · ${preview.roleLabel}`
            : "Organization-scoped access"}
        </small>
      </section>
      <aside>
        <ShieldCheck size={54} />
        <h2>
          Accept the invite.
          <br />
          Activate first.
        </h2>
        <p>
          New invitees activate their Blocks account here, then sign in once to receive the role your administrator selected.
        </p>
      </aside>
    </main>
  );
}
