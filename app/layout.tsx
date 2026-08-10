import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prysm — Website Audit Platform",
  description: "Evidence-grounded website decision system",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="app-header">
          <div className="container">
            <a href="/" className="app-logo">Prysm</a>
            <nav className="app-nav">
              <a href="/">Dashboard</a>
              <a href="/audits/new">New Audit</a>
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
