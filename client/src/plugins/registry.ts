import { DashboardPlugin } from "./types";
import { WelcomeMessagesPlugin } from "./welcomeMessages/WelcomeMessagesPlugin";
import { WelcomeMessagesSettings } from "./welcomeMessages/WelcomeMessagesSettings";
import { BookmarksPlugin } from "./bookmarks/BookmarksPlugin";
import { EmployerMonthlyUploadsPlugin } from "./employerMonthlyUploads/EmployerMonthlyUploadsPlugin";
import { EmployerMonthlySettings } from "./employerMonthlyUploads/EmployerMonthlySettings";
import { ReportsPlugin } from "./reports/ReportsPlugin";
import { ReportsSettings } from "./reports/ReportsSettings";
import { WmbScanStatusPlugin } from "./wmbScanStatus/WmbScanStatusPlugin";
import { ActiveSessionsPlugin } from "./activeSessions/ActiveSessionsPlugin";
import { MyStewardPlugin } from "./mySteward/MyStewardPlugin";

export const pluginRegistry: DashboardPlugin[] = [
  {
    id: "welcome-messages",
    name: "Welcome Messages",
    description: "Display role-specific welcome messages for the user",
    order: 1,
    component: WelcomeMessagesPlugin,
    enabledByDefault: true,
    settingsComponent: WelcomeMessagesSettings,
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
    id: "reports",
    name: "Reports",
    description: "Display recent report summaries with links to details",
    order: 3,
    component: ReportsPlugin,
    requiredPermissions: ["admin"],
    enabledByDefault: true,
    settingsComponent: ReportsSettings,
  },
  {
    id: "employer-monthly-uploads",
    name: "Employer Monthly Uploads",
    description: "Display employer monthly upload statistics by wizard type",
    order: 4,
    component: EmployerMonthlyUploadsPlugin,
    requiredPermissions: ["admin"],
    enabledByDefault: true,
    settingsComponent: EmployerMonthlySettings,
  },
  {
    id: "wmb-scan-status",
    name: "Benefits Scan Status",
    description: "Display running and upcoming monthly benefits scans with links to details",
    order: 5,
    component: WmbScanStatusPlugin,
    requiredPermissions: ["admin"],
    enabledByDefault: true,
  },
  {
    id: "active-sessions",
    name: "Active Sessions",
    description: "Display count of active users and their sessions",
    order: 6,
    component: ActiveSessionsPlugin,
    requiredPermissions: ["admin"],
    enabledByDefault: true,
  },
  {
    id: "my-steward",
    name: "My Steward",
    description: "Display stewards assigned to your home employer and bargaining unit",
    order: 7,
    component: MyStewardPlugin,
    enabledByDefault: true,
  },
];

export function getPluginById(id: string): DashboardPlugin | undefined {
  return pluginRegistry.find(plugin => plugin.id === id);
}

export function getAllPlugins(): DashboardPlugin[] {
  return [...pluginRegistry].sort((a, b) => a.order - b.order);
}
