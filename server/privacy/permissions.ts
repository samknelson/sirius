import type { Request } from "express";

interface PermissionStore {
  getUser(id: string): Promise<{ id: string; isActive: boolean } | undefined>;
  userHasPermission(id: string, permission: string): Promise<boolean>;
}

/** Admin-only alternative approved by the presenter; no role grants or cache. */
export function maskModePermissions(users: PermissionStore) {
  return async (_req: Request, authoritativeSession: unknown) => {
    const session = authoritativeSession as any;
    const id = session?.passport?.user?.dbUser?.id;
    const presenter = id ? await users.getUser(id) : undefined;
    const canToggle = Boolean(presenter?.isActive &&
      await users.userHasPermission(presenter.id, "admin"));
    const effectiveId = session?.masqueradeUserId ?? id;
    // A missing target is a refusal, not a fallback to a privileged presenter.
    const effective = effectiveId ? await users.getUser(effectiveId) : undefined;
    const canRead = Boolean(presenter?.isActive && effective?.isActive &&
      await users.userHasPermission(effective.id, "staff"));
    return { canToggle, canRead };
  };
}
