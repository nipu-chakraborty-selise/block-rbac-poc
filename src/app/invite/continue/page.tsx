"use client";

import { useEffect, useState } from "react";

/**
 * Mail clients strip URL fragments. Email links land here with the token in the
 * query string; we immediately move it into the fragment and drop the query token.
 */
export default function InviteContinuePage() {
  const [error, setError] = useState("");

  useEffect(() => {
    const url = new URL(window.location.href);
    const org = url.searchParams.get("organization");
    const id = url.searchParams.get("invite");
    const token = url.searchParams.get("token");
    if (!org || !id || !token) {
      setError("Open the invitation link from your email to continue.");
      return;
    }
    const next = new URL("/activate", window.location.origin);
    next.searchParams.set("organization", org);
    next.searchParams.set("invite", id);
    next.hash = `token=${encodeURIComponent(token)}`;
    window.location.replace(`${next.pathname}${next.search}${next.hash}`);
  }, []);

  return (
    <main className="rbac-empty">
      <h1>{error || "Opening your invitation…"}</h1>
      {error ? (
        <p>Ask your administrator for a new organization or unit invitation link.</p>
      ) : (
        <p>Moving you to account activation. Keep this tab open.</p>
      )}
    </main>
  );
}
