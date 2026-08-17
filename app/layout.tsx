import type { Metadata } from "next";
import "./globals.css";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/identity/session";
import LogoutButton from "@/components/LogoutButton";

export const metadata: Metadata = {
  title: "Prysm — Website Audit Platform",
  description: "Evidence-grounded website decision system",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const authenticated = Boolean(cookies().get(SESSION_COOKIE)?.value);
  return (
    <html lang="en">
      <body>
        <header className="app-header">
          <div className="container">
            <a href="/" className="app-logo">Prysm</a>
            <nav className="app-nav">
              <a href="/">Dashboard</a>
              <a href="/audits/new">New Audit</a>
              {/* PRYSM-NEXT-ACTIVATION defect D — the platform-admin console
                  must be reachable through normal product navigation.  The
                  page itself (and the worker admin boundary) enforce the
                  platform_admin role server-side; non-admins see the
                  governed denial state. */}
              {authenticated ? <a href="/admin">Admin</a> : null}
              {authenticated ? <LogoutButton /> : <a href="/login">Sign in</a>}
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
