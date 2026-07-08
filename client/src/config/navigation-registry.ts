import { 
  Users, MapPin, Phone, Globe, List, UserCog, Puzzle, Package, Heart, 
  CreditCard, Activity, Wallet, Settings, Shield, Key, FileText, 
  Building2, Database, Clock, Zap, Server, MessageSquare, Calendar, GraduationCap, Truck, Network, School, Tag, RefreshCw, Radio, type LucideIcon
} from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  testId: string;
  permission?: string;
  policy?: string;
  requiresComponent?: string;
  requiresComponents?: string[];
}

export interface NavSection {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  items: NavItem[];
  subsections?: NavSection[];
}

export const configSections: NavSection[] = [
  {
    id: "policies",
    title: "Policies",
    description: "Policy configuration and defaults",
    icon: FileText,
    items: [
      { path: "/config/policies", label: "Policies", icon: FileText, testId: "nav-config-policies", permission: "admin" },
      { path: "/config/default-policy", label: "Default Policy", icon: Settings, testId: "nav-config-default-policy", permission: "admin" },
      { path: "/contracts", label: "Contracts", icon: FileText, testId: "nav-config-contracts", permission: "staff", requiresComponent: "contract" },
    ],
  },
  {
    id: "system",
    title: "System",
    description: "Core system configuration and monitoring",
    icon: Settings,
    items: [
      { path: "/config/system-mode", label: "System Mode", icon: Server, testId: "nav-config-system-mode", permission: "admin" },
      { path: "/config/twilio", label: "SMS Providers", icon: MessageSquare, testId: "nav-config-sms", permission: "admin" },
      { path: "/config/email", label: "Email Providers", icon: MessageSquare, testId: "nav-config-email", permission: "admin" },
      { path: "/config/postal", label: "Postal Providers", icon: MessageSquare, testId: "nav-config-postal", permission: "admin" },
      { path: "/config/components", label: "Components", icon: Package, testId: "nav-config-components", permission: "admin" },
      { path: "/admin/plugin-configs", label: "Plugins", icon: Puzzle, testId: "nav-config-plugins", permission: "admin" },
      { path: "/admin/denorm", label: "Denorm", icon: RefreshCw, testId: "nav-config-denorm", permission: "admin" },
      { path: "/config/logs", label: "System Logs", icon: FileText, testId: "nav-config-logs", permission: "admin" },
      { path: "/admin/quickstarts", label: "Quickstarts", icon: Database, testId: "nav-config-quickstarts", permission: "admin" },
      { path: "/admin/cron-jobs", label: "Cron Jobs", icon: Clock, testId: "nav-config-cron-jobs", permission: "admin" },
      { path: "/config/sftp/clients", label: "SFTP Clients", icon: Server, testId: "nav-config-sftp-clients", permission: "admin", requiresComponent: "system.sftp.client" },
      { path: "/admin/debug/event-bus", label: "Event Bus", icon: Radio, testId: "nav-admin-debug-event-bus", permission: "admin", requiresComponent: "debug" },
    ],
  },
  {
    id: "theme",
    title: "Theme & Appearance",
    description: "Site branding, terminology, and dashboard customization",
    icon: Globe,
    items: [
      { path: "/config/site", label: "Site Information", icon: Globe, testId: "nav-config-site", permission: "admin" },
      { path: "/config/terminology", label: "Terminology", icon: Globe, testId: "nav-config-terminology", permission: "admin" },
      { path: "/admin/plugin-configs/dashboard", label: "Dashboard Plugins", icon: Puzzle, testId: "nav-config-dashboard-plugins", permission: "admin" },
    ],
  },
  {
    id: "trust",
    title: "Trust",
    description: "Trust benefits and provider configuration",
    icon: Heart,
    items: [
      { path: "/trust-benefits", label: "Trust Benefits", icon: Heart, testId: "nav-trust-benefits", permission: "staff" },
      { path: "/admin/plugin-configs/trust-eligibility", label: "Eligibility Plugins", icon: Zap, testId: "nav-config-trust-eligibility-plugins", permission: "admin" },
      { path: "/config/options/trust-benefit-type", label: "Trust Benefit Types", icon: List, testId: "nav-config-trust-benefit-types", permission: "admin" },
      { path: "/config/options/trust-provider-type", label: "Provider Contact Types", icon: List, testId: "nav-config-provider-contact-types", permission: "admin" },
      { path: "/config/trust/providers/user-settings", label: "Provider User Settings", icon: Settings, testId: "nav-config-users-trust-provider-settings", permission: "admin" },
      { path: "/config/trust/sitespecific/bao/thresholds", label: "Member Status Thresholds", icon: Clock, testId: "nav-config-bao-thresholds", permission: "admin", requiresComponent: "sitespecific.bao" },
    ],
  },
  {
    id: "employers",
    title: "Employers",
    description: "Employer-related configuration",
    icon: Building2,
    items: [
      { path: "/config/options/employer-type", label: "Employer Types", icon: List, testId: "nav-config-employer-types", permission: "admin" },
      { path: "/config/options/department", label: "Departments", icon: List, testId: "nav-config-departments", permission: "admin" },
      { path: "/config/options/employer-contact-type", label: "Employer Contact Types", icon: List, testId: "nav-config-employer-contact-types", permission: "admin" },
      { path: "/config/employers/user-settings", label: "Employer User Settings", icon: Settings, testId: "nav-config-users-employer-settings", permission: "admin" },
    ],
  },
  {
    id: "contact",
    title: "Contact Information",
    description: "Address and phone number settings",
    icon: Phone,
    items: [
      { path: "/config/addresses", label: "Postal Addresses", icon: MapPin, testId: "nav-config-addresses", permission: "admin" },
      { path: "/config/options/gender", label: "Gender Options", icon: List, testId: "nav-config-gender-options", permission: "admin" },
    ],
  },
  {
    id: "dropdown-lists",
    title: "Dropdown Lists",
    description: "Configurable dropdown options",
    icon: List,
    items: [
      { path: "/config/options/worker-id-type", label: "Worker ID Types", icon: List, testId: "nav-config-worker-id-types", permission: "admin" },
      { path: "/config/options/worker-ws", label: "Worker Work Statuses", icon: List, testId: "nav-config-worker-work-statuses", permission: "admin" },
      { path: "/config/options/worker-ms", label: "Worker Member Statuses", icon: List, testId: "nav-config-worker-member-statuses", permission: "admin" },
      { path: "/config/options/skill", label: "Skill Options", icon: List, testId: "nav-config-skill-options", permission: "admin", requiresComponent: "worker.skills" },
      { path: "/config/options/certification", label: "Certifications", icon: FileText, testId: "nav-config-certification-options", permission: "admin", requiresComponent: "worker.certifications" },
      { path: "/config/options/classification", label: "Classifications", icon: List, testId: "nav-config-classification-options", permission: "admin" },
      { path: "/config/options/industry", label: "Industries", icon: List, testId: "nav-config-industry-options", permission: "admin" },
      { path: "/config/options/worker-rating", label: "Rating Types", icon: List, testId: "nav-config-rating-options", permission: "admin", requiresComponent: "worker.ratings" },
      { path: "/config/options/worker-relation-type", label: "Relationship Types", icon: List, testId: "nav-config-worker-relation-types", permission: "admin", requiresComponent: "worker.relations" },
      { path: "/config/options/employment-status", label: "Employment Statuses", icon: List, testId: "nav-config-employment-statuses", permission: "admin" },
      { path: "/config/options/comm-tag", label: "Comm Tags", icon: Tag, testId: "nav-config-comm-tags", permission: "admin" },
      { path: "/config/steward-settings", label: "Steward", icon: Users, testId: "nav-config-steward-settings", permission: "admin", requiresComponent: "worker.steward" },
      { path: "/config/workers/ban", label: "Ban Notifications", icon: Shield, testId: "nav-config-workers-ban", permission: "admin", requiresComponent: "worker.ban" },
      { path: "/config/workers/tos", label: "Time Off Sick", icon: Calendar, testId: "nav-config-workers-tos", permission: "admin", requiresComponent: "worker.tos" },
      { path: "/config/workers/user-settings", label: "Worker User Settings", icon: Settings, testId: "nav-config-users-worker-settings", permission: "admin" },
    ],
  },
  {
    id: "events",
    title: "Events",
    description: "Event management and configuration",
    icon: Calendar,
    items: [
      { path: "/config/event-types", label: "Event Types", icon: List, testId: "nav-config-event-types", permission: "admin", requiresComponent: "event" },
    ],
  },
  {
    id: "dispatch",
    title: "Dispatch",
    description: "Dispatch management and configuration",
    icon: Truck,
    items: [
      { path: "/config/dispatch-job-types", label: "Job Types", icon: List, testId: "nav-config-dispatch-job-types", permission: "admin", requiresComponent: "dispatch" },
      { path: "/admin/plugin-configs/dispatch-eligibility", label: "Eligibility Plugins", icon: Zap, testId: "nav-config-dispatch-eligibility-plugins", permission: "admin" },
      { path: "/config/dispatch/backfill", label: "Eligibility Backfill", icon: RefreshCw, testId: "nav-config-dispatch-backfill", permission: "admin", requiresComponent: "dispatch" },
      { path: "/config/dispatch/dnc", label: "Do Not Call", icon: Phone, testId: "nav-config-dispatch-dnc", permission: "admin", requiresComponent: "dispatch.dnc" },
      { path: "/config/dispatch/eba", label: "EBA", icon: Calendar, testId: "nav-config-dispatch-eba", permission: "admin", requiresComponent: "dispatch.eba" },
      { path: "/config/dispatch/seniority-reset", label: "Seniority Reset", icon: RefreshCw, testId: "nav-config-dispatch-seniority-reset", permission: "admin", requiresComponent: "dispatch" },
      { path: "/config/sitespecific/hta/home-employment-statuses", label: "Home Employment Statuses", icon: Building2, testId: "nav-config-hta-home-employment-statuses", permission: "staff", requiresComponent: "sitespecific.hta" },
    ],
  },
  {
    id: "btu",
    title: "BTU",
    description: "Boston Teachers Union configuration",
    icon: GraduationCap,
    items: [
      { path: "/sitespecific/btu/csgs", label: "CSG Management", icon: Users, testId: "nav-btu-csgs", permission: "admin", requiresComponent: "sitespecific.btu" },
      { path: "/sitespecific/btu/employer-map", label: "Employer Map", icon: Building2, testId: "nav-btu-employer-map", permission: "admin", requiresComponent: "sitespecific.btu" },
      { path: "/sitespecific/btu/territories", label: "Territories", icon: MapPin, testId: "nav-btu-territories", permission: "admin", requiresComponent: "sitespecific.btu" },
      { path: "/sitespecific/btu/school-types", label: "School Types", icon: School, testId: "nav-btu-school-types", permission: "admin", requiresComponent: "sitespecific.btu" },
      { path: "/sitespecific/btu/regions", label: "Regions", icon: MapPin, testId: "nav-btu-regions", permission: "admin", requiresComponent: "sitespecific.btu" },
    ],
  },
  {
    id: "grievance",
    title: "Grievance",
    description: "Grievance tracking configuration",
    icon: FileText,
    items: [
      { path: "/config/options/grievance-status", label: "Status Options", icon: List, testId: "nav-config-grievance-status-options", permission: "admin", requiresComponent: "grievance" },
      { path: "/config/options/grievance-category", label: "Category Options", icon: List, testId: "nav-config-grievance-category-options", permission: "admin", requiresComponent: "grievance" },
      { path: "/config/options/grievance-step", label: "Step Options", icon: List, testId: "nav-config-grievance-step-options", permission: "admin", requiresComponent: "grievance" },
      { path: "/config/options/grievance-complaint", label: "Complaint Options", icon: List, testId: "nav-config-grievance-complaint-options", permission: "admin", requiresComponent: "grievance" },
      { path: "/config/options/grievance-remedy", label: "Remedy Options", icon: List, testId: "nav-config-grievance-remedy-options", permission: "admin", requiresComponent: "grievance" },
      { path: "/config/options/grievance-role", label: "Role Options", icon: List, testId: "nav-config-grievance-role-options", permission: "admin", requiresComponent: "grievance" },
      { path: "/config/options/grievance-settlement-type", label: "Settlement Types", icon: List, testId: "nav-config-grievance-settlement-type-options", permission: "admin", requiresComponent: "grievance.settlement" },
      { path: "/grievance-timeline-templates", label: "Timeline Templates", icon: List, testId: "nav-config-grievance-timeline-templates", permission: "admin", requiresComponent: "grievance" },
    ],
  },
  {
    id: "ledger",
    title: "Ledger",
    description: "Financial ledger and payment configuration",
    icon: Wallet,
    items: [
      { path: "/config/ledger/payment-types", label: "Payment Types", icon: Wallet, testId: "nav-ledger-payment-types", policy: "staff" },
      { path: "/admin/plugin-configs/charge", label: "Charge Plugins", icon: Zap, testId: "nav-ledger-charge-plugins", permission: "admin" },
      { path: "/config/ledger/payment-gateways/test", label: "Gateway Test", icon: Activity, testId: "nav-ledger-gateway-test", permission: "admin" },
      { path: "/config/ledger/payment-gateways/payment-types", label: "Gateway Payment Types", icon: CreditCard, testId: "nav-ledger-gateway-payment-types", permission: "admin" },
      { path: "/config/ledger/settings", label: "Settings", icon: Settings, testId: "nav-ledger-settings", permission: "admin" },
    ],
  },
  {
    id: "edls",
    title: "EDLS",
    description: "Employer Day Labor Scheduler configuration",
    icon: Calendar,
    items: [
      { path: "/config/edls/settings", label: "Settings", icon: Settings, testId: "nav-config-edls-settings", permission: "admin", requiresComponent: "edls" },
      { path: "/config/edls/tasks", label: "Tasks", icon: List, testId: "nav-config-edls-tasks", permission: "admin", requiresComponent: "edls" },
      { path: "/config/edls/t631-fetch", label: "Teamsters 631 Fetch", icon: Zap, testId: "nav-config-edls-t631-fetch", permission: "admin", requiresComponents: ["edls", "sitespecific.t631.client"] },
    ],
  },
  {
    id: "webservices",
    title: "Web Services",
    description: "External API access and client management",
    icon: Network,
    items: [
      { path: "/config/ws/bundles", label: "Bundles", icon: Package, testId: "nav-config-ws-bundles", permission: "admin" },
      { path: "/config/ws/clients", label: "Clients", icon: Key, testId: "nav-config-ws-clients", permission: "admin" },
    ],
  },
];

export interface AccessContext {
  hasPermission: (permission: string) => boolean;
  policyResults: Record<string, { allowed: boolean }>;
  isComponentEnabled: (componentId: string) => boolean;
}

export function hasAccessToItem(item: NavItem, context: AccessContext): boolean {
  const hasComponentCheck = !item.requiresComponent || context.isComponentEnabled(item.requiresComponent);
  const hasComponentsCheck = !item.requiresComponents || item.requiresComponents.every(c => context.isComponentEnabled(c));
  if (!hasComponentCheck || !hasComponentsCheck) return false;

  if (item.policy) {
    return context.policyResults[item.policy]?.allowed ?? false;
  }
  if (item.permission) {
    return context.hasPermission(item.permission);
  }
  return false;
}

export function getAccessibleItems(items: NavItem[], context: AccessContext): NavItem[] {
  return items.filter(item => hasAccessToItem(item, context));
}

export function getAccessibleSections(context: AccessContext): NavSection[] {
  return configSections
    .map(section => {
      const accessibleItems = getAccessibleItems(section.items, context);
      const accessibleSubsections = section.subsections
        ?.map(sub => ({
          ...sub,
          items: getAccessibleItems(sub.items, context),
        }))
        .filter(sub => sub.items.length > 0);

      return {
        ...section,
        items: accessibleItems,
        subsections: accessibleSubsections,
      };
    })
    .filter(section => section.items.length > 0 || (section.subsections && section.subsections.length > 0));
}

export function getAllNavItems(): NavItem[] {
  const items: NavItem[] = [];
  for (const section of configSections) {
    items.push(...section.items);
    if (section.subsections) {
      for (const sub of section.subsections) {
        items.push(...sub.items);
      }
    }
  }
  return items;
}

export function getAllPoliciesNeeded(): string[] {
  const allItems = getAllNavItems();
  const policies = allItems
    .filter((item): item is NavItem & { policy: string } => !!item.policy)
    .map(item => item.policy);
  return Array.from(new Set(policies));
}

/** True when `path` equals `itemPath` or is nested beneath it. */
function pathMatchesItem(path: string, itemPath: string): boolean {
  return path === itemPath || path.startsWith(itemPath + "/");
}

/**
 * Resolve the single nav item that should be highlighted for `path`, by
 * choosing the matching item with the longest path. This makes the most
 * specific item win: e.g. on `/admin/plugin-configs/charge` the
 * "Charge Plugins" item (path `/admin/plugin-configs/charge`) is chosen over
 * the generic "Plugins" item (path `/admin/plugin-configs`), instead of both
 * matching via prefix. Falls back to the generic parent item when no more
 * specific item exists. Returns `null` when nothing matches.
 */
export function findActiveItemPath(path: string): string | null {
  let best: string | null = null;
  const consider = (itemPath: string) => {
    if (pathMatchesItem(path, itemPath)) {
      if (best === null || itemPath.length > best.length) best = itemPath;
    }
  };
  for (const section of configSections) {
    section.items.forEach(item => consider(item.path));
    section.subsections?.forEach(sub => sub.items.forEach(item => consider(item.path)));
  }
  return best;
}

/**
 * True when the section (or one of its subsections) owns the currently active
 * item. Driven by `activeItemPath` (from `findActiveItemPath`) so a section
 * only opens/highlights when it holds the most specific match — not merely a
 * prefix of the location.
 */
export function isPathInSection(activeItemPath: string | null, section: NavSection): boolean {
  if (!activeItemPath) return false;

  const inItems = section.items.some(item => item.path === activeItemPath);
  if (inItems) return true;

  if (section.subsections) {
    return section.subsections.some(sub =>
      sub.items.some(item => item.path === activeItemPath)
    );
  }

  return false;
}
