/**
 * Local-development history adapter for the in-memory lifecycle repository.
 *
 * PostgreSQL remains the production history implementation. This wrapper is
 * used only by the explicit local memory-store composition path.
 */
export function addListByTenantToLocalMemoryRepo(lifecycleRepo) {
  if (typeof lifecycleRepo?._clear !== "function") return lifecycleRepo;

  const wrapped = Object.create(lifecycleRepo);
  const auditMeta = new Map();

  wrapped.listByTenant = async function listByTenant(tenantId) {
    const results = [];

    for (const [auditId, meta] of auditMeta) {
      if (meta.tenantId !== tenantId) continue;

      try {
        const events = await lifecycleRepo.loadEvents(auditId, tenantId);
        const latest = events.length > 0 ? events[events.length - 1] : null;
        results.push({
          audit_id: auditId,
          client_id: meta.clientId || "",
          business_name: meta.businessName || "",
          target_url: meta.targetUrl || "",
          created_at: meta.createdAt || (events.length > 0 ? events[0].timestamp : null),
          latest_state: latest ? latest.nextState : "created",
          updated_at: latest ? latest.timestamp : null,
        });
      } catch {
        // Skip records that fail the repository's tenant-isolated load.
      }
    }

    results.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    return results;
  };

  const originalCreateAudit = lifecycleRepo.createAudit.bind(lifecycleRepo);
  wrapped.createAudit = async function createAudit(opts) {
    auditMeta.set(opts.auditId, {
      tenantId: opts.tenantId,
      clientId: opts.clientId,
      createdAt: opts.event?.timestamp || new Date().toISOString(),
      businessName: opts.businessName || "",
      targetUrl: opts.targetUrl || "",
    });
    return originalCreateAudit(opts);
  };

  return wrapped;
}
