import { handle } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function dispatch(req: Request) {
  const root = new URL(req.url).pathname.replace(/^\/api\/?/, "").split("/")[0];
  if (!["auth", "config", "me"].includes(root))
    return Response.json(
      {
        error:
          "The legacy hierarchy/resource API is retired. Use /api/rbac/organizations for organization and unit RBAC.",
      },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  return handle(req);
}
export const GET = dispatch;
export const POST = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
