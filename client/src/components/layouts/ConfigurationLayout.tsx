import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Users, MapPin, Phone, Globe, List, UserCog, ChevronDown, MessageSquare, Puzzle, Package, Heart, CreditCard, Activity, BookOpen } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState } from "react";

interface ConfigurationLayoutProps {
  children: React.ReactNode;
}

interface ComponentConfig {
  componentId: string;
  enabled: boolean;
}

export default function ConfigurationLayout({ children }: ConfigurationLayoutProps) {
  const [location] = useLocation();
  const { hasPermission } = useAuth();
  const [isDropDownListsOpen, setIsDropDownListsOpen] = useState(false);
  const [isLedgerStripeOpen, setIsLedgerStripeOpen] = useState(false);

  // Fetch component configuration
  const { data: componentConfig = [] } = useQuery<ComponentConfig[]>({
    queryKey: ["/api/components/config"],
    staleTime: 60000, // 1 minute
  });

  // Helper to check if a component is enabled
  const isComponentEnabled = (componentId: string) => {
    const config = componentConfig.find(c => c.componentId === componentId);
    return config?.enabled ?? false;
  };

  const regularNavItems = [
    {
      path: "/trust-benefits",
      label: "Trust Benefits",
      icon: Heart,
      testId: "nav-trust-benefits",
      permission: "workers.view",
    },
    {
      path: "/config/site",
      label: "Site Information",
      icon: Globe,
      testId: "nav-config-site",
      permission: "variables.manage",
    },
    {
      path: "/config/dashboard-plugins",
      label: "Dashboard Plugins",
      icon: Puzzle,
      testId: "nav-config-dashboard-plugins",
      permission: "variables.manage",
    },
    {
      path: "/config/components",
      label: "Components",
      icon: Package,
      testId: "nav-config-components",
      permission: "variables.manage",
    },
    {
      path: "/config/welcome-messages",
      label: "Welcome Messages",
      icon: MessageSquare,
      testId: "nav-config-welcome-messages",
      permission: "variables.manage",
    },
    {
      path: "/config/users",
      label: "User Management",
      icon: Users,
      testId: "nav-config-users",
      permission: "admin.manage",
    },
    {
      path: "/config/masquerade",
      label: "Masquerade",
      icon: UserCog,
      testId: "nav-config-masquerade",
      permission: "admin.manage",
    },
    {
      path: "/config/addresses",
      label: "Postal Addresses",
      icon: MapPin,
      testId: "nav-config-addresses",
      permission: "admin.manage",
    },
    {
      path: "/config/phone-numbers",
      label: "Phone Numbers",
      icon: Phone,
      testId: "nav-config-phone-numbers",
      permission: "admin.manage",
    },
  ];

  const dropDownListItems = [
    {
      path: "/config/gender-options",
      label: "Gender Options",
      icon: List,
      testId: "nav-config-gender-options",
      permission: "variables.manage",
    },
    {
      path: "/config/worker-id-types",
      label: "Worker ID Types",
      icon: List,
      testId: "nav-config-worker-id-types",
      permission: "variables.manage",
    },
    {
      path: "/config/trust-benefit-types",
      label: "Trust Benefit Types",
      icon: List,
      testId: "nav-config-trust-benefit-types",
      permission: "variables.manage",
    },
  ];

  const ledgerStripeItems = [
    {
      path: "/config/ledger/accounts",
      label: "Accounts",
      icon: BookOpen,
      testId: "nav-ledger-accounts",
      policy: "ledgerStaff" as const,
    },
    {
      path: "/config/ledger/stripe/test",
      label: "Test Connection",
      icon: Activity,
      testId: "nav-ledger-stripe-test",
      policy: "ledgerStripeAdmin" as const,
    },
    {
      path: "/config/ledger/stripe/payment-types",
      label: "Payment Types",
      icon: CreditCard,
      testId: "nav-ledger-stripe-payment-types",
      policy: "ledgerStripeAdmin" as const,
    },
  ];

  // Fetch policy checks for navigation items that use policies
  const policiesNeeded = ledgerStripeItems
    .filter((item): item is typeof ledgerStripeItems[number] & { policy: string } => 'policy' in item && typeof item.policy === 'string')
    .map(item => item.policy);

  const { data: policyResults = {} } = useQuery<Record<string, { allowed: boolean }>>({
    queryKey: ["/api/access/policies/batch", ...policiesNeeded],
    queryFn: async () => {
      if (policiesNeeded.length === 0) return {};
      
      const results: Record<string, { allowed: boolean }> = {};
      await Promise.all(
        policiesNeeded.map(async (policy) => {
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
    staleTime: 30000, // 30 seconds
    enabled: policiesNeeded.length > 0,
  });

  // Helper to check if user has access to a navigation item
  const hasAccessToItem = (item: any) => {
    // If item uses policy-based check, use the policy result
    if (item.policy && typeof item.policy === 'string') {
      return policyResults[item.policy]?.allowed ?? false;
    }
    
    // Otherwise use permission-based check
    if (item.permission) {
      const hasPermissionCheck = hasPermission(item.permission);
      const hasComponentCheck = !item.requiresComponent || isComponentEnabled(item.requiresComponent);
      return hasPermissionCheck && hasComponentCheck;
    }
    
    return false;
  };

  // Check if any dropdown list item is active
  const isDropDownListActive = dropDownListItems.some(
    (item) => location === item.path || location.startsWith(item.path + "/")
  );

  // Check if any ledger/stripe item is active
  const isLedgerStripeActive = ledgerStripeItems.some(
    (item) => location === item.path || location.startsWith(item.path + "/")
  );

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <div className="w-64 bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-6">
            Configuration
          </h2>
          <nav className="space-y-2">
            {regularNavItems.filter((item) => hasPermission(item.permission)).map((item) => {
              const Icon = item.icon;
              const isActive = location === item.path || location.startsWith(item.path + "/");
              
              return (
                <Link key={item.path} href={item.path}>
                  <Button
                    variant={isActive ? "default" : "ghost"}
                    className="w-full justify-start"
                    data-testid={item.testId}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    {item.label}
                  </Button>
                </Link>
              );
            })}

            {/* Drop-Down Lists Group */}
            {dropDownListItems.some((item) => hasPermission(item.permission)) && (
              <Collapsible
                open={isDropDownListsOpen || isDropDownListActive}
                onOpenChange={setIsDropDownListsOpen}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant={isDropDownListActive ? "default" : "ghost"}
                    className="w-full justify-start"
                    data-testid="nav-config-dropdown-lists"
                  >
                    <List className="mr-2 h-4 w-4" />
                    Drop-Down Lists
                    <ChevronDown className="ml-auto h-4 w-4 transition-transform duration-200" 
                      style={{ transform: (isDropDownListsOpen || isDropDownListActive) ? 'rotate(180deg)' : 'rotate(0deg)' }} 
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="ml-4 mt-2 space-y-2">
                  {dropDownListItems.filter((item) => hasPermission(item.permission)).map((item) => {
                    const Icon = item.icon;
                    const isActive = location === item.path || location.startsWith(item.path + "/");
                    
                    return (
                      <Link key={item.path} href={item.path}>
                        <Button
                          variant={isActive ? "secondary" : "ghost"}
                          className="w-full justify-start text-sm"
                          data-testid={item.testId}
                        >
                          <Icon className="mr-2 h-4 w-4" />
                          {item.label}
                        </Button>
                      </Link>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Ledger/Stripe Group */}
            {ledgerStripeItems.some(hasAccessToItem) && (
              <Collapsible
                open={isLedgerStripeOpen || isLedgerStripeActive}
                onOpenChange={setIsLedgerStripeOpen}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant={isLedgerStripeActive ? "default" : "ghost"}
                    className="w-full justify-start"
                    data-testid="nav-config-ledger-stripe"
                  >
                    <CreditCard className="mr-2 h-4 w-4" />
                    Ledger / Stripe
                    <ChevronDown className="ml-auto h-4 w-4 transition-transform duration-200" 
                      style={{ transform: (isLedgerStripeOpen || isLedgerStripeActive) ? 'rotate(180deg)' : 'rotate(0deg)' }} 
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="ml-4 mt-2 space-y-2">
                  {ledgerStripeItems.filter(hasAccessToItem).map((item) => {
                    const Icon = item.icon;
                    const isActive = location === item.path || location.startsWith(item.path + "/");
                    
                    return (
                      <Link key={item.path} href={item.path}>
                        <Button
                          variant={isActive ? "secondary" : "ghost"}
                          className="w-full justify-start text-sm"
                          data-testid={item.testId}
                        >
                          <Icon className="mr-2 h-4 w-4" />
                          {item.label}
                        </Button>
                      </Link>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>
            )}
          </nav>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 p-6">
        {children}
      </div>
    </div>
  );
}
