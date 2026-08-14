"use client";

/**
 * ACCT-PROVISION — platform admin console.
 *
 * UI only: every mutation goes through /api/admin/* route handlers, and
 * the WORKER is the authorization layer (platform_admin principals or the
 * governed internal boundary).  Non-admin sessions see the denial state.
 */

import { useCallback, useEffect, useState } from "react";

interface Tenant {
  id: string;
  name: string;
  slug?: string;
  status?: string;
}

interface MembershipRow {
  user_id: string;
  cognito_sub: string;
  email: string;
  display_name: string;
  role: string;
  status: string;
}

const ROLES = ["viewer", "reviewer", "tenant_admin"];

export default function AdminPage() {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteTenant, setInviteTenant] = useState("");
  const [inviteRole, setInviteRole] = useState("reviewer");
  const [membersTenant, setMembersTenant] = useState("");
  const [members, setMembers] = useState<MembershipRow[]>([]);
  const [busy, setBusy] = useState(false);

  const loadTenants = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/tenants");
      if (res.status === 403) { setForbidden(true); return; }
      if (!res.ok) { setError("Failed to load companies"); return; }
      const data = await res.json();
      setTenants(data);
    } catch {
      setError("Network error");
    }
  }, []);

  useEffect(() => { loadTenants(); }, [loadTenants]);

  async function loadMembers(tenantId: string) {
    setMembersTenant(tenantId);
    if (!tenantId) { setMembers([]); return; }
    try {
      const res = await fetch(`/api/admin/memberships?tenantId=${encodeURIComponent(tenantId)}`);
      if (!res.ok) { setError("Failed to load memberships"); return; }
      setMembers(await res.json());
    } catch {
      setError("Network error");
    }
  }

  async function createCompany(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const res = await fetch("/api/admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: companyName }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to create company"); return; }
      setNotice(`Company created: ${data.id}`);
      setCompanyName("");
      await loadTenants();
    } finally { setBusy(false); }
  }

  async function inviteUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, tenantId: inviteTenant, role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Invitation failed"); return; }
      setNotice(
        data.temporaryPassword
          ? `Invited ${data.email} as ${data.role}. Temporary password: ${data.temporaryPassword} (dev only)`
          : `Invited ${data.email} as ${data.role}. They will receive the temporary password by email.`,
      );
      setInviteEmail("");
      await loadMembers(inviteTenant);
    } finally { setBusy(false); }
  }

  async function disableMembership(row: MembershipRow) {
    setBusy(true); setError(""); setNotice("");
    try {
      const res = await fetch("/api/admin/memberships/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: membersTenant, cognitoSub: row.cognito_sub }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || "Failed to disable membership"); return; }
      setNotice(`Membership disabled for ${row.email}`);
      await loadMembers(membersTenant);
    } finally { setBusy(false); }
  }

  if (forbidden) {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <h1>Platform admin required</h1>
        <p style={{ color: "var(--muted)" }}>Your account does not have platform administrator access.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1>Platform administration</h1>
      {error && <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)" }}>{error}</div>}
      {notice && <div className="card" style={{ borderColor: "var(--green)" }}>{notice}</div>}

      <section className="card">
        <h2>Create company</h2>
        <form onSubmit={createCompany}>
          <div className="form-group">
            <label htmlFor="companyName">Company name</label>
            <input id="companyName" value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>Create company</button>
        </form>
      </section>

      <section className="card">
        <h2>Invite user</h2>
        <form onSubmit={inviteUser}>
          <div className="form-group">
            <label htmlFor="inviteEmail">Email</label>
            <input id="inviteEmail" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
          </div>
          <div className="form-group">
            <label htmlFor="inviteTenant">Company</label>
            <select id="inviteTenant" value={inviteTenant} onChange={(e) => setInviteTenant(e.target.value)} required>
              <option value="">Select company…</option>
              {(tenants || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="inviteRole">Role</label>
            <select id="inviteRole" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>Invite user</button>
        </form>
      </section>

      <section className="card">
        <h2>Memberships</h2>
        <div className="form-group">
          <label htmlFor="membersTenant">Company</label>
          <select id="membersTenant" value={membersTenant} onChange={(e) => loadMembers(e.target.value)}>
            <option value="">Select company…</option>
            {(tenants || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        {members.length > 0 && (
          <table className="card" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Email</th>
                <th style={{ textAlign: "left" }}>Role</th>
                <th style={{ textAlign: "left" }}>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={`${m.user_id}-${m.role}`}>
                  <td>{m.email}</td>
                  <td>{m.role}</td>
                  <td>{m.status}</td>
                  <td>
                    {m.status === "active" && (
                      <button type="button" className="btn" disabled={busy} onClick={() => disableMembership(m)}>
                        Disable
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {membersTenant && members.length === 0 && <p style={{ color: "var(--muted)" }}>No members in this company.</p>}
      </section>
    </div>
  );
}
