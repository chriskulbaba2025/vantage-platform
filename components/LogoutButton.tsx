"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="btn"
      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--muted)" }}
    >
      Sign out
    </button>
  );
}
