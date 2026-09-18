import test from "node:test";
import assert from "node:assert/strict";
import { Server } from "node:http";

// Importing server.js constructs the ordinary local runtime. Suppress only
// listen() so this test exercises the real module without opening a port.
process.env.NODE_ENV = "development";
process.env.VANTAGE_DEV_MEMORY_STORE = "true";
process.env.PRYSM_LOCAL_PERSISTENCE = "false";
delete process.env.DATABASE_URL;

const originalListen = Server.prototype.listen;
Server.prototype.listen = function suppressedListen() { return this; };

let initializeConfiguredPostgres;
try {
  ({ initializeConfiguredPostgres } = await import("../server.js"));
} finally {
  Server.prototype.listen = originalListen;
}

function fakePostgres({ query, end } = {}) {
  const calls = [];
  const pool = {
    async query(sql) {
      calls.push(sql);
      return query ? query(sql, calls) : { rows: [] };
    },
    async end() {
      calls.push("POOL_END");
      if (end) await end();
    },
  };
  return { calls, pool, importPg: async () => ({ Pool: class { constructor() { return pool; } } }) };
}

test("DATABASE_URL connection failure is startup-fatal and never reaches fallback factories", async () => {
  const pg = fakePostgres({
    query: async (sql) => {
      if (sql === "SELECT 1") throw new Error("connection refused");
      return { rows: [] };
    },
  });
  let lifecycleFallbackCalls = 0;
  let identityFallbackCalls = 0;

  await assert.rejects(
    initializeConfiguredPostgres({
      databaseUrl: "postgres://broken",
      importPg: pg.importPg,
      createLifecycleRepository: () => { lifecycleFallbackCalls += 1; throw new Error("must not run"); },
      createIdentityRepository: () => { identityFallbackCalls += 1; throw new Error("must not run"); },
    }),
    /PostgreSQL startup initialization failed: connection refused/,
  );
  assert.equal(lifecycleFallbackCalls, 0);
  assert.equal(identityFallbackCalls, 0);
  assert.ok(pg.calls.includes("POOL_END"));
});

test("DATABASE_URL migration failure is startup-fatal and identity initialization is not attempted", async () => {
  const pg = fakePostgres();
  let identityCalls = 0;

  await assert.rejects(
    initializeConfiguredPostgres({
      databaseUrl: "postgres://migration-failure",
      importPg: pg.importPg,
      createLifecycleRepository: () => ({ runMigration: async () => { throw new Error("migration failed"); } }),
      createIdentityRepository: () => { identityCalls += 1; throw new Error("must not run"); },
    }),
    /PostgreSQL startup initialization failed: migration failed/,
  );
  assert.equal(identityCalls, 0);
  assert.ok(pg.calls.includes("POOL_END"));
});

test("DATABASE_URL identity initialization failure is startup-fatal with no mixed runtime", async () => {
  const pg = fakePostgres();
  let identityCalls = 0;

  await assert.rejects(
    initializeConfiguredPostgres({
      databaseUrl: "postgres://identity-failure",
      importPg: pg.importPg,
      createLifecycleRepository: () => ({ runMigration: async () => {} }),
      createIdentityRepository: () => {
        identityCalls += 1;
        return { listTenants: async () => { throw new Error("identity schema unavailable"); } };
      },
    }),
    /PostgreSQL startup initialization failed: identity schema unavailable/,
  );
  assert.equal(identityCalls, 1);
  assert.ok(pg.calls.includes("POOL_END"));
});

test("DATABASE_URL success selects PostgreSQL lifecycle and identity repositories", async () => {
  const pg = fakePostgres();
  const lifecycleRepo = { runMigration: async () => {} };
  const identityRepo = { listTenants: async () => ({ rows: [] }) };

  const result = await initializeConfiguredPostgres({
    databaseUrl: "postgres://valid",
    importPg: pg.importPg,
    createLifecycleRepository: () => lifecycleRepo,
    createIdentityRepository: () => identityRepo,
  });

  assert.equal(result.lifecycleRepo, lifecycleRepo);
  assert.equal(result.identityRepo, identityRepo);
  assert.equal(pg.calls[0], "SELECT 1");
  assert.equal(pg.calls.includes("POOL_END"), false);
});

test("DATABASE_URL absent leaves configured PostgreSQL path unused for governed local fallback", async () => {
  let importCalls = 0;
  assert.equal(
    await initializeConfiguredPostgres({
      databaseUrl: "",
      importPg: async () => { importCalls += 1; throw new Error("must not import pg"); },
    }),
    null,
  );
  assert.equal(importCalls, 0);
});
