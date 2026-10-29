"use client";

import { useEffect } from "react";

/** Continue fragment-based mail links; also lets already-sent legacy links finish. */
export default function InviteContinuePage() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const org = url.searchParams.get("organization");
    const id = url.searchParams.get("invite");
    const token = new URLSearchParams(url.hash.slice(1)).get("token") || url.searchParams.get("token");
    if (!org || !id || !token) return;
    const next = new URL("/activate", window.location.origin);
    next.searchParams.set("organization", org);
    next.searchParams.set("invite", id);
    next.hash = `token=${encodeURIComponent(token)}`;
    window.location.replace(`${next.pathname}${next.search}${next.hash}`);
  }, []);

  return (
    <main className="rbac-empty">
      <h1>Continue to account activation</h1>
      <p>Opening your invitation…</p>
      <p>If you are not redirected, open the complete invitation link from your email, or ask your administrator for a new link.</p>
    </main>
  );
}
