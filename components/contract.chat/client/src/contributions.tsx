import { lazy } from "react";
import { MessageSquare, Settings } from "lucide-react";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";

// Navigation loads contributions during initialization. Keep route guards and
// layouts behind a lazy boundary: both import navigation themselves.
export const contributions: ComponentBrowserContributions = {
  routes: [{
    path: "/config/contract-chat",
    page: lazy(() => import("./routes")),
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
