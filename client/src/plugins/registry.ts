import { DashboardPlugin } from "./types";
import { WelcomeMessagesPlugin } from "./welcomeMessages/WelcomeMessagesPlugin";

export const pluginRegistry: DashboardPlugin[] = [
  {
    id: "welcome-messages",
    name: "Welcome Messages",
    description: "Display role-specific welcome messages for the user",
    order: 1,
    component: WelcomeMessagesPlugin,
    enabledByDefault: true,
  },
];

export function getPluginById(id: string): DashboardPlugin | undefined {
  return pluginRegistry.find(plugin => plugin.id === id);
}

export function getAllPlugins(): DashboardPlugin[] {
  return [...pluginRegistry].sort((a, b) => a.order - b.order);
}
