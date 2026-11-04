import { readMaskState } from "@shared/privacy/mask-mode";
import type { AdvisoryLockHandle } from "../storage/advisory-lock";

interface DeliveryDependencies {
  component?(): Promise<{ enabled: boolean; epoch: string | null }>;
  acquire(sid: string): Promise<AdvisoryLockHandle | null>;
  read(sid: string): Promise<any>;
}

/** Upgrades bypass Express; every data frame needs the same session lease. */
export async function guardedPresentationDelivery(
  sid: string, effectiveUserId: string, send: () => Promise<void>, deps: DeliveryDependencies,
): Promise<boolean> {
  let lease: AdvisoryLockHandle | null = null;
  try {
    const component = await deps.component?.();
    if (component?.enabled !== false) {
      lease = await deps.acquire(sid);
      if (!lease?.isHeld?.()) return false;
    }
    const session = await deps.read(sid);
    const actor = session?.masqueradeUserId ?? session?.passport?.user?.dbUser?.id;
    if (session?.maskModeRevoked || actor !== effectiveUserId ||
        (component?.enabled === false
          ? readMaskState(session?.maskMode).mode === "on"
          : readMaskState(session?.maskMode).mode !== "off" || !lease?.isHeld?.())) return false;
    await send();
    return component?.enabled === false || Boolean(lease?.isHeld?.());
  } catch {
    return false;
  } finally {
    try { await lease?.release(); } catch { return false; }
  }
}
