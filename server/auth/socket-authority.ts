/**
 * Import-free session/socket boundary. Storage announces committed authority
 * changes; auth can also stop local delivery before handing logout to a provider.
 * The persisted generation handles changes made by another server process.
 */
const listeners = new Map<string, Set<() => void>>();

export function onSessionAuthorityEnded(sid: string, listener: () => void): () => void {
  let callbacks = listeners.get(sid);
  if (!callbacks) listeners.set(sid, callbacks = new Set());
  callbacks.add(listener);
  return () => {
    callbacks.delete(listener);
    // A closing old socket may unsubscribe AFTER a new group was installed
    // for this sid. It must not remove that newer group's revocation hooks.
    if (callbacks.size === 0 && listeners.get(sid) === callbacks) listeners.delete(sid);
  };
}

export function endSessionSocketAuthority(sid: string): void {
  const callbacks = listeners.get(sid);
  listeners.delete(sid);
  callbacks?.forEach(callback => callback());
}

export function sessionSocketIdentity(sess: any): { ownerId: string; userId: string } | null {
  const ownerId = sess?.passport?.user?.dbUser?.id;
  if (typeof ownerId !== "string" || !ownerId) return null;
  const userId = sess.masqueradeUserId ?? ownerId;
  if (typeof userId !== "string" || !userId) return null;
  return { ownerId, userId };
}
