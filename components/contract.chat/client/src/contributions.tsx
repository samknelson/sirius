import { lazy } from "react";
import { MessageSquare, Settings } from "lucide-react";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";
import { ContractChatLifecycle } from "./lifecycle";


// Navigation loads contributions during initialization. Keep route guards and
// layouts behind a lazy boundary: both import navigation themselves.
export const contributions: ComponentBrowserContributions = {
  lifecycle: [ContractChatLifecycle],
  routes: [{
    path: "/config/contract-chat",
    page: lazy(() => import("./routes")),
  }, {
    path: "/contract-chat",
    page: lazy(() => import("./routes").then((module) => ({ default: module.ContractChatRoute }))),
  }],
  configSections: [{
    id: "contract-chat",
    title: "Contract Chat",
    description: "Contract Chat provider settings",
    icon: MessageSquare,
    items: [],
  }],
  navigation: [{
    section: "contract-chat",
    item: {
      path: "/config/contract-chat",
      label: "Settings",
      icon: Settings,
      testId: "nav-config-contract-chat-settings",
      permission: "admin",
      requiresComponent: "contract.chat",
    },
  }],
};
