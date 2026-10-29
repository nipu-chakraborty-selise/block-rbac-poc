import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AppError } from "./model";
import { Application } from "./service";
import { MemoryStore } from "./store";
import { seed } from "./seed";
import { provisionUser } from "./live-users";
import { liveRequest, liveRepository } from "./live-workspace";
import { runtimeConfig,tokens,userClient } from "./blocks-runtime";
import { verifyIdentity,sessionCookie,liveSession } from "./live-auth";
import {
  activateInvitationAccount,
  previewInvitation,
} from "./rbac/activate-invitation";
import {
  mode,
  mockDevelopment,
  requireMockRuntime,
} from "./adapters";
let cached: Application | undefined;
export function application() {
  requireMockRuntime();
  if (!cached) {
    const store = new MemoryStore();
    seed(store);
    cached = new Application(store);
  }
  return cached;
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function createHandler(getApp = application) {
  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url),
      parts = url.pathname
        .replace(/^\/api\/?/, "")
        .split("/")
        .filter(Boolean),
      method = req.method;
    let flush:(()=>Promise<void>)|undefined;
    let liveCookie:string|undefined;
    const json = async (
      data: unknown,
      status = 200,
      headers: Record<string, string> = {},
    ) => {
      if(flush&&method!=="GET"){const commit=flush;flush=undefined;await commit();}
      return Response.json(data, {
        status,
        headers: { "Cache-Control": "no-store", ...(liveCookie?{"Set-Cookie":liveCookie}:{}), ...headers },
      });
    };
    try {
      if (parts[0] === "config" && method === "GET")
        return await json({
          mode: mode(),
          mockSelector: mockDevelopment(),
          liveBlockers: [],
          ...(mode()==="live"?{runtime:runtimeConfig(),storage:"Blocks Data Gateway"}:{storage:"In-memory mock"}),
        });
      if (parts[0] === "auth" && parts[1] === "mock" && !mockDevelopment())
        throw new AppError(
          404,
          "Mock identity selection is available only in development mock mode.",
        );

      if (method !== "GET") {
        if (
          req.headers.get("origin") !==
          ((mode() === "live" ? process.env["APP_ORIGIN"] : undefined) ||
            `${url.protocol}//${req.headers.get("host") || url.host}`)
        )
          throw new AppError(403, "Same-origin request required.");
        if (Number(req.headers.get("content-length") || 0) > 32000)
          throw new AppError(413, "Request is too large.");
      }
      let b: Record<string, unknown> = {};
      if (method === "POST" || method === "PATCH") {
        const raw = await req.text();
        if (raw.length > 32000)
          throw new AppError(413, "Request is too large.");
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
              throw new Error();
            b = parsed;
          } catch {
            throw new AppError(400, "Invalid JSON body.");
          }
        }
      }
      if(mode()==='live'&&parts[0]==='auth'&&parts[1]==='session'&&method==='POST'){
        if(typeof b.accessToken!=='string'||!b.accessToken)throw new AppError(401,'Blocks callback access token is required.');
        const user=await verifyIdentity(b.accessToken);
        const session=tokens({access_token:b.accessToken,refresh_token:typeof b.refreshToken==='string'?b.refreshToken:'',expires_in:300});
        return await json({user},200,{'Set-Cookie':sessionCookie(session)});
      }
      if(mode()==='live'&&parts[0]==='auth'&&parts[1]==='logout'&&method==='POST'){
        const identity=await liveSession(req);
        await userClient(identity.session.access).auth.logout({refreshToken:identity.session.refresh});
        return await json({success:true},200,{'Set-Cookie':'atlas_live=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'});
      }
      if(parts[0]==='auth'&&parts[1]==='invitation-preview'&&method==='GET'){
        return await json(await previewInvitation({
          organizationId:String(url.searchParams.get('organization')||''),
          inviteId:String(url.searchParams.get('invite')||''),
          token:String(url.searchParams.get('token')||''),
        }));
      }
      if(parts[0]==='auth'&&parts[1]==='activate-invitation'&&method==='POST'){
        return await json(await activateInvitationAccount({
          organizationId:String(b.organizationId||''),
          inviteId:String(b.inviteId||''),
          token:String(b.token||''),
          firstName:String(b.firstName||''),
          lastName:String(b.lastName||''),
          password:String(b.password||''),
          code:typeof b.code==='string'?b.code:undefined,
        }));
      }
      const live=mode()==='live'?await liveRequest(req):undefined;
      const app=live?.app||getApp(),store=app.store;
      flush=live?.flush;liveCookie=live?.cookie;
      if(live&&parts[0]==='auth'&&parts[1]==='logout'&&method==='POST'){
        await userClient(live.session.access).auth.logout({refreshToken:live.session.refresh});
        return await json({success:true},200,{'Set-Cookie':'atlas_live=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'});
      }
      if(live&&((parts[0]==='invitations'&&parts[2]==='accept')||(parts[0]==='countries'&&parts[2]==='invitations'&&method==='POST')))
        throw new AppError(503,'Live invitations are unavailable until signup delivery and atomic scope activation are verified. No mock invitation or assignment was created.');
      const token = req.headers
        .get("cookie")
        ?.split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("poc_session="))
        ?.slice(12);
      // Mock sessions remain in process memory, separate from authoritative user records.
      const sessions = store as MemoryStore;
      const session = !live&&token ? sessions.session(hash(token)) : undefined;
      if (parts[0] === "auth" && parts[1] === "mock") {
        if (method === "GET")
          return await json({
            users: store
              .all("users")
              .map((u) => ({
                id: u.id,
                name: u.name,
                email: u.email,
                label:
                  u.id === "super"
                    ? "Application super-admin"
                    : store.all("memberships").find((m) => m.userId === u.id)
                        ?.scopeId || "No assignments",
              })),
          });
        if (method === "POST") {
          const user = app.auth.identity(
            typeof b.userId === "string" ? b.userId : undefined,
          );
          if (token) sessions.removeSession(hash(token));
          const secret = randomBytes(32).toString("hex");
          sessions.saveSession(hash(secret), {userId:user.id,expiresAt:Date.now()+8*3600000});
          return await json({ user }, 200, {
            "Set-Cookie": `poc_session=${secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
          });
        }
      }
      if (parts[0] === "auth" && parts[1] === "logout" && method === "POST") {
        if (token) sessions.removeSession(hash(token));
        return await json({ success: true }, 200, {
          "Set-Cookie":
            "poc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        });
      }
      const user = app.auth.identity(live?.user.id||session?.userId as string | undefined);
      if (parts[0] === "me" && method === "GET")
        return await json({
          user,
          superAdmin: app.auth.super(user),
          countries: store
            .all("countries")
            .filter(
              (c) =>
                c.status === "active" &&
                (app.auth.super(user) || user.countryIds.includes(c.id)),
            ),
        });
      if (parts[0] === "admin-grants" && method === "POST")
        return await json(app.grantSuper(user, String(b.userId || "")), 201);
      if (
        parts[0] === "invitations" &&
        parts[2] === "accept" &&
        method === "POST"
      )
        return await json(app.accept(user, parts[1]));
      if (parts[0] === "invitations" && parts[1] && method === "GET") {
        const i = store.get("invitations", parts[1]);
        if (!i) throw new AppError(404, "Invitation not found.");
        if (i.email !== user.email.toLowerCase())
          throw new AppError(403, "Sign in with the invitation recipient.");
        const scope = {
          countryId: i.countryOrganizationId,
          type: i.scopeType,
          id: i.scopeId,
        };
        const target = app.auth.target(scope);
        return await json({
          ...i,
          status:
            i.status === "pending" && Date.parse(i.expiresAt) <= Date.now()
              ? "expired"
              : i.status,
          location: target.name,
          country: store.get("countries", i.countryOrganizationId)?.name,
        });
      }
      if (parts[0] !== "countries" || !parts[1])
        throw new AppError(404, "Endpoint not found.");
      const countryId = parts[1];
      if (parts.length === 2 && method === "PATCH")
        return await json(app.countrySave(user, countryId, b));
      app.auth.country(user, countryId);
      if (parts[2] === "switch" && method === "POST") {
        app.auth.country(user,countryId);
        if(live&&!app.auth.super(user)){const switched=await userClient(live.session.access).auth.switchOrganization({organization_id:countryId,refreshToken:live.session.refresh});const next=tokens(switched);liveCookie=sessionCookie({...next,refresh:next.refresh||live.session.refresh});}
        return await json({country:app.auth.country(user,countryId),user,effectiveAccess:app.snapshot(user,countryId).access});
      }
      if (parts[2] === "workspace" && method === "GET")
        return await json(app.snapshot(user, countryId));
      if (parts[2] === "departments" || parts[2] === "groups") {
        const type = parts[2] === "departments" ? "department" : "group",
          id = parts[3];
        if (method === "POST" && !id)
          return await json(
            app.hierarchySave(user, countryId, type, undefined, b),
            201,
          );
        if (id && method === "PATCH")
          return await json(app.hierarchySave(user, countryId, type, id, b));
        if (id && method === "DELETE")
          return await json(app.archive(user, countryId, type, id));
        if (id && method === "GET") {
          app.auth.require(user, `${type}.view`, { countryId, type, id });
          return await json(store.get(parts[2], id));
        }
        if (!id && method === "GET") {
          const rows = app.snapshot(user, countryId)[parts[2]];
          const page = Math.max(1, Number(url.searchParams.get("page")) || 1),
            size = Math.min(
              100,
              Math.max(1, Number(url.searchParams.get("pageSize")) || 20),
            );
          return await json({
            items: rows.slice((page - 1) * size, page * size),
            total: rows.length,
            page,
          });
        }
      }
      if (parts[2] === "resources") {
        const id = parts[3];
        if (method === "POST" && !id)
          return await json(app.resourceSave(user, countryId, undefined, b), 201);
        if (id && method === "PATCH")
          return await json(app.resourceSave(user, countryId, id, b));
        if (id && method === "DELETE")
          return await json(app.resourceDelete(user, countryId, id));
        if (id && method === "GET") {
          const { r, scope } = app.scopeForResource(id, countryId);
          app.auth.require(user, "resource.view", scope);
          return await json(r);
        }
        if (!id && method === "GET") {
          const rows = app.snapshot(user, countryId).resources;
          const page = Math.max(1, Number(url.searchParams.get("page")) || 1),
            size = Math.min(
              100,
              Math.max(1, Number(url.searchParams.get("pageSize")) || 20),
            );
          return await json({
            items: rows.slice((page - 1) * size, page * size),
            total: rows.length,
            page,
          });
        }
      }
      if (parts[2] === "users" && method === "POST" && !parts[3]) {
        app.validateUserAddition(user,countryId,b);
        let target;
        if(live) {
          const repository=liveRepository();
          const intent={id:randomUUID(),actorId:user.id,action:"iam.user-add.requested",countryOrganizationId:countryId,scopeId:typeof b.scopeId==="string"?b.scopeId:"country",targetId:typeof b.email==="string"?b.email.trim().toLowerCase():"unknown",timestamp:new Date().toISOString()};
          const itemId=await repository.create("audit",intent);
          target=await provisionUser(countryId,b);
          try {await repository.update("audit",itemId,{...intent,action:"iam.country-membership.confirmed",targetId:target.id});}
          catch {console.error("IAM membership confirmed; its audit intent needs reconciliation.");}
        }
        else {
          const email=typeof b.email==="string"?b.email.trim().toLowerCase():"";
          target=store.all("users").find(u=>u.email.toLowerCase()===email);
          if(!target) throw new AppError(422,"Use an existing verified demo account in mock mode.");
        }
        const result=app.addUser(user,countryId,target,b);
        try { return await json(result,201); }
        catch { throw new AppError(503,"IAM country membership is in place, but the scoped Data save failed. Refresh before retrying; no additional IAM permissions were granted."); }
      }
      if (parts[2] === "roles" && (method === "POST" || method === "PATCH"))
        return await json(
          app.roleSave(user, countryId, parts[3], b),
          method === "POST" ? 201 : 200,
        );
      if (
        parts[2] === "memberships" &&
        parts[3] &&
        (method === "PATCH" || method === "DELETE")
      )
        return await json(
          app.membershipChange(
            user,
            countryId,
            parts[3],
            b,
            method === "DELETE",
          ),
        );
      if (parts[2] === "invitations") {
        if (method === "POST" && !parts[3])
          return await json(app.invite(user, countryId, b), 201);
        if (parts[3] && method === "DELETE")
          return await json(app.revoke(user, countryId, parts[3]));
      }
      throw new AppError(404, "Endpoint not found.");
    } catch (e) {
      flush=undefined;
      if (e instanceof AppError) return await json({ error: e.message }, e.status);
      console.error(
        "Request failed",
        e instanceof Error ? e.message : "Unknown error",
      );
      return await json({ error: "Unexpected server error." }, 500);
    }
  };
}
export const handle = createHandler();
