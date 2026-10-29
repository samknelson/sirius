import { AsyncLocalStorage } from "node:async_hooks";

/** Internal observation scope, never serialized into the session/cookie. */
interface SessionAuthenticationContext {
  reason: "sign-in" | "restore";
  userId?: string;
  historyManaged?: boolean;
}

const context = new AsyncLocalStorage<SessionAuthenticationContext>();
export const getSessionAuthenticationContext = () => context.getStore();
export function runWithSessionAuthentication<T>(value: SessionAuthenticationContext, fn: () => T): T {
  return context.run(value, fn);
}
export function runAsSessionRestoration<T>(fn: () => T): T {
  return context.run({ reason: "restore" }, fn);
}
