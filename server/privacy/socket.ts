/** Keep the session/effective-actor fence; display preferences never gate delivery. */
export async function guardedPresentationDelivery(
  sid: string, effectiveUserId: string, send: () => Promise<void>,
  deps: { read(sid: string): Promise<any> },
): Promise<boolean> {
  try {
    const session = await deps.read(sid);
    const owner = session?.passport?.user?.dbUser?.id;
    if (!owner || (session.masqueradeUserId ?? owner) !== effectiveUserId) return false;
    await send();
    return true;
  } catch {
    return false;
  }
}
