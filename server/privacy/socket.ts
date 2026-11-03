import { readMaskState } from "@shared/privacy/mask-mode";
import type { AdvisoryLockHandle } from "../storage/advisory-lock";

interface DeliveryDependencies {
  acquire(sid: string): Promise<AdvisoryLockHandle | null>;
  read(sid: string): Promise<any>;
}

/** Upgrades bypass Express; every data frame needs the same session lease. */
export async function guardedPresentationDelivery(
  sid: string, effectiveUserId: string, send: () => Promise<void>, deps: DeliveryDependencies,
): Promise<boolean> {
  let lease: AdvisoryLockHandle | null = null;
  try {
    lease = await deps.acquire(sid);
    if (!lease?.isHeld?.()) return false;
    const session = await deps.read(sid);
    const actor = session?.masqueradeUserId ?? session?.passport?.user?.dbUser?.id;
    if (readMaskState(session?.maskMode).mode !== "off" ||
        actor !== effectiveUserId || !lease.isHeld?.()) return false;
    await send();
    return Boolean(lease.isHeld?.());
  } catch {
    return false;
  } finally {
    try { await lease?.release(); } catch { return false; }
  }
}
