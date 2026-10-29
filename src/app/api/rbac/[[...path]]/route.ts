import { rbacHandler } from "@/lib/rbac/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = rbacHandler;
export const POST = rbacHandler;
export const PATCH = rbacHandler;
export const DELETE = rbacHandler;
