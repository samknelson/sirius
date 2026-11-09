import { afterAll, expect, it, vi } from "vitest";
import { pool } from "../../server/storage/db";
import { createAdvisoryLockStorage } from "../../server/storage/advisory-lock";

afterAll(async () => { await pool.end(); });

it("checks real PostgreSQL session ownership without reentering the lock, including negative hash values", async () => {
  const locks = createAdvisoryLockStorage();
  const candidate = await pool.query<{ name: string }>(
    "SELECT 'recovery-verify-' || n AS name FROM generate_series(1,100) n WHERE hashtext('recovery-verify-' || n) < 0 LIMIT 1",
  );
  const name = candidate.rows[0].name;
  const handle = await locks.tryAcquireSession(name, { timeoutMs: 0 });
  expect(handle).not.toBeNull();
  try {
    await handle!.assertHeld();
    await handle!.assertHeld();
    expect(await locks.tryAcquireSession(name, { timeoutMs: 0 })).toBeNull();
  } finally { await handle!.release(); }
  await expect(handle!.assertHeld()).rejects.toThrow();
  const next = await locks.tryAcquireSession(name, { timeoutMs: 0 });
  expect(next).not.toBeNull();
  await next!.release();
});

it("detects termination of its own dedicated session and releases the lock for another worker", async () => {
  const connect = pool.connect.bind(pool);
  let captured: any;
  const spy = vi.spyOn(pool, "connect").mockImplementation((async () => {
    captured = await connect();
    return captured;
  }) as any);
  const locks = createAdvisoryLockStorage();
  const name = "recovery-verify-terminated";
  const handle = await locks.tryAcquireSession(name, { timeoutMs: 0 });
  const pid = (await captured.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  spy.mockRestore();
  try {
    await pool.query("SELECT pg_terminate_backend($1)", [pid]);
    await expect(handle!.assertHeld()).rejects.toThrow();
  } finally { await handle!.release(); }
  const next = await locks.tryAcquireSession(name, { timeoutMs: 0 });
  expect(next).not.toBeNull();
  await next!.assertHeld();
  await next!.release();
});
