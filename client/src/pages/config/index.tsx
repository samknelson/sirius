import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Users, MapPin, Phone, Globe, List, UserCog, Puzzle, Package, Heart, 
  CreditCard, Activity, Wallet, Settings, Shield, Key, FileText, 
  Building2, Database, Clock, Zap
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";

interface ComponentConfig {
  componentId: string;
  enabled: boolean;
}

interface NavItem {
  path: string;
  label: string;
  icon: React.ElementType;
  testId: string;
  permission?: string;
  policy?: string;
  requiresComponent?: string;
}

interface NavSection {
  title: string;
  description: string;
  icon: React.ElementType;
  items: NavItem[];
}

export default function ConfigurationLandingPage() {
  const { hasPermission } = useAuth();

  const { data: componentConfig = [] } = useQuery<ComponentConfig[]>({
    queryKey: ["/api/components/config"],
    staleTime: 60000,
  });

  const isComponentEnabled = (componentId: string) => {
    const config = componentConfig.find(c => c.componentId === componentId);
    return config?.enabled ?? false;
  };

  const sections: NavSection[] = [
    {
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
      title: "System",
      description: "Core system configuration and monitoring",
      icon: Settings,
      items: [
        { path: "/config/components", label: "Components", icon: Package, testId: "nav-config-components", permission: "admin" },
        { path: "/config/logs", label: "System Logs", icon: FileText, testId: "nav-config-logs", policy: "admin" },
        { path: "/admin/quickstarts", label: "Quickstarts", icon: Database, testId: "nav-config-quickstarts", policy: "admin" },
        { path: "/admin/cron-jobs", label: "Cron Jobs", icon: Clock, testId: "nav-config-cron-jobs", policy: "admin" },
      ],
    },
    {
      title: "Theme & Appearance",
      description: "Site branding and dashboard customization",
      icon: Globe,
      items: [
        { path: "/config/site", label: "Site Information", icon: Globe, testId: "nav-config-site", permission: "admin" },
        { path: "/config/dashboard-plugins", label: "Dashboard Plugins", icon: Puzzle, testId: "nav-config-dashboard-plugins", permission: "admin" },
      ],
    },
    {
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
      title: "Employers",
      description: "Employer-related configuration",
      icon: Building2,
      items: [
        { path: "/config/employer-contact-types", label: "Employer Contact Types", icon: List, testId: "nav-config-employer-contact-types", permission: "admin" },
        { path: "/config/users/employer-settings", label: "Employer User Settings", icon: Settings, testId: "nav-config-users-employer-settings", permission: "admin" },
      ],
    },
    {
      title: "Contact Information",
      description: "Address and phone number settings",
      icon: Phone,
      items: [
        { path: "/config/addresses", label: "Postal Addresses", icon: MapPin, testId: "nav-config-addresses", permission: "admin" },
        { path: "/config/phone-numbers", label: "Phone Numbers", icon: Phone, testId: "nav-config-phone-numbers", permission: "admin" },
        { path: "/config/gender-options", label: "Gender Options", icon: List, testId: "nav-config-gender-options", permission: "admin" },
      ],
    },
    {
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
      title: "Ledger",
      description: "Financial ledger and payment configuration",
      icon: Wallet,
      items: [
        { path: "/config/ledger/payment-types", label: "Payment Types", icon: Wallet, testId: "nav-ledger-payment-types", policy: "ledgerStaff" },
        { path: "/config/ledger/charge-plugins", label: "Charge Plugins", icon: Zap, testId: "nav-ledger-charge-plugins", policy: "admin" },
      ],
    },
    {
      title: "Stripe",
      description: "Stripe payment integration settings",
      icon: CreditCard,
      items: [
        { path: "/config/ledger/stripe/settings", label: "Settings", icon: Settings, testId: "nav-ledger-stripe-settings", policy: "ledgerStripeAdmin" },
        { path: "/config/ledger/stripe/test", label: "Test Connection", icon: Activity, testId: "nav-ledger-stripe-test", policy: "ledgerStripeAdmin" },
        { path: "/config/ledger/stripe/payment-types", label: "Payment Methods", icon: CreditCard, testId: "nav-ledger-stripe-payment-types", policy: "ledgerStripeAdmin" },
      ],
    },
  ];

  const allPoliciesNeeded = sections
    .flatMap(s => s.items)
    .filter((item): item is NavItem & { policy: string } => !!item.policy)
    .map(item => item.policy);

  const { data: policyResults = {} } = useQuery<Record<string, { allowed: boolean }>>({
    queryKey: ["/api/access/policies/batch", ...allPoliciesNeeded],
    queryFn: async () => {
      if (allPoliciesNeeded.length === 0) return {};
      
      const results: Record<string, { allowed: boolean }> = {};
      await Promise.all(
        allPoliciesNeeded.map(async (policy) => {
          try {
            const response = await fetch(`/api/access/policies/${policy}`);
            if (response.ok) {
              const data = await response.json();
              results[policy] = { allowed: data.allowed };
            } else {
              results[policy] = { allowed: false };
            }
          } catch {
            results[policy] = { allowed: false };
          }
        })
      );
      return results;
    },
    staleTime: 30000,
    enabled: allPoliciesNeeded.length > 0,
  });

  const hasAccessToItem = (item: NavItem) => {
    if (item.policy) {
      return policyResults[item.policy]?.allowed ?? false;
    }
    if (item.permission) {
      const hasPermissionCheck = hasPermission(item.permission);
      const hasComponentCheck = !item.requiresComponent || isComponentEnabled(item.requiresComponent);
      return hasPermissionCheck && hasComponentCheck;
    }
    return false;
  };

  const getAccessibleItems = (items: NavItem[]) => {
    return items.filter(hasAccessToItem);
  };

  const accessibleSections = sections
    .map(section => ({
      ...section,
      items: getAccessibleItems(section.items),
    }))
    .filter(section => section.items.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="heading-configuration">
          Configuration
        </h1>
        <p className="text-muted-foreground mt-2">
          System settings and administrative options
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {accessibleSections.map((section) => (
          <Card key={section.title} data-testid={`card-section-${section.title.toLowerCase().replace(/\s+/g, '-')}`}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <section.icon className="h-5 w-5 text-muted-foreground" />
                {section.title}
              </CardTitle>
              <CardDescription>{section.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {section.items.map((item) => (
                  <Link key={item.path} href={item.path}>
                    <div
                      className="flex items-center gap-2 px-3 py-2 rounded-md hover-elevate cursor-pointer text-sm"
                      data-testid={item.testId}
                    >
                      <item.icon className="h-4 w-4 text-muted-foreground" />
                      <span>{item.label}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
