import type { Express } from "express";
import { storage } from "../storage";
import { createMaskModeMiddleware } from "./middleware";
import { maskModePermissions } from "./permissions";
import { readMaskComponent } from "../storage/system/mask-component";

export function installMaskMode(app: Express): void {
  app.use(createMaskModeMiddleware({
    component: readMaskComponent,
    read: sid => storage.sessions.getSessionData(sid),
    transition: (sid, expected, mode) => storage.sessions.transitionMaskMode(sid, expected, mode),
    permissions: maskModePermissions(storage.users),
  }));
}
