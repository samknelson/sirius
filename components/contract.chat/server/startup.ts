import type { ComponentStartup } from "../../../server/services/component-startup-types";
import { requireComponent } from "../../../server/modules/components";
import { registerPrivateHttpScope } from "../../../server/services/http-response-privacy";
import { contextHandler, askHandler } from "./routes";

registerPrivateHttpScope("/api/contract-chat");

export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> = (app, auth, permission) => {
  app.use("/api/contract-chat", auth, requireComponent("contract.chat"), permission("contract.chat"));
  app.get("/api/contract-chat/context", contextHandler);
  app.post("/api/contract-chat/ask", askHandler);
};
