import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Atlas • Organization & access",
  description: "Scoped organization and role management proof of concept",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
