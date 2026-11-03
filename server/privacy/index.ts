import type { Express } from "express";
import { storage } from "../storage";
import { createMaskModeMiddleware } from "./middleware";
import { maskModePermissions } from "./permissions";

export function installMaskMode(app: Express): void {
  app.use(createMaskModeMiddleware({
    acquire: (sid, exclusive) => storage.sessions.acquirePresentationLease(sid, exclusive),
    read: sid => storage.sessions.getSessionData(sid),
    transition: (sid, expected, mode) => storage.sessions.transitionMaskMode(sid, expected, mode),
    permissions: maskModePermissions(storage.users),
    people: () => storage.sessions.getTrainingBirthDates(),
  }));
}
