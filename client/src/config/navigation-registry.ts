import { 
  Users, MapPin, Phone, Globe, List, UserCog, Puzzle, Package, Heart, 
  CreditCard, Activity, Wallet, Settings, Shield, Key, FileText, 
  Building2, Database, Clock, Zap, Server, MessageSquare, type LucideIcon
} from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  testId: string;
  permission?: string;
  policy?: string;
  requiresComponent?: string;
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
    id: "user-management",
    title: "User Management",
    description: "Manage users, roles, permissions, and access control",
    icon: Users,
    items: [
      { path: "/config/users/list", label: "Users", icon: Users, testId: "nav-config-users-list", permission: "admin" },
      { path: "/config/users/roles", label: "Roles", icon: Shield, testId: "nav-config-users-roles", permission: "admin" },
      { path: "/config/users/permissions", label: "Permissions", icon: Key, testId: "nav-config-users-permissions", permission: "admin" },
      { path: "/config/users/policies", label: "Policies", icon: FileText, testId: "nav-config-users-policies", permission: "admin" },
      { path: "/config/masquerade", label: "Masquerade", icon: UserCog, testId: "nav-config-masquerade", permission: "admin" },
    ],
  },
  {
    id: "system",
    title: "System",
    description: "Core system configuration and monitoring",
    icon: Settings,
    items: [
      { path: "/config/system-mode", label: "System Mode", icon: Server, testId: "nav-config-system-mode", policy: "admin" },
      { path: "/config/twilio", label: "SMS Providers", icon: MessageSquare, testId: "nav-config-sms", policy: "admin" },
      { path: "/config/email", label: "Email Providers", icon: MessageSquare, testId: "nav-config-email", policy: "admin" },
      { path: "/config/components", label: "Components", icon: Package, testId: "nav-config-components", permission: "admin" },
      { path: "/config/logs", label: "System Logs", icon: FileText, testId: "nav-config-logs", policy: "admin" },
      { path: "/admin/quickstarts", label: "Quickstarts", icon: Database, testId: "nav-config-quickstarts", policy: "admin" },
      { path: "/admin/cron-jobs", label: "Cron Jobs", icon: Clock, testId: "nav-config-cron-jobs", policy: "admin" },
    ],
  },
  {
    id: "theme",
    title: "Theme & Appearance",
    description: "Site branding and dashboard customization",
    icon: Globe,
    items: [
      { path: "/config/site", label: "Site Information", icon: Globe, testId: "nav-config-site", permission: "admin" },
      { path: "/config/dashboard-plugins", label: "Dashboard Plugins", icon: Puzzle, testId: "nav-config-dashboard-plugins", permission: "admin" },
    ],
  },
  {
    id: "trust",
    title: "Trust",
    description: "Trust benefits and provider configuration",
    icon: Heart,
    items: [
      { path: "/trust-benefits", label: "Trust Benefits", icon: Heart, testId: "nav-trust-benefits", permission: "workers.view" },
      { path: "/config/trust-benefit-types", label: "Trust Benefit Types", icon: List, testId: "nav-config-trust-benefit-types", permission: "admin" },
      { path: "/config/provider-contact-types", label: "Provider Contact Types", icon: List, testId: "nav-config-provider-contact-types", permission: "admin" },
      { path: "/config/users/trust-provider-settings", label: "Provider User Settings", icon: Settings, testId: "nav-config-users-trust-provider-settings", permission: "admin" },
    ],
  },
  {
    id: "employers",
    title: "Employers",
    description: "Employer-related configuration",
    icon: Building2,
    items: [
      { path: "/config/employer-contact-types", label: "Employer Contact Types", icon: List, testId: "nav-config-employer-contact-types", permission: "admin" },
      { path: "/config/users/employer-settings", label: "Employer User Settings", icon: Settings, testId: "nav-config-users-employer-settings", permission: "admin" },
    ],
  },
  {
    id: "contact",
    title: "Contact Information",
    description: "Address and phone number settings",
    icon: Phone,
    items: [
      { path: "/config/addresses", label: "Postal Addresses", icon: MapPin, testId: "nav-config-addresses", permission: "admin" },
      { path: "/config/gender-options", label: "Gender Options", icon: List, testId: "nav-config-gender-options", permission: "admin" },
    ],
  },
  {
    id: "dropdown-lists",
    title: "Dropdown Lists",
    description: "Configurable dropdown options",
    icon: List,
    items: [
      { path: "/config/worker-id-types", label: "Worker ID Types", icon: List, testId: "nav-config-worker-id-types", permission: "admin" },
      { path: "/config/worker-work-statuses", label: "Worker Work Statuses", icon: List, testId: "nav-config-worker-work-statuses", permission: "admin" },
      { path: "/config/employment-statuses", label: "Employment Statuses", icon: List, testId: "nav-config-employment-statuses", permission: "admin" },
    ],
  },
  {
    id: "ledger",
    title: "Ledger",
    description: "Financial ledger and payment configuration",
    icon: Wallet,
    items: [
      { path: "/config/ledger/payment-types", label: "Payment Types", icon: Wallet, testId: "nav-ledger-payment-types", policy: "ledgerStaff" },
      { path: "/config/ledger/charge-plugins", label: "Charge Plugins", icon: Zap, testId: "nav-ledger-charge-plugins", policy: "admin" },
    ],
    subsections: [
      {
        id: "stripe",
        title: "Stripe",
        description: "Stripe payment integration settings",
        icon: CreditCard,
        items: [
          { path: "/config/ledger/stripe/settings", label: "Settings", icon: Settings, testId: "nav-ledger-stripe-settings", policy: "ledgerStripeAdmin" },
          { path: "/config/ledger/stripe/test", label: "Test Connection", icon: Activity, testId: "nav-ledger-stripe-test", policy: "ledgerStripeAdmin" },
          { path: "/config/ledger/stripe/payment-types", label: "Payment Methods", icon: CreditCard, testId: "nav-ledger-stripe-payment-types", policy: "ledgerStripeAdmin" },
        ],
      },
    ],
  },
];

export interface AccessContext {
  hasPermission: (permission: string) => boolean;
  policyResults: Record<string, { allowed: boolean }>;
  isComponentEnabled: (componentId: string) => boolean;
}

export function hasAccessToItem(item: NavItem, context: AccessContext): boolean {
  if (item.policy) {
    return context.policyResults[item.policy]?.allowed ?? false;
  }
  if (item.permission) {
    const hasPermissionCheck = context.hasPermission(item.permission);
    const hasComponentCheck = !item.requiresComponent || context.isComponentEnabled(item.requiresComponent);
    return hasPermissionCheck && hasComponentCheck;
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

export function isPathInSection(path: string, section: NavSection): boolean {
  const inItems = section.items.some(
    item => path === item.path || path.startsWith(item.path + "/")
  );
  if (inItems) return true;

  if (section.subsections) {
    return section.subsections.some(sub =>
      sub.items.some(item => path === item.path || path.startsWith(item.path + "/"))
    );
  }

  return false;
}
