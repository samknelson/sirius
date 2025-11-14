import { DashboardPlugin } from "./types";
import { WelcomeMessagesPlugin } from "./welcomeMessages/WelcomeMessagesPlugin";
import { BookmarksPlugin } from "./bookmarks/BookmarksPlugin";
import { EmployerMonthlyUploadsPlugin } from "./employerMonthlyUploads/EmployerMonthlyUploadsPlugin";

export const pluginRegistry: DashboardPlugin[] = [
  {
    id: "welcome-messages",
    name: "Welcome Messages",
    description: "Display role-specific welcome messages for the user",
    order: 1,
    component: WelcomeMessagesPlugin,
    enabledByDefault: true,
  },
  {
    id: "bookmarks",
    name: "Bookmarks",
    description: "Display user's most recent bookmarks",
    order: 2,
    component: BookmarksPlugin,
    requiredPermissions: ["bookmark", "admin"],
    enabledByDefault: true,
  },
  {
    id: "employer-monthly-uploads",
    name: "Employer Monthly Uploads",
    description: "Display employer monthly upload statistics by wizard type",
    order: 3,
    component: EmployerMonthlyUploadsPlugin,
    requiredPermissions: ["admin"],
    enabledByDefault: true,
  },
];

export function getPluginById(id: string): DashboardPlugin | undefined {
  return pluginRegistry.find(plugin => plugin.id === id);
}

export function getAllPlugins(): DashboardPlugin[] {
  return [...pluginRegistry].sort((a, b) => a.order - b.order);
}
