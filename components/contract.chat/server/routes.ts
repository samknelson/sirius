import type { Request, RequestHandler } from "express";
import { storage } from "../../../server/storage";
import { getEffectiveUser } from "../../../server/modules/masquerade";
import { ask, catalog, ChatError, resolveProvider, safeFailure, type ChatActor } from "./service";

async function actor(req: Request): Promise<ChatActor> {
  const { dbUser } = await getEffectiveUser(req.session ?? {}, req.user);
  if (!dbUser || !req.sessionID) throw new ChatError(401, "unauthorized", "Sign in to use Contract Chat.");
  const permissions = await storage.users.getUserPermissions(dbUser.id);
  return {
    userId: dbUser.id, sessionId: req.sessionID,
    role: permissions.some((permission) => permission.key === "staff") ? "staff" : "member",
  };
}

export const contextHandler: RequestHandler = async (req, res) => {
  try {
    const provider = await resolveProvider(await actor(req));
    const contracts = await catalog(provider);
    res.json({ context: provider.context, providerName: provider.name, external: provider.external, contracts });
  } catch (error) {
    const failure = safeFailure(error);
    res.status(failure.status).json({ code: failure.code, message: failure.message });
  }
};

export const askHandler: RequestHandler = async (req, res) => {
  try {
    res.json(await ask(await actor(req), req.body));
  } catch (error) {
    const failure = safeFailure(error);
    res.status(failure.status).json({ code: failure.code, message: failure.message });
  }
};
