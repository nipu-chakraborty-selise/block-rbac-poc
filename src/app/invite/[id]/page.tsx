import Link from "next/link";
export default function Page() {
  return (
    <main className="rbac-empty">
      <h1>Legacy invitation retired</h1>
      <p>Ask your administrator for a new organization/unit invitation link.</p>
      <Link className="button primary" href="/">
        Open workspace
      </Link>
    </main>
  );
}
