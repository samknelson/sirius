import type { ComponentStartup } from "../../../server/services/component/startup-types";
import { registerBookmarkRoutes } from "./modules/bookmarks";

export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> = app => {
  registerBookmarkRoutes(app);
};
