import { 
  Users, MapPin, Phone, Globe, List, UserCog, Puzzle, Package, Heart, 
  CreditCard, Activity, Wallet, Settings, Shield, Key, KeyRound, FileText, 
  Building2, Clock, Zap, Server, MessageSquare, Calendar, GraduationCap, Truck, Network, School, Tag, RefreshCw, Radio, HelpCircle, FolderOpen, NotebookPen, Terminal, Power, Cloud, Database, CalendarClock, type LucideIcon
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
  /**
   * Set when this item leads to an options list: the label is then the options
   * registry's name for that list, filled in by `resolveConfigSections`, and
   * the `label` written here is ignored.
   */
  optionsType?: string;
}

/**
 * Where a section's items come from, when they are not written down here.
 * `options-catalog` = one item per unified-options list, named by the options
 * registry (the server's `/api/options/catalog`), which is the single source
 * of truth for what those lists are called.
 */
export type NavItemSource = "options-catalog";

export interface NavSection {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /**
   * The section's items. Empty in the registry when `itemsFrom` is set — call
   * `resolveConfigSections` to fill them in before rendering.
   */
  items: NavItem[];
  /** Set when the items are resolved at render time instead of listed here. */
  itemsFrom?: NavItemSource;
  /**
   * How a dynamic section's items arrived, stamped by `resolveConfigSections`.
   * Renderers must say "loading" / "couldn't load" rather than draw an empty
   * group, which would claim the lists don't exist.
   */
  itemsStatus?: "loading" | "error" | "ready";
  subsections?: NavSection[];
}

/**
 * Every config section, in the order they are shown. Both config surfaces (the
 * sidebar and the Config landing page) render this list in order, so the order
 * here IS the display order — a new section goes where a reader expects it, not
 * on the end.
 */
export const configSections: NavSection[] = [
  {
    id: "system",
    title: "System",
    description: "Core system configuration and monitoring",
    icon: Settings,
    items: [
      { path: "/config/system-mode", label: "System Mode", icon: Server, testId: "nav-config-system-mode", permission: "admin" },
      { path: "/config/auth-settings", label: "Auth Settings", icon: KeyRound, testId: "nav-config-auth-settings", permission: "admin" },
      { path: "/config/system-status", label: "System Status", icon: Activity, testId: "nav-config-system-status", permission: "admin" },
      { path: "/config/env", label: "Environment", icon: Terminal, testId: "nav-config-env", permission: "admin" },
      { path: "/config/timezone", label: "Time Zone", icon: Clock, testId: "nav-config-timezone", permission: "admin" },
      { path: "/config/components", label: "Components", icon: Package, testId: "nav-config-components", permission: "admin" },
      { path: "/admin/plugin-configs", label: "Plugins", icon: Puzzle, testId: "nav-config-plugins", permission: "admin" },
      { path: "/admin/denorm", label: "Denorm", icon: RefreshCw, testId: "nav-config-denorm", permission: "admin" },
      { path: "/config/logs", label: "System Logs", icon: FileText, testId: "nav-config-logs", permission: "admin" },
      { path: "/admin/file-browser", label: "File Browser", icon: FolderOpen, testId: "nav-config-file-browser", permission: "admin" },
      { path: "/config/entity-files", label: "Entity Files", icon: FolderOpen, testId: "nav-config-entity-files", permission: "admin" },
      { path: "/config/entity-notes", label: "Entity Notes", icon: NotebookPen, testId: "nav-config-entity-notes", permission: "admin" },
      { path: "/admin/cron-jobs", label: "Cron Jobs", icon: Clock, testId: "nav-config-cron-jobs", permission: "admin" },
      { path: "/config/sftp/clients", label: "SFTP Clients", icon: Server, testId: "nav-config-sftp-clients", permission: "admin", requiresComponent: "system.sftp.client" },
      { path: "/config/business-calendars", label: "Business Calendars", icon: Calendar, testId: "nav-config-business-calendars", permission: "admin" },
      { path: "/config/helps", label: "Help Text", icon: HelpCircle, testId: "nav-config-helps", permission: "admin" },
      { path: "/admin/debug/event-bus", label: "Event Bus", icon: Radio, testId: "nav-admin-debug-event-bus", permission: "admin", requiresComponent: "debug" },
      { path: "/admin/ebs", label: "Event Scheduler", icon: Calendar, testId: "nav-config-ebs", permission: "admin" },
      { path: "/admin/restart", label: "Restart & Reload", icon: Power, testId: "nav-config-restart", permission: "admin" },
      { path: "/config/s1-migration", label: "S1 Migration", icon: Database, testId: "nav-config-s1-migration", permission: "admin", requiresComponent: "sitespecific.bao.s1migration" },
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
    // The id stays "contact" although the group is now called "Comm": it is
    // never shown, and it is what the sidebar's per-section test-id map and
    // every data-testid built from it are keyed on.
    id: "contact",
    title: "Comm",
    description: "Message providers, addresses, and contact settings",
    icon: Phone,
    items: [
      { path: "/config/twilio", label: "SMS Providers", icon: MessageSquare, testId: "nav-config-sms", permission: "admin" },
      { path: "/config/email", label: "Email Providers", icon: MessageSquare, testId: "nav-config-email", permission: "admin" },
      { path: "/config/postal", label: "Postal Providers", icon: MessageSquare, testId: "nav-config-postal", permission: "admin" },
      { path: "/config/addresses", label: "Postal Addresses", icon: MapPin, testId: "nav-config-addresses", permission: "admin" },
    ],
  },
  {
    // Every list served by unified options lives here, whatever domain it
    // belongs to — the group IS "/config/options". The items are not listed:
    // they come from the options registry via `resolveConfigSections`, so a
    // list added to the registry appears here, correctly named, with no edit
    // to this file. Each resolved item keeps the component gate the registry
    // declares for its type, which is what lets a disabled component's lists
    // share this group and stay hidden.
    id: "dropdown-lists",
    title: "Dropdown Lists",
    description: "Configurable dropdown options",
    icon: List,
    items: [],
    itemsFrom: "options-catalog",
  },
  {
    id: "ledger",
    title: "Ledger",
    description: "Financial ledger and payment configuration",
    icon: Wallet,
    items: [
      bespokeOptionsNavItem({ path: "/config/ledger/payment-types", optionsType: "ledger-payment-type", icon: Wallet, testId: "nav-ledger-payment-types", policy: "staff", requiresComponent: "ledger" }),
      { path: "/admin/plugin-configs/charge", label: "Charge Plugins", icon: Zap, testId: "nav-ledger-charge-plugins", permission: "admin" },
      { path: "/config/ledger/payment-gateways/test", label: "Gateway Test", icon: Activity, testId: "nav-ledger-gateway-test", permission: "admin" },
      { path: "/config/ledger/payment-gateways/payment-types", label: "Gateway Payment Types", icon: CreditCard, testId: "nav-ledger-gateway-payment-types", permission: "admin" },
      { path: "/config/ledger/settings", label: "Settings", icon: Settings, testId: "nav-ledger-settings", permission: "admin" },
    ],
  },
  {
    id: "workers",
    title: "Workers",
    description: "Worker settings and notifications",
    icon: Users,
    items: [
      { path: "/config/steward-settings", label: "Steward", icon: Users, testId: "nav-config-steward-settings", permission: "admin", requiresComponent: "worker.steward" },
      { path: "/config/workers/ban", label: "Ban Notifications", icon: Shield, testId: "nav-config-workers-ban", permission: "admin", requiresComponent: "worker.ban" },
      { path: "/config/workers/tos", label: "Time Off Sick", icon: Calendar, testId: "nav-config-workers-tos", permission: "admin", requiresComponent: "worker.tos" },
      { path: "/config/workers/user-settings", label: "Worker User Settings", icon: Settings, testId: "nav-config-users-worker-settings", permission: "admin" },
      { path: "/config/workers/list-settings", label: "Worker List", icon: Settings, testId: "nav-config-worker-list-settings", permission: "admin", requiresComponent: "cardcheck" },
    ],
  },
  {
    id: "employers",
    title: "Employers",
    description: "Employer-related configuration",
    icon: Building2,
    items: [
      { path: "/config/employers/user-settings", label: "Employer User Settings", icon: Settings, testId: "nav-config-users-employer-settings", permission: "admin" },
      { path: "/config/sitespecific/bao/employer-rates", label: "BAO Employer Rates", icon: List, testId: "nav-config-bao-employer-rates", permission: "admin", requiresComponent: "sitespecific.bao" },
      { path: "/config/sitespecific/bao/rate-sources", label: "BAO Rate Sources", icon: List, testId: "nav-config-bao-rate-sources", permission: "admin", requiresComponent: "sitespecific.bao" },
      { path: "/config/sitespecific/bao/distance-cache", label: "BAO Distance Cache", icon: List, testId: "nav-config-bao-distance-cache", permission: "admin", requiresComponent: "sitespecific.bao" },
      { path: "/config/sitespecific/bao/cobra-rates", label: "BAO COBRA Rates", icon: List, testId: "nav-config-bao-cobra-rates", permission: "admin", requiresComponent: "sitespecific.bao" },
      { path: "/config/sitespecific/bao/dp-rates", label: "BAO DP Rates", icon: List, testId: "nav-config-bao-dp-rates", permission: "admin", requiresComponent: "sitespecific.bao" },
      { path: "/config/sitespecific/bao/premium-rates", label: "BAO Premium Rates", icon: List, testId: "nav-config-bao-premium-rates", permission: "admin", requiresComponent: "sitespecific.bao" },
      { path: "/config/sitespecific/bao/premium-files", label: "BAO Premium Files", icon: List, testId: "nav-config-bao-premium-files", permission: "staff", requiresComponent: "sitespecific.bao" },
      { path: "/config/sitespecific/bao/cobra-triggers", label: "BAO COBRA Triggers", icon: List, testId: "nav-config-bao-cobra-triggers", permission: "admin", requiresComponent: "sitespecific.bao" },
    ],
  },
  {
    id: "dispatch",
    title: "Dispatch",
    description: "Dispatch management and configuration",
    icon: Truck,
    items: [
      bespokeOptionsNavItem({ path: "/config/dispatch-job-types", optionsType: "dispatch-job-type", icon: List, testId: "nav-config-dispatch-job-types", permission: "admin", requiresComponent: "dispatch" }),
      { path: "/admin/plugin-configs/dispatch-eligibility", label: "Eligibility Plugins", icon: Zap, testId: "nav-config-dispatch-eligibility-plugins", permission: "admin" },
      { path: "/config/dispatch/backfill", label: "Eligibility Backfill", icon: RefreshCw, testId: "nav-config-dispatch-backfill", permission: "admin", requiresComponent: "dispatch" },
      { path: "/config/dispatch/dnc", label: "Do Not Call", icon: Phone, testId: "nav-config-dispatch-dnc", permission: "admin", requiresComponent: "dispatch.dnc" },
      { path: "/config/dispatch/eba", label: "EBA", icon: Calendar, testId: "nav-config-dispatch-eba", permission: "admin", requiresComponent: "dispatch.eba" },
      { path: "/config/dispatch/seniority-reset", label: "Seniority Reset", icon: RefreshCw, testId: "nav-config-dispatch-seniority-reset", permission: "admin", requiresComponent: "dispatch" },
      { path: "/config/sitespecific/hta/home-employment-statuses", label: "Home Employment Statuses", icon: Building2, testId: "nav-config-hta-home-employment-statuses", permission: "staff", requiresComponent: "sitespecific.hta" },
    ],
  },
  {
    id: "events",
    title: "Events",
    description: "Event management and configuration",
    icon: Calendar,
    items: [
      bespokeOptionsNavItem({ path: "/config/event-types", optionsType: "event-type", icon: List, testId: "nav-config-event-types", permission: "admin", requiresComponent: "event" }),
    ],
  },
  {
    id: "grievance",
    title: "Grievance",
    description: "Grievance tracking configuration",
    icon: FileText,
    items: [
      { path: "/grievance-timeline-templates", label: "Timeline Templates", icon: List, testId: "nav-config-grievance-timeline-templates", permission: "admin", requiresComponent: "grievance" },
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
      { path: "/config/trust/providers/user-settings", label: "Provider User Settings", icon: Settings, testId: "nav-config-users-trust-provider-settings", permission: "admin" },
      { path: "/config/trust/sitespecific/bao/thresholds", label: "Member Status Thresholds", icon: Clock, testId: "nav-config-bao-thresholds", permission: "admin", requiresComponent: "sitespecific.bao" },
      { path: "/config/trust/open-enrollment-windows", label: "Open Enrollment Windows", icon: CalendarClock, testId: "nav-config-open-enrollment-windows", permission: "admin", requiresComponent: "trust.elections" },
    ],
  },
  {
    id: "edls",
    title: "EDLS",
    description: "Employer Day Labor Scheduler configuration",
    icon: Calendar,
    items: [
      { path: "/config/edls/settings", label: "Settings", icon: Settings, testId: "nav-config-edls-settings", permission: "admin", requiresComponent: "edls" },
      bespokeOptionsNavItem({ path: "/config/edls/tasks", optionsType: "edls-task", icon: List, testId: "nav-config-edls-tasks", permission: "admin", requiresComponent: "edls" }),
      { path: "/config/edls/t631-fetch", label: "Teamsters 631 Fetch", icon: Zap, testId: "nav-config-edls-t631-fetch", permission: "admin", requiresComponents: ["edls", "sitespecific.t631.client"] },
      { path: "/config/edls/t631-ms", label: "Teamsters 631 MS", icon: List, testId: "nav-config-edls-t631-ms", permission: "admin", requiresComponents: ["edls", "sitespecific.t631.client"] },
      { path: "/admin/sitespecific/freeman/edls/migrate", label: "Freeman Migration", icon: Server, testId: "nav-config-edls-freeman-migrate", permission: "admin", requiresComponents: ["edls", "sitespecific.freeman.edls_migrate"] },
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
    // Both directions of third-party traffic, named by direction. Each item is
    // one tabbed page, so the sidebar stops at the page and the tabs take it
    // from there rather than the sidebar listing every view of both.
    id: "webservices",
    title: "Web Services",
    description: "Calls other people make to us, and calls we make to them",
    icon: Network,
    items: [
      { path: "/admin/ws", label: "Incoming", icon: Network, testId: "nav-config-ws", permission: "admin" },
      { path: "/admin/wc", label: "Outgoing", icon: Cloud, testId: "nav-config-wc", permission: "admin" },
    ],
  },
];

/** One options list, as the server's `/api/options/catalog` describes it. */
export interface OptionsCatalogEntry {
  type: string;
  name: string;
  /** The same name for a screen listing the records, e.g. "Event Types". */
  pluralName: string;
  description?: string;
  requiredComponent?: string;
  /** Set when the list is administered on its own page, at this path. */
  bespokePath?: string;
}

/**
 * The options lists that belong in the generic options navigation: everything
 * the registry knows about except the types administered on their own page
 * (those already have a home elsewhere in Config, and the catalog says so).
 */
export function listedOptionsCatalogEntries(catalog: OptionsCatalogEntry[]): OptionsCatalogEntry[] {
  return catalog.filter(entry => !entry.bespokePath);
}

/** The path of an options list's generic page. */
export function optionsListPath(type: string): string {
  return `/config/options/${type}/list`;
}

/**
 * Turn a catalog entry into a nav item. The label is the registry's name — the
 * same name the page heading uses — and the component gate is the registry's,
 * so nothing about this list is spelled out twice.
 */
export function optionsCatalogNavItem(entry: OptionsCatalogEntry): NavItem {
  return {
    path: optionsListPath(entry.type),
    label: entry.name,
    icon: List,
    testId: `nav-config-options-${entry.type}`,
    permission: "admin",
    requiresComponent: entry.requiredComponent,
  };
}

/**
 * An item leading to an options list that is administered on its own page. It
 * carries the page's own access gate — which can be stricter than the list's —
 * and takes its label from the options registry like every other list.
 */
export function bespokeOptionsNavItem(
  item: Omit<NavItem, "label" | "optionsType"> & { optionsType: string },
): NavItem {
  return { ...item, label: "" };
}

/**
 * Fill in what the options catalog owns: the items of every section whose
 * `itemsFrom` names it, and the label of any item that names an options type.
 * A section holding either kind is stamped with how its items arrived, so a
 * renderer can say "loading" / "couldn't load" instead of quietly dropping
 * lists that do exist.
 */
export function resolveConfigSections(
  catalog: { entries: OptionsCatalogEntry[]; status: "loading" | "error" | "ready" },
  sections: NavSection[] = configSections,
): NavSection[] {
  const byType = new Map(catalog.entries.map(entry => [entry.type, entry]));

  const resolveSection = (section: NavSection): NavSection => {
    const namedItems = section.items.filter(item => item.optionsType);
    const isDynamic = section.itemsFrom !== undefined || namedItems.length > 0;

    let items: NavItem[];
    let resolved: boolean;

    if (section.itemsFrom === "options-catalog") {
      items = listedOptionsCatalogEntries(catalog.entries).map(optionsCatalogNavItem);
      resolved = catalog.status === "ready";
    } else {
      items = section.items.flatMap(item => {
        if (!item.optionsType) return [item];
        const entry = byType.get(item.optionsType);
        // An unnamed item is left out rather than shown under a guessed name;
        // the section says why below.
        return entry ? [{ ...item, label: entry.pluralName }] : [];
      });
      resolved = namedItems.every(item => byType.has(item.optionsType!));
    }

    return {
      ...section,
      items,
      itemsStatus: isDynamic
        ? resolved
          ? "ready"
          : catalog.status === "error"
            ? "error"
            : "loading"
        : section.itemsStatus,
      subsections: section.subsections?.map(resolveSection),
    };
  };

  return sections.map(resolveSection);
}

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

export function getAccessibleSections(
  context: AccessContext,
  sections: NavSection[] = configSections,
): NavSection[] {
  return sections
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
    .filter(section =>
      section.items.length > 0
      || (section.subsections && section.subsections.length > 0)
      // A dynamic section that has not resolved yet is kept so the renderer can
      // say so. Dropping it would claim its lists don't exist.
      || (section.itemsStatus !== undefined && section.itemsStatus !== "ready")
    );
}

export function getAllNavItems(sections: NavSection[] = configSections): NavItem[] {
  const items: NavItem[] = [];
  for (const section of sections) {
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
export function findActiveItemPath(path: string, sections: NavSection[] = configSections): string | null {
  let best: string | null = null;
  const consider = (itemPath: string) => {
    if (pathMatchesItem(path, itemPath)) {
      if (best === null || itemPath.length > best.length) best = itemPath;
    }
  };
  for (const section of sections) {
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
