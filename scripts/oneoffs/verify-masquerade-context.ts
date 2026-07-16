/**
 * One-off check for Task #756: while masquerading, the request context's
 * effective actor must be the masqueraded user, with the real user preserved
 * in originalUserId/originalUserEmail. Exercises the real middleware.
 *
 * Run: npx tsx scripts/oneoffs/verify-masquerade-context.ts
 */
import { storage } from "../../server/storage";
import {
  captureRequestContext,
  getRequestContext,
} from "../../server/middleware/request-context";

async function runMiddleware(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    captureRequestContext(req, {} as any, () => {
      resolve({ ...getRequestContext() });
    }).catch(reject);
  });
}

async function main() {
  const realUser = await storage.users.getUserByEmail("samknelson@gmail.com");
  const masqUser = await storage.users.getUserByEmail("edls_manager@gmail.com");
  if (!realUser || !masqUser) {
    console.error("FAIL: fixture users missing");
    process.exit(1);
  }

  let failures = 0;
  const check = (label: string, cond: boolean, extra?: any) => {
    if (!cond) failures++;
    console.log(`${cond ? "PASS" : "FAIL"} ${label}`, extra ?? "");
  };

  // 1. Masquerading: effective actor = masqueraded user, original preserved.
  const ctx1 = await runMiddleware({
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    user: { dbUser: realUser },
    session: { masqueradeUserId: masqUser.id },
  });
  check("masquerade: userId is masqueraded user", ctx1.userId === masqUser.id, ctx1.userId);
  check("masquerade: userEmail is masqueraded email", ctx1.userEmail === masqUser.email);
  check("masquerade: originalUserId is real user", ctx1.originalUserId === realUser.id);
  check("masquerade: originalUserEmail is real email", ctx1.originalUserEmail === realUser.email);

  // 2. No masquerade: unchanged behavior, no original fields.
  const ctx2 = await runMiddleware({
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    user: { dbUser: realUser },
    session: {},
  });
  check("plain: userId is real user", ctx2.userId === realUser.id);
  check("plain: no originalUserId", ctx2.originalUserId === undefined);

  // 3. Stale masquerade id: falls back to real user.
  const ctx3 = await runMiddleware({
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    user: { dbUser: realUser },
    session: { masqueradeUserId: "00000000-0000-0000-0000-000000000000" },
  });
  check("stale masquerade: falls back to real user", ctx3.userId === realUser.id && ctx3.originalUserId === undefined);

  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
