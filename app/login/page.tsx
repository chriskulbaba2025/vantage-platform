"use client";

/**
 * Login page — authenticates against the identity provider through the
 * server-side /api/auth/login route.  Credentials are never stored or
 * exposed to client bundles.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [challenge, setChallenge] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const body = challenge ? { email, newPassword } : { email, password };
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Invalid credentials");
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (data.challenge === "NEW_PASSWORD_REQUIRED") {
        // Invite flow: Cognito accepted the temporary password — the user
        // now chooses their own.
        setChallenge(true);
        setError("");
        return;
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNewPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword.length < 8) {
      setError("The new password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("The passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, newPassword }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not set the new password");
        return;
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  if (challenge) {
    return (
      <div style={{ maxWidth: 420, margin: "0 auto" }}>
        <h1>Set your password</h1>
        <p style={{ color: "var(--muted)" }}>
          Your account was created with a temporary password. Choose your own password now.
        </p>
        {error && <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)" }}>{error}</div>}
        <form onSubmit={handleNewPasswordSubmit} className="card">
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} disabled />
          </div>
          <div className="form-group">
            <label htmlFor="newPassword">New password (min 8 characters)</label>
            <input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm new password</label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "Saving…" : "Set password and sign in"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 420, margin: "0 auto" }}>
      <h1>Sign in to Prysm</h1>
      <p style={{ color: "var(--muted)" }}>Use your Prysm portal account.</p>
      {error && <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)" }}>{error}</div>}
      <form onSubmit={handleSubmit} className="card">
        <div className="form-group">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
