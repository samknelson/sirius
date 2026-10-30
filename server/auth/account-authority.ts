import { AsyncLocalStorage } from "node:async_hooks";
import type { User } from "@shared/schema";

// A request's reads are shared by restoration, Passport and policy helpers.
// Never serialize this cache or reuse it between requests / socket deliveries.
const accounts = new AsyncLocalStorage<Map<string, Promise<User | undefined>>>();
export function withRequestAccounts<T>(fn: () => T): T {
  return accounts.run(new Map(), fn);
}

export async function getCurrentAccount(id: string): Promise<User | undefined> {
  const cache = accounts.getStore();
  let read = cache?.get(id);
  if (!read) {
    read = (async () => {
      const { runOutsideTransaction } = await import("../storage/transaction-context");
      return runOutsideTransaction(async () => {
        const { storage } = await import("../storage");
        return storage.users.getUser(id);
      });
    })();
    cache?.set(id, read);
  }
  return read;
}

/** A legacy session predates revocation and therefore belongs to generation 0. */
export function accountVersion(value: unknown): number {
  return value === undefined ? 0 : Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : -1;
}

export async function sessionProviderType(sessionUser?: any) {
  if (sessionUser?.providerType) return sessionUser.providerType;
  const { providerRegistry } = await import("./index");
  return providerRegistry.getDefault()?.type ?? "replit";
}

export async function currentSessionOwner(sessionUser: any): Promise<User | null> {
  if (!sessionUser) return null;
  let id = sessionUser.dbUser?.id;
  if (!id && sessionUser.claims?.sub) {
    const { storage } = await import("../storage");
    const provider = await sessionProviderType(sessionUser);
    const identity = await storage.authIdentities.getByProviderAndExternalId(provider, sessionUser.claims.sub);
    id = identity?.userId;
  }
  if (!id) return null;
  const user = await getCurrentAccount(id);
  if (!user?.isActive || user.sessionVersion !== accountVersion(sessionUser.dbUser?.sessionVersion)) return null;
  return user;
}

/** Check BOTH owner and effective actor. A valid session alone is not authority. */
export async function currentSessionAccounts(sess: any): Promise<{ owner: User; target: User } | null> {
  const owner = await currentSessionOwner(sess?.passport?.user);
  if (!owner) return null;
  if (!sess.masqueradeUserId) return { owner, target: owner };
  const target = await getCurrentAccount(sess.masqueradeUserId);
  if (!target?.isActive || target.sessionVersion !== accountVersion(sess.masqueradeSessionVersion)) return null;
  return { owner, target };
}
