"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Building2,
  Users,
  ShieldCheck,
  Layers,
  Plus,
  ArrowLeft,
  ArrowUpRight,
  Settings2,
  X,
  LogOut,
  Archive,
  RotateCcw,
  Check,
  Mail,
  Search,
} from "lucide-react";
import type { Identity, Organization } from "@/lib/rbac/model";
import type { Rbac } from "@/lib/rbac/service";
import NativeRolePanel from './native-role-panel';
type Workspace = ReturnType<Rbac["snapshot"]> & {
  initialized: true;
  revision: string;
};
type Uninitialized = {
  initialized: false;
  organization: Organization;
  canInitialize: boolean;
};
type View = "units" | "members" | "roles" | "activity" | "unit";
type Dialog = {
  kind:
    | "organization"
    | "initialize"
    | "settings"
    | "unit"
    | "member"
    | "assignment"
    | "invite"
    | "confirm";
  id?: string;
  name?: string;
  unitId?: string;
  userId?: string;
  role?: string;
  message?: string;
  path?: string;
  method?: string;
  body?: Record<string, unknown>;
};
const roleName = (role: string) =>
  ({
    "organization-owner": "Organization Owner",
    "organization-admin": "Organization Admin",
    "unit-admin": "Unit Admin",
    "unit-user": "Unit Member",
    member: "Membership only",
  })[role] || role;
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  revision?: string,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    cache: "no-store",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(revision ? { "If-Match": revision } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
export default function RbacPortal() {
  const [actor, setActor] = useState<Identity | null>(null),
    [organizations, setOrganizations] = useState<Organization[]>([]),
    [orgId, setOrgId] = useState(""),
    [data, setData] = useState<Workspace | Uninitialized | null>(null),
    [directory, setDirectory] = useState<Identity[]>([]),
    [view, setView] = useState<View>("units"),
    [unitId, setUnitId] = useState(""),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [mock, setMock] = useState(false),
    [demoUsers, setDemoUsers] = useState<
      { id: string; name: string; email: string }[]
    >([]),
    [query, setQuery] = useState(""),
    [accountMode, setAccountMode] = useState("existing"),
    [appointedRole, setAppointedRole] = useState("member"),
    [inviteLink, setInviteLink] = useState(""),
    [pendingInvite, setPendingInvite] = useState<{
      org: string;
      id: string;
      token: string;
    } | null>(null);
  const [importPreview, setImportPreview] = useState<
    { id: string; name: string; status: string }[]
  >([]);
  const generation = useRef(0),
    dialogRef = useRef<HTMLElement | null>(null),
    previousFocus = useRef<HTMLElement | null>(null);
  const workspace = data?.initialized ? data : null,
    base = `rbac/organizations/${encodeURIComponent(orgId)}`,
    unit = workspace?.units.find((u) => u.id === unitId),
    organizationAdmin = workspace?.organizationAdmin === true,
    organizationManager=workspace?.canManageOrganization===true;
  const profile = (id: string) =>
    directory.find((u) => u.id === id) || {
      name: id === actor?.id ? actor.name : "Unavailable IAM profile",
      email: id === actor?.id ? actor.email : "",
      active: false,
      verified: false,
    };
  async function refreshOrganizations() {
    const result = await api<{
      actor: Identity;
      organizations: Organization[];
    }>("rbac/organizations");
    setActor(result.actor);
    setOrganizations(result.organizations);
    return result;
  }
  async function openOrganization(id: string) {
    const current = ++generation.current;
    setOrgId(id);
    setData(null);
    setDirectory([]);
    setView("units");
    setUnitId("");
    setQuery("");
    setError("");
    setLoading(true);
    try {
      const [result, people] = await Promise.all([
        api<Workspace | Uninitialized>(
          `rbac/organizations/${encodeURIComponent(id)}`,
        ),
        api<{ users: Identity[] }>(
          `rbac/organizations/${encodeURIComponent(id)}/directory`,
        ),
      ]);
      if (current === generation.current) {
        setData(result);
        setDirectory(people.users);
      }
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  async function refresh() {
    if (orgId) {
      const [result, people] = await Promise.all([
        api<Workspace | Uninitialized>(base),
        api<{ users: Identity[] }>(`${base}/directory`),
      ]);
      setData(result);
      setDirectory(people.users);
    }
  }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await api<{ mockSelector: boolean }>("config");
        if (cancelled) return;
        setMock(config.mockSelector);
        if (config.mockSelector) {
          const result = await api<{
            users: { id: string; name: string; email: string }[];
          }>("auth/mock");
          if (!cancelled) setDemoUsers(result.users);
        }
        try {
          const result = await api<{
            actor: Identity;
            organizations: Organization[];
          }>("rbac/organizations");
          if (!cancelled) {
            setActor(result.actor);
            setOrganizations(result.organizations);
          }
        } catch {
          /* An unauthenticated visitor sees the login screen. */
        }
        const url = new URL(window.location.href);
        const invitationToken =
          url.searchParams.get("token") ||
          new URLSearchParams(url.hash.slice(1)).get("token");
        const inviteId = url.searchParams.get("invite");
        const inviteOrg = url.searchParams.get("organization");
        if (inviteId && invitationToken && inviteOrg) {
          const invite = {
            org: inviteOrg,
            id: inviteId,
            token: invitationToken,
          };
          if (!cancelled) setPendingInvite(invite);
          sessionStorage.setItem("atlas_pending_invitation",JSON.stringify(invite));
          url.searchParams.delete("token");
          url.searchParams.delete("invite");
          url.searchParams.delete("organization");
          window.history.replaceState({}, "", `${url.pathname}${url.search}`);
        } else if (inviteId && inviteOrg && !invitationToken) {
          const stored=sessionStorage.getItem("atlas_pending_invitation");
          try{
            const invite=stored?JSON.parse(stored):null;
            if(invite&&invite.org===inviteOrg&&invite.id===inviteId&&typeof invite.token==="string"){
              if(!cancelled)setPendingInvite(invite);
            }else{
              sessionStorage.removeItem("atlas_pending_invitation");
            }
          }catch{sessionStorage.removeItem("atlas_pending_invitation");}
        } else {
          const stored=sessionStorage.getItem("atlas_pending_invitation");
          if(stored){try{const invite=JSON.parse(stored);if(typeof invite.org==="string"&&typeof invite.id==="string"&&typeof invite.token==="string"&&!cancelled)setPendingInvite(invite);}catch{sessionStorage.removeItem("atlas_pending_invitation");}}
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!dialog) return;
    previousFocus.current = document.activeElement as HTMLElement;
    const first = dialogRef.current?.querySelector<HTMLElement>(
      "input,select,button",
    );
    first?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setDialog(null);
      if (e.key === "Tab") {
        const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previousFocus.current?.focus();
    };
  }, [dialog, busy]);
  async function signIn(id: string) {
    ++generation.current;
    setData(null);
    setDirectory([]);
    setInviteLink("");
    setNotice("");
    setBusy(true);
    setError("");
    try {
      await api("auth/mock", "POST", { userId: id });
      await refreshOrganizations();
      setData(null);
      setOrgId("");
      setDirectory([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    try {
      await api("auth/logout", "POST");
      ++generation.current;
      setActor(null);
      setOrgId("");
      setData(null);
      setDirectory([]);
      setDialog(null);
      setNotice("");
      setInviteLink("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function show(d: Dialog) {
    setError("");
    setAccountMode("existing");
    setAppointedRole(
      d.role ||
        (d.kind === "invite" && !d.unitId
          ? "member"
          : d.kind === "member"
            ? "member"
            : "unit-user"),
    );
    setDialog(d);
    if (d.kind === "initialize") {
      setImportPreview([]);
      void api<{ units: { id: string; name: string; status: string }[] }>(
        `${base}/import-preview`,
      )
        .then((r) => setImportPreview(r.units))
        .catch((e) => setError((e as Error).message));
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;
    setBusy(true);
    setError("");
    setInviteLink("");
    const formData=new FormData(event.currentTarget);
    const values = Object.fromEntries(
        formData.entries(),
      ),
      revision = workspace?.revision;
    try {
      if (dialog.kind === "organization") {
        const created=await api<{id:string;name?:string;initialized:boolean;companyOwner?:boolean}>("rbac/organizations", "POST", { name: values.name });
        const listed=await refreshOrganizations();
        if(!listed.organizations.some(o=>o.id===created.id))
          setOrganizations(current=>[{id:created.id,name:created.name||String(values.name),status:"active"},...current.filter(o=>o.id!==created.id)]);
        setDialog(null);
        if(created.initialized){
          setNotice("Company created. You are the Organization Owner.");
          await openOrganization(created.id);
        }else{
          setOrgId("");
          setData(null);
          setNotice("Organization created. Open it to appoint its first Organization Admin.");
        }
        return;
      } else if (dialog.kind === "initialize") {
        await api(`${base}/initialize`, "POST", {
          adminId: values.adminId,
          adminEmail: values.adminEmail,
          importLegacy: values.importLegacy === "on",
          accountMode: "existing",
        });
        await refresh();
        setNotice("Organization initialized. Assign unit roles explicitly.");
      } else if (dialog.kind === "settings") {
        await api(`${base}/settings`, "PATCH", { ...values, revision });
        await refresh();
        setNotice("Organization settings saved.");
      } else if (dialog.kind === "unit") {
        await api(
          `${base}/units${dialog.id ? `/${encodeURIComponent(dialog.id)}` : ""}`,
          dialog.id ? "PATCH" : "POST",
          { name: values.name, revision },
        );
        await refresh();
        setNotice("Unit saved. Memberships keep the same unit ID.");
      } else if (dialog.kind === "member") {
        await api(`${base}/members`, "POST", {
          ...values,
          userId: dialog.userId || values.userId,
          accountMode,
          revision,
        });
        await refresh();
        setNotice(
          "Organization membership saved. Unit access is assigned separately.",
        );
      } else if (dialog.kind === "assignment") {
        await api(
          `${base}/units/${encodeURIComponent(dialog.unitId!)}/members`,
          "POST",
          { userId: values.userId, role: values.role, revision },
        );
        await refresh();
        setNotice("Unit role saved.");
      } else if (dialog.kind === "invite") {
        const result = await api<{ id: string; token: string; emailStatus: "queued"|"failed"|"mock" }>(
          `${base}/invitations`,
          "POST",
          {
            email: values.email,
            scope: dialog.unitId ? "unit" : "organization",
            unitId: dialog.unitId,
            role: values.role,
            revision,
          },
        );
        setInviteLink(
          `${window.location.origin}/activate?organization=${encodeURIComponent(orgId)}&invite=${result.id}&token=${encodeURIComponent(result.token)}`,
        );
        await refresh();
        setNotice(
          result.emailStatus==="queued"
            ?"Invitation email sent. Ask the recipient to check their inbox (and spam) for the Atlas invitation, then sign in and accept."
            :result.emailStatus==="mock"
              ?"Invitation created in mock mode. No email was sent — use the link below, or run live mode to email the recipient."
              :"Invitation created, but the email could not be queued. Share the link below with the recipient, or retry after checking Blocks Mail.",
        );
      } else if (dialog.kind === "confirm") {
        await api(
          dialog.path!,
          dialog.method || "POST",
          dialog.method === "DELETE" ? undefined : { ...dialog.body, revision },
          dialog.method === "DELETE" ? revision : undefined,
        );
        await refresh();
        setNotice("Change saved.");
      }
      setDialog(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function acceptInvitation() {
    if (!pendingInvite) return;
    const org=pendingInvite.org;
    setBusy(true);
    setError("");
    try {
      await api(
        `rbac/organizations/${encodeURIComponent(org)}/invitations/${encodeURIComponent(pendingInvite.id)}/accept`,
        "POST",
        { token: pendingInvite.token },
      );
      setPendingInvite(null);
      sessionStorage.removeItem("atlas_pending_invitation");
      await refreshOrganizations();
      await openOrganization(org);
      setNotice(
        "Invitation accepted. Your current unit access is shown below.",
      );
    } catch (e) {
      const message=(e as Error).message;
      // A prior accept may have granted IAM membership before RBAC finished; open the workspace if possible.
      if(/already (a )?member/i.test(message)){
        try{
          await refreshOrganizations();
          await openOrganization(org);
          setPendingInvite(null);
          sessionStorage.removeItem("atlas_pending_invitation");
          setNotice("Invitation accepted. Your current unit access is shown below.");
          return;
        }catch{/* fall through to show the original error */}
      }
      if(/expired|revoked|already accepted|does not match your account|Invitation not found|no longer available/i.test(message)){
        setPendingInvite(null);
        sessionStorage.removeItem("atlas_pending_invitation");
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  }
  const banner = (
    <>
      {error && (
        <div className="rbac-alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="rbac-alert success" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      {inviteLink && (
        <div className="rbac-alert">
          <label>
            Invitation link
            <input aria-label="Invitation link" readOnly value={inviteLink} />
          </label>
          <button
            className="button secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(inviteLink);
                setNotice("Invitation link copied.");
              } catch {
                setError("Copy the invitation link from the field.");
              }
            }}
          >
            Copy link
          </button>
        </div>
      )}
    </>
  );
  if (!actor)
    return (
      <main className="rbac-login">
        <section>
          <div className="rbac-brand">
            <ShieldCheck />
            Atlas access
          </div>
          <span className="eyebrow">ORGANIZATIONS & UNITS</span>
          <h1>
            Give every person
            <br />
            the right access.
          </h1>
          <p>Manage organization memberships and unit roles in one place.</p>
          {banner}
          {loading ? (
            <p>Loading…</p>
          ) : mock ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void signIn(
                  String(new FormData(e.currentTarget).get("userId")),
                );
              }}
            >
              <label>
                Demo identity
                <select id="login-user" name="userId">
                  {demoUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.email}
                    </option>
                  ))}
                </select>
              </label>
              <button className="button primary" disabled={busy}>
                Enter workspace <ArrowUpRight size={17} />
              </button>
            </form>
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- OIDC requires a full HTTP navigation. */}
              <a className="button primary" href="/api/auth/oidc/start">
                Sign in with Blocks <ArrowUpRight size={17} />
              </a>
              {pendingInvite ? (
                <>
                  <a
                    className="button secondary"
                    href={`/activate?organization=${encodeURIComponent(pendingInvite.org)}&invite=${encodeURIComponent(pendingInvite.id)}&token=${encodeURIComponent(pendingInvite.token)}`}
                  >
                    Activate your account
                  </a>
                  <p>New invitees activate their account first, then sign in to accept the assigned role.</p>
                </>
              ):<>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Hosted signup requires full navigation. */}
                <a className="button secondary" href="/api/auth/oidc/start?flow=signup">Create your company account</a>
                <p>Sign up and verify your email, then create your company workspace.</p>
              </>}
            </>
          )}
          <small>Organization ownership and scoped workspace roles.</small>
        </section>
        <aside>
          <Building2 size={54} />
          <h2>
            One organization.
            <br />
            Independent units.
          </h2>
          <p>
            Organization Owners appoint Organization Admins. Admins create units
            and control Unit Admins and Unit Members.

          </p>
        </aside>
      </main>
    );
  return (
    <div className="rbac-shell">
      <aside className="rbac-sidebar">
        <div className="rbac-brand">
          <ShieldCheck />
          Atlas access
        </div>
        <span className="eyebrow">WORKSPACE</span>
        <button
          className={!orgId ? "active" : ""}
          onClick={() => {
            ++generation.current;
            setOrgId("");
            setData(null);
            setDirectory([]);
            setQuery("");
            setError("");
          }}
        >
          <Building2 size={19} />
          Organizations
        </button>
        {workspace && (
          <>
            <div className="rbac-nav-label">{workspace.name}</div>
            {(
              [
                { id: "units", name: workspace.layerLabel, icon: Layers },
                { id: "members", name: "Members", icon: Users },
                { id: "roles", name: "Roles & access", icon: ShieldCheck },
                { id: "activity", name: "Activity", icon: Check },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                className={
                  view === item.id || (view === "unit" && item.id === "units")
                    ? "active"
                    : ""
                }
                onClick={() => {
                  setView(item.id);
                  setQuery("");
                }}
              >
                <item.icon size={19} />
                {item.name}
              </button>
            ))}
          </>
        )}
        <div className="rbac-sidebar-bottom">
          <strong>{actor.name}</strong>
          <small>
            {actor.superAdmin
              ? "Application super-admin"
              : workspace?.companyOwner?"Organization Owner":organizationAdmin?"Organization Admin":"Organization member"}
          </small>
          {mock && (
            <label>
              Demo identity
              <select
                aria-label="Demo identity"
                value={actor.id}
                disabled={busy}
                onChange={(e) => void signIn(e.target.value)}
              >
                {demoUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button disabled={busy} onClick={() => void signOut()}>
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>
      <main className="rbac-main">
        <header className="rbac-topbar">
          <span>
            <ShieldCheck size={16} />
            Organization-scoped access
          </span>
          <span className="badge purple">
            {mock ? "Development mock" : "Blocks OS live"}
          </span>
        </header>
        {banner}
        {pendingInvite && (
          <div className="rbac-alert">
            <Mail size={20} />
            <span>
              You have a workspace invitation. Accept to receive the role
              selected by your administrator.
            </span>
            <button
              disabled={busy}
              className="button primary"
              onClick={() => void acceptInvitation()}
            >
              Accept invitation
            </button>
          </div>
        )}
        {!orgId ? (
          <>
            <div className="rbac-heading">
              <div>
                <span className="eyebrow">YOUR WORKSPACE</span>
                <h1>Organizations</h1>
                <p>Choose an organization to manage its units and people.</p>
              </div>
              {actor.verified && (
                <button
                  className="button primary"
                  onClick={() => show({ kind: "organization" })}
                >
                  <Plus size={18} />
                  {actor.superAdmin?"Create organization":"Create company"}
                </button>
              )}
            </div>
            <div className="rbac-org-grid">
              {organizations.map((org) => (
                <button
                  className="rbac-org-card"
                  key={org.id}
                  onClick={() => void openOrganization(org.id)}
                >
                  <span className="rbac-tile">
                    <Building2 size={25} />
                  </span>
                  <span>
                    <h2>{org.name}</h2>
                    <small>Open organization</small>
                  </span>
                  <ArrowUpRight size={20} />
                </button>
              ))}
            </div>
            {!organizations.length && (
              <div className="rbac-empty">
                <Building2 size={32} />
                <h2>No organization access</h2>
                <p>Create your company workspace, or accept an invitation to an existing organization.</p>
              </div>
            )}
          </>
        ) : loading ? (
          <div className="rbac-empty">Loading organization…</div>
        ) : data && !data.initialized ? (
          <>
            <div className="rbac-heading">
              <div>
                <span className="eyebrow">ORGANIZATION SETUP</span>
                <h1>{data.organization.name}</h1>
                <p>
                  Appoint the first Organization Admin and choose how to start.
                </p>
              </div>
            </div>
            <div className="rbac-panel rbac-setup">
              <ShieldCheck size={38} />
              <h2>A clear start for access</h2>
              <p>
                Organization members get no unit access until a role is
                assigned. Existing departments and groups can be copied as
                independent units; existing records stay intact.
              </p>
              {data.canInitialize ? (
                <button
                  className="button primary"
                  onClick={() => show({ kind: "initialize" })}
                >
                  Initialize organization
                </button>
              ) : (
                <p>
                  Ask your application super-admin to initialize this
                  organization.
                </p>
              )}
            </div>
          </>
        ) : workspace ? (
          <>
            <div className="rbac-heading">
              <div>
                <span className="eyebrow">{workspace.name.toUpperCase()}</span>
                <h1>
                  {view === "units"
                    ? workspace.layerLabel
                    : view === "unit"
                      ? unit?.name
                      : view === "members"
                        ? "Organization members"
                        : view === "roles"
                          ? "Roles & access"
                          : "Activity"}
                </h1>
                <p>
                  {view === "units"
                    ? "One layer of independent units. Access is assigned separately in each."
                    : view === "unit"
                      ? "People and roles in this unit. Other unit memberships remain independent."
                      : view === "members"
                        ? organizationAdmin && !organizationManager
                          ? "Create units and invite Unit Admins or Unit Members from each unit."
                          : "Organization membership alone gives no unit access."
                        : view === "roles"
                          ? "Four roles: Organization Owner, Organization Admin, Unit Admin, and Unit Member."
                          : "Who changed settings, units, roles and memberships."}
                </p>
              </div>
              <div className="rbac-actions">
                {view === "units" && organizationAdmin && (
                  <>
                    {organizationManager&&<button
                      className="button secondary"
                      onClick={() => show({ kind: "settings" })}
                    >
                      <Settings2 size={17} />
                      Settings
                    </button>}
                    <button
                      className="button primary"
                      onClick={() => show({ kind: "unit" })}
                    >
                      <Plus size={17} />
                      Create unit
                    </button>
                  </>
                )}
                {view === "members" && organizationManager && (
                  <>
                  {workspace.canInviteOrganization&&<button className="button secondary" onClick={()=>show({kind:"invite"})}><Mail size={17}/>Invite organization member</button>}
                  <button
                    className="button primary"
                    onClick={() => show({ kind: "member" })}
                  >
                    <Plus size={17} />
                    Add organization member
                  </button>
                  </>
                )}
                {view === "unit" &&
                  unit?.status === "active" &&
                  unit.canManage && (
                    <>
                      <button
                        className="button secondary"
                        onClick={() =>
                          show({ kind: "invite", unitId: unit.id })
                        }
                      >
                        <Mail size={17} />
                        Invite member
                      </button>
                      <button
                        className="button primary"
                        onClick={() =>
                          show({ kind: "assignment", unitId: unit.id })
                        }
                      >
                        <Plus size={17} />
                        Add unit member
                      </button>
                    </>
                  )}
              </div>
            </div>
            {view === "units" && (
              <>
                <div className="rbac-filter">
                  <label>
                    <Search size={17} />
                    <input
                      aria-label="Search units"
                      placeholder={`Search ${workspace.layerLabel.toLowerCase()}…`}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <span>
                    {workspace.units.length}{" "}
                    {workspace.layerLabel.toLowerCase()}
                  </span>
                </div>
                <div className="rbac-unit-grid">
                  {workspace.units
                    .filter((u) =>
                      u.name.toLowerCase().includes(query.toLowerCase()),
                    )
                    .map((u) => (
                      <article className="rbac-panel rbac-unit-card" key={u.id}>
                        <div>
                          <span className="rbac-tile">
                            <Layers size={22} />
                          </span>
                          <span
                            className={`badge ${u.status === "active" ? "green" : "gray"}`}
                          >
                            {u.status === "active" ? "Active" : "Archived"}
                          </span>
                        </div>
                        <h2>{u.name}</h2>
                        <p>
                          {u.status === "active"
                            ? roleName(u.role || "member")
                            : "Access paused. Memberships are retained."}
                        </p>
                        <div className="rbac-unit-footer">
                          <button
                            className="button secondary"
                            onClick={() => {
                              setUnitId(u.id);
                              setView("unit");
                            }}
                          >
                            Open unit <ArrowUpRight size={16} />
                          </button>
                          {u.canManage && organizationAdmin && (
                            <>
                              <button
                                aria-label={`Rename ${u.name}`}
                                onClick={() =>
                                  show({ kind: "unit", id: u.id, name: u.name })
                                }
                              >
                                <Settings2 size={17} />
                              </button>
                              <button
                                aria-label={`${u.status === "active" ? "Archive" : "Restore"} ${u.name}`}
                                onClick={() =>
                                  show({
                                    kind: "confirm",
                                    message:
                                      u.status === "active"
                                        ? `Archive ${u.name}? Unit access stops immediately. Its memberships stay available for restoration.`
                                        : `Restore ${u.name}? Existing memberships become active again.`,
                                    path: `${base}/units/${encodeURIComponent(u.id)}/status`,
                                    body: {
                                      status:
                                        u.status === "active"
                                          ? "archived"
                                          : "active",
                                    },
                                  })
                                }
                              >
                                {u.status === "active" ? (
                                  <Archive size={17} />
                                ) : (
                                  <RotateCcw size={17} />
                                )}
                              </button>
                            </>
                          )}
                        </div>
                      </article>
                    ))}
                </div>
                {!workspace.units.length && (
                  <div className="rbac-empty">
                    <Layers size={32} />
                    <h2>
                      {organizationAdmin
                        ? "Create your first unit"
                        : "No unit assignments"}
                    </h2>
                    <p>
                      {organizationAdmin
                        ? "Add units, then explicitly assign people and fixed roles."
                        : workspace.noAssignmentMessage}
                    </p>
                  </div>
                )}
              </>
            )}
            {view === "unit" && unit && (
              <>
                <button className="rbac-back" onClick={() => setView("units")}>
                  <ArrowLeft size={17} />
                  Back to {workspace.layerLabel.toLowerCase()}
                </button>
                {unit.status === "archived" ? (
                  <div className="rbac-empty">
                    <Archive size={30} />
                    <h2>This unit is archived</h2>
                    <p>
                      Restore the unit to reactivate its retained memberships.
                    </p>
                  </div>
                ) : (
                  <div className="rbac-panel table-wrap">
                    <table aria-label="Unit members">
                      <thead>
                        <tr>
                          <th>Person</th>
                          <th>Unit role</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workspace.assignments
                          .filter((m) => m.unitId === unit.id)
                          .map((m) => (
                            <tr key={m.userId}>
                              <td>
                                <strong>{profile(m.userId).name}</strong>
                                <small>{profile(m.userId).email}</small>
                              </td>
                              <td>
                                <span className="badge purple">
                                  {roleName(m.role)}
                                </span>
                              </td>
                              <td>
                                {unit.canManage &&
                                  (organizationAdmin ||
                                    (m.role === "unit-user" &&
                                      directory.find((u) => u.id === m.userId)
                                        ?.organizationRole !==
                                        "organization-admin")) && (
                                    <button
                                      className="rbac-danger"
                                      onClick={() =>
                                        show({
                                          kind: "confirm",
                                          message: `Remove ${profile(m.userId).name} from ${unit.name}? Their other unit memberships remain.`,
                                          path: `${base}/units/${encodeURIComponent(unit.id)}/members/${encodeURIComponent(m.userId)}`,
                                          method: "DELETE",
                                        })
                                      }
                                    >
                                      Remove
                                    </button>
                                  )}
                                {organizationAdmin && (
                                  <button
                                    onClick={() =>
                                      show({
                                        kind: "assignment",
                                        unitId: unit.id,
                                        userId: m.userId,
                                        role: m.role,
                                      })
                                    }
                                  >
                                    Change role
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {!workspace.assignments.some(
                      (m) => m.unitId === unit.id,
                    ) && (
                      <div className="rbac-empty">
                        No people assigned to this unit yet.
                      </div>
                    )}
                  </div>
                )}
                {unit.status === "active" &&
                  unit.canManage &&
                  workspace.invitations.some((i) => i.unitId === unit.id) && (
                    <div className="rbac-panel rbac-invitations">
                      <h2>Invitations</h2>
                      <p>
                        Recipients can sign in or sign up. Invitations expire
                        after seven days.
                      </p>
                      {workspace.invitations
                        .filter((i) => i.unitId === unit.id)
                        .map((i) => (
                          <div key={i.id}>
                            <span>
                              {i.email} · {roleName(i.role)} ·{" "}
                              {i.status === "pending" && i.expired
                                ? "expired"
                                : i.status}
                            </span>
                            {i.status === "pending" &&
                              (organizationAdmin || i.role === "unit-user") && (
                                <button
                                  onClick={() =>
                                    show({
                                      kind: "confirm",
                                      message: "Revoke this invitation?",
                                      path: `${base}/invitations/${i.id}`,
                                      method: "DELETE",
                                    })
                                  }
                                >
                                  Revoke
                                </button>
                              )}
                          </div>
                        ))}
                    </div>
                  )}
              </>
            )}
            {view === "members" && (
              <>
              <div className="rbac-panel table-wrap">
                <table aria-label="Organization members">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Organization role</th>
                      <th>Unit assignments</th>
                      {organizationManager && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {workspace.members.map((m) => (
                      <tr key={m.userId}>
                        <td>
                          <strong>{profile(m.userId).name}</strong>
                          <small>{profile(m.userId).email}</small>
                          {!profile(m.userId).active && (
                            <span className="badge gray">
                              IAM inactive / unavailable
                            </span>
                          )}
                        </td>
                        <td>{workspace.ownerId===m.userId?"Organization Owner":roleName(m.role)}</td>
                        <td>
                          {workspace.assignments
                            .filter((a) => a.userId === m.userId)
                            .map(
                              (a) =>
                                `${workspace.units.find((u) => u.id === a.unitId)?.name || "Unavailable unit"} · ${roleName(a.role)}`,
                            )
                            .join(", ") || "No unit assignments"}
                        </td>
                        {organizationManager && workspace.ownerId!==m.userId ? (
                          <td>
                            <button
                              onClick={() =>
                                show({
                                  kind: "member",
                                  userId: m.userId,
                                  role: m.role,
                                })
                              }
                            >
                              Change role
                            </button>
                            <button
                              className="rbac-danger"
                              onClick={() =>
                                show({
                                  kind: "confirm",
                                  message: `Remove ${profile(m.userId).name} from this organization? All of their RBAC unit access is revoked.`,
                                  path: `${base}/members/${encodeURIComponent(m.userId)}`,
                                  method: "DELETE",
                                })
                              }
                            >
                              Remove
                            </button>
                          </td>
                        ):organizationManager?<td>Organization Owner</td>:null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {workspace.canInviteOrganization&&workspace.invitations.some(i=>i.scope==="organization")&&<div className="rbac-panel rbac-invitations">
                <h2>Organization invitations</h2>
                {workspace.invitations.filter(i=>i.scope==="organization").map(i=><div key={i.id}>
                  <span>{i.email} · {roleName(i.role)} · {i.expired&&i.status==="pending"?"expired":i.status}</span>
                  {i.status==="pending"&&!i.expired&&<button className="rbac-danger" onClick={()=>show({kind:"confirm",message:"Revoke this organization invitation?",path:`${base}/invitations/${i.id}`,method:"DELETE"})}>Revoke</button>}
                </div>)}
              </div>}
              </>
            )}
            {view === "roles" && (
              <>
                {actor.superAdmin&&!mock&&<NativeRolePanel key={actor.id}/>}
                <div className="rbac-panel table-wrap"><h2>Who can manage whom in this workspace</h2>
                <table aria-label="Workspace role management"><thead><tr><th>Manager</th><th>Can manage</th><th>Boundary</th></tr></thead><tbody>
                  <tr><td>Organization Owner</td><td>Everything in the company, including Organization Admins and role management</td><td>Own company after signup</td></tr>
                  <tr><td>Organization Admin</td><td>Create units; invite and manage Unit Admins and Unit Members</td><td>All units in the company</td></tr>
                  <tr><td>Unit Admin</td><td>Invite and manage Unit Members</td><td>Assigned unit only, within what Organization Admin permits</td></tr>
                  <tr><td>Unit Member</td><td>No user or role management</td><td>Use only what Organization Admin permits in assigned units</td></tr>
                </tbody></table></div>
                <div className="rbac-role-grid">
                  {[
                    {name:"Organization Owner",scope:"Own company",items:["Assigned automatically when you create your company after signup","Create and manage all units and organization members","Appoint Organization Admins and control role management","Full access to every unit in the company"]},
                    {
                      name: "Organization Admin",
                      scope: "Company units",
                      items: [
                        "Added by the Organization Owner",
                        "Create units for the organization",
                        "Invite and manage Unit Admins and Unit Members",
                        "Control Unit Admin access inside units",
                      ],
                    },
                    {
                      name: "Unit Admin",
                      scope: "Assigned unit only",
                      items: [
                        "Invited or assigned by an Organization Admin",
                        "Invite Unit Members to their unit",
                        "Manage Unit Members within the unit",
                        "Cannot appoint Unit Admins or Organization Admins",
                      ],
                    },
                    {
                      name: "Unit Member",
                      scope: "Assigned unit only",
                      items: [
                        "Access only what Organization Admin permits",
                        "No membership or role management",
                        "Different roles can apply in different units",
                        "No access to unassigned units",
                      ],
                    },
                  ].map((role) => (
                    <article className="rbac-panel" key={role.name}>
                      <ShieldCheck size={27} />
                      <h2>{role.name}</h2>
                      <span className="badge purple">{role.scope}</span>
                      <ul>
                        {role.items.map((item) => (
                          <li key={item}>
                            <Check size={15} />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
                {actor.superAdmin && (
                  <p className="rbac-note">
                    Application super-admin is a separate platform role with
                    authority across organizations. Country membership alone
                    grants no unit access.
                  </p>
                )}
              </>
            )}
            {view === "activity" && (
              <div className="rbac-panel table-wrap">
                <table aria-label="Activity log">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Actor</th>
                      <th>Target</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workspace.events.map((event) => (
                      <tr key={event.id}>
                        <td>{event.action}</td>
                        <td>{profile(event.actorId).name}</td>
                        <td>
                          {workspace.units.find((u) => u.id === event.targetId)
                            ?.name || event.targetId}
                        </td>
                        <td>{new Date(event.timestamp).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!workspace.events.length && (
                  <div className="rbac-empty">No changes recorded yet.</div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="rbac-empty">
            <ShieldCheck size={32} />
            <h2>Organization could not load</h2>
            <p>Resolve the error above, then retry.</p>
            <button
              className="button secondary"
              onClick={() => void openOrganization(orgId)}
            >
              Retry
            </button>
          </div>
        )}
      </main>
      {dialog && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.currentTarget === e.target && !busy) setDialog(null);
          }}
        >
          <section
            ref={dialogRef}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rbac-dialog-title"
          >
            <div className="modal-heading">
              <h2 id="rbac-dialog-title">
                {
                  {
                    organization: actor.superAdmin?"Create organization":"Create company",
                    initialize: "Initialize organization",
                    settings: "Organization settings",
                    unit: dialog.id ? "Rename unit" : "Create unit",
                    member: dialog.userId
                      ? "Change organization role"
                      : "Add organization member",
                    assignment: dialog.userId
                      ? "Change unit role"
                      : "Add unit member",
                    invite: dialog.unitId?"Invite unit member by email":"Invite organization member by email",
                    confirm: "Confirm change",
                  }[dialog.kind]
                }
              </h2>
              <button
                disabled={busy}
                aria-label="Close dialog"
                onClick={() => setDialog(null)}
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={submit}>
              {dialog.kind === "confirm" ? (
                <p>{dialog.message}</p>
              ) : (
                <>
                  {["organization", "unit", "settings"].includes(
                    dialog.kind,
                  ) && (
                    <label>
                      Name
                      <input
                        name="name"
                        required
                        maxLength={120}
                        defaultValue={
                          dialog.name ||
                          (dialog.kind === "settings" ? workspace?.name : "")
                        }
                      />
                    </label>
                  )}
                  {dialog.kind === "settings" && (
                    <label>
                      Layer label
                      <input
                        name="layerLabel"
                        required
                        maxLength={40}
                        defaultValue={workspace?.layerLabel}
                        placeholder="Units, Departments or Teams"
                      />
                    </label>
                  )}
                  {dialog.kind === "initialize" && (
                    <>
                      <p>
                        Choose the first Organization Admin. Unit memberships
                        are assigned explicitly after setup.
                      </p>
                      {directory.some((u) => u.active && u.verified) ? (
                        <label>
                          Organization Admin
                          <select name="adminId" required>
                            <option value="">
                              Choose a verified IAM member
                            </option>
                            {directory
                              .filter((u) => u.active && u.verified)
                              .map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name} · {u.email}
                                </option>
                              ))}
                          </select>
                        </label>
                      ) : (
                        <label>
                          Existing Blocks account email
                          <input name="adminEmail" type="email" required />
                          <small>
                            This account must already be active and verified.
                            The backend will verify country membership before
                            setup.
                          </small>
                        </label>
                      )}
                      <label className="rbac-checkbox">
                        <input type="checkbox" name="importLegacy" />
                        Copy existing departments/groups as independent units
                      </label>
                      <p className="muted">
                        Groups get a parent/name label. Existing records and
                        role assignments are not changed or inherited.
                      </p>
                      {importPreview.length > 0 && (
                        <div className="rbac-import-preview">
                          <strong>
                            Import preview · {importPreview.length} independent
                            units
                          </strong>
                          <ul>
                            {importPreview.map((u) => (
                              <li key={u.id}>
                                {u.name} · {u.status}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                  {dialog.kind === "member" && (
                    <>
                      {dialog.userId ? (
                        <p>
                          {profile(dialog.userId).name} ·{" "}
                          {profile(dialog.userId).email}
                        </p>
                      ) : (
                        <>
                          <label>
                            Account
                            <select
                              value={accountMode}
                              onChange={(e) => setAccountMode(e.target.value)}
                            >
                              <option value="existing">
                                Existing IAM organization member
                              </option>
                              {(actor.superAdmin||workspace?.companyOwner) && !mock && (
                                <option value="provision">
                                  Add an existing Blocks account by email
                                </option>
                              )}
                              {(actor.superAdmin||workspace?.companyOwner) && !mock && (
                                <option value="new">Create account</option>
                              )}
                            </select>
                          </label>
                          {accountMode === "existing" ? (
                            <label>
                              Person
                              <select name="userId" required>
                                <option value="">Choose a person</option>
                                {directory
                                  .filter((u) => u.active && u.verified)
                                  .map((u) => (
                                    <option key={u.id} value={u.id}>
                                      {u.name} · {u.email}
                                    </option>
                                  ))}
                              </select>
                            </label>
                          ) : (
                            <>
                              <label>
                                Email
                                <input name="email" type="email" required />
                              </label>
                              {accountMode === "new" && (
                                <>
                                  <label>
                                    Full name
                                    <input
                                      name="name"
                                      required
                                      maxLength={120}
                                    />
                                  </label>
                                  <label>
                                    Initial password
                                    <input
                                      name="password"
                                      type="password"
                                      required
                                      minLength={8}
                                      maxLength={128}
                                      autoComplete="new-password"
                                    />
                                  </label>
                                  <p className="muted">
                                    Share the initial password directly. No
                                    email is sent.
                                  </p>
                                </>
                              )}
                            </>
                          )}
                        </>
                      )}
                      <label>
                        Organization role
                        <select
                          name="role"
                          value={appointedRole}
                          onChange={(e) => setAppointedRole(e.target.value)}
                        >
                          <option value="member">
                            Membership only — no unit access
                          </option>
                          <option value="organization-admin">
                            Organization Admin
                          </option>
                        </select>
                      </label>
                      <small>
                        The last active Organization Admin cannot be removed or
                        demoted.
                      </small>
                    </>
                  )}
                  {(dialog.kind === "assignment" ||
                    dialog.kind === "invite") && (
                    <>
                      {dialog.kind === "assignment" ? (
                        <label>
                          Person
                          <select
                            name="userId"
                            required
                            defaultValue={dialog.userId || ""}
                          >
                            <option value="">
                              Choose an organization member
                            </option>
                            {directory
                              .filter(
                                (u) =>
                                  u.active &&
                                  u.verified &&
                                  (organizationAdmin
                                    ? !!u.organizationRole ||
                                      workspace?.members.some(
                                        (m) => m.userId === u.id,
                                      )
                                    : u.organizationRole === "member" &&
                                      !workspace?.assignments.some(
                                        (m) =>
                                          m.userId === u.id &&
                                          m.unitId === dialog.unitId &&
                                          m.role === "unit-admin",
                                      )),
                              )
                              .map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name} · {u.email}
                                </option>
                              ))}
                          </select>
                        </label>
                      ) : (
                        <>
                          <label>
                            Recipient email
                            <input
                              type="email"
                              name="email"
                              autoComplete="email"
                              placeholder="member@yopmail.com"
                              maxLength={254}
                              required
                            />
                          </label>
                          <p className="muted">
                            Enter the recipient’s email. Atlas emails them the
                            invitation link automatically. New users open the
                            link to activate their account, then accept to get
                            the selected role.
                          </p>
                        </>
                      )}
                      <label>
                        {dialog.kind === "invite"&&!dialog.unitId?"Organization role":"Unit role"}
                        <select
                          name="role"
                          value={appointedRole}
                          onChange={(e) => setAppointedRole(e.target.value)}
                        >
                          {dialog.kind==="invite"&&!dialog.unitId?<><option value="member">Organization member — no unit access</option><option value="organization-admin">Organization Admin</option></>:<>
                          <option value="unit-user">Unit Member</option>
                          {organizationAdmin && (
                            <option value="unit-admin">Unit Admin</option>
                          )}
                          </>}
                        </select>
                      </label>
                    </>
                  )}
                </>
              )}
              {error && (
                <p className="rbac-alert error" role="alert">
                  {error}
                </p>
              )}
              <div className="modal-footer">
                <button
                  className="button secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => setDialog(null)}
                >
                  Cancel
                </button>
                <button className="button primary" disabled={busy}>
                  {busy
                    ? "Saving…"
                    : dialog.kind === "confirm"
                      ? "Confirm"
                      : dialog.kind === "invite"
                        ? "Create invitation"
                        : "Save changes"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
