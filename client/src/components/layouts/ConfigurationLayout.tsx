import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Users, MapPin, Phone, Globe, List, UserCog, ChevronDown, MessageSquare, Puzzle, Package, Heart, CreditCard, Activity, BookOpen, Wallet, Settings, Shield, Key, FileText, Palette, Building2 } from "lucide-react";
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
  const [isSystemOpen, setIsSystemOpen] = useState(false);
  const [isTrustOpen, setIsTrustOpen] = useState(false);
  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const [isContactOpen, setIsContactOpen] = useState(false);
  const [isEmployersOpen, setIsEmployersOpen] = useState(false);
  const [isDropDownListsOpen, setIsDropDownListsOpen] = useState(false);
  const [isLedgerOpen, setIsLedgerOpen] = useState(false);
  const [isStripeOpen, setIsStripeOpen] = useState(false);
  const [isUserManagementOpen, setIsUserManagementOpen] = useState(false);

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

  const regularNavItems: any[] = [];

  const systemItems = [
    {
      path: "/config/components",
      label: "Components",
      icon: Package,
      testId: "nav-config-components",
      permission: "admin",
    },
    {
      path: "/config/logs",
      label: "System Logs",
      icon: FileText,
      testId: "nav-config-logs",
      policy: "admin" as const,
    },
  ];

  const trustItems = [
    {
      path: "/trust-benefits",
      label: "Trust Benefits",
      icon: Heart,
      testId: "nav-trust-benefits",
      permission: "workers.view",
    },
    {
      path: "/config/trust-benefit-types",
      label: "Trust Benefit Types",
      icon: List,
      testId: "nav-config-trust-benefit-types",
      permission: "admin",
    },
  ];

  const themeItems = [
    {
      path: "/config/site",
      label: "Site Information",
      icon: Globe,
      testId: "nav-config-site",
      permission: "admin",
    },
    {
      path: "/config/dashboard-plugins",
      label: "Dashboard Plugins",
      icon: Puzzle,
      testId: "nav-config-dashboard-plugins",
      permission: "admin",
    },
    {
      path: "/config/employer-monthly-plugin",
      label: "Employer Monthly",
      icon: Building2,
      testId: "nav-config-employer-monthly-plugin",
      permission: "admin",
    },
    {
      path: "/config/welcome-messages",
      label: "Welcome Messages",
      icon: MessageSquare,
      testId: "nav-config-welcome-messages",
      permission: "admin",
    },
  ];

  const contactItems = [
    {
      path: "/config/addresses",
      label: "Postal Addresses",
      icon: MapPin,
      testId: "nav-config-addresses",
      permission: "admin",
    },
    {
      path: "/config/phone-numbers",
      label: "Phone Numbers",
      icon: Phone,
      testId: "nav-config-phone-numbers",
      permission: "admin",
    },
    {
      path: "/config/gender-options",
      label: "Gender Options",
      icon: List,
      testId: "nav-config-gender-options",
      permission: "admin",
    },
  ];

  const employersItems = [
    {
      path: "/config/employer-contact-types",
      label: "Employer Contact Types",
      icon: List,
      testId: "nav-config-employer-contact-types",
      permission: "admin",
    },
    {
      path: "/config/users/employer-settings",
      label: "Employer User Settings",
      icon: Settings,
      testId: "nav-config-users-employer-settings",
      permission: "admin",
    },
  ];

  const userManagementItems = [
    {
      path: "/config/users/list",
      label: "Users",
      icon: Users,
      testId: "nav-config-users-list",
      permission: "admin",
    },
    {
      path: "/config/users/roles",
      label: "Roles",
      icon: Shield,
      testId: "nav-config-users-roles",
      permission: "admin",
    },
    {
      path: "/config/users/permissions",
      label: "Permissions",
      icon: Key,
      testId: "nav-config-users-permissions",
      permission: "admin",
    },
    {
      path: "/config/users/policies",
      label: "Policies",
      icon: FileText,
      testId: "nav-config-users-policies",
      permission: "admin",
    },
    {
      path: "/config/masquerade",
      label: "Masquerade",
      icon: UserCog,
      testId: "nav-config-masquerade",
      permission: "admin",
    },
  ];

  const dropDownListItems = [
    {
      path: "/config/worker-id-types",
      label: "Worker ID Types",
      icon: List,
      testId: "nav-config-worker-id-types",
      permission: "admin",
    },
    {
      path: "/config/worker-work-statuses",
      label: "Worker Work Statuses",
      icon: List,
      testId: "nav-config-worker-work-statuses",
      permission: "admin",
    },
    {
      path: "/config/employment-statuses",
      label: "Employment Statuses",
      icon: List,
      testId: "nav-config-employment-statuses",
      permission: "admin",
    },
  ];

  const ledgerItems = [
    {
      path: "/config/ledger/accounts",
      label: "Accounts",
      icon: BookOpen,
      testId: "nav-ledger-accounts",
      policy: "ledgerStaff" as const,
    },
    {
      path: "/config/ledger/payment-types",
      label: "Payment Types",
      icon: Wallet,
      testId: "nav-ledger-payment-types",
      policy: "ledgerStaff" as const,
    },
  ];

  const stripeItems = [
    {
      path: "/config/ledger/stripe/settings",
      label: "Settings",
      icon: Settings,
      testId: "nav-ledger-stripe-settings",
      policy: "ledgerStripeAdmin" as const,
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
      label: "Payment Methods",
      icon: CreditCard,
      testId: "nav-ledger-stripe-payment-types",
      policy: "ledgerStripeAdmin" as const,
    },
  ];

  // Combine for policy checks
  const allLedgerItems = [...ledgerItems, ...stripeItems];
  const allNavItems = [...regularNavItems, ...systemItems, ...trustItems, ...themeItems, ...contactItems, ...employersItems, ...userManagementItems, ...dropDownListItems, ...allLedgerItems];

  // Fetch policy checks for navigation items that use policies
  const policiesNeeded = allNavItems
    .filter((item): item is typeof allNavItems[number] & { policy: string } => 'policy' in item && typeof item.policy === 'string')
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

  // Check if any system item is active
  const isSystemActive = systemItems.some(
    (item) => location === item.path || location.startsWith(item.path + "/")
  );

  // Check if any trust item is active
  const isTrustActive = trustItems.some(
    (item) => location === item.path || location.startsWith(item.path + "/")
  );

  // Check if any theme item is active
  const isThemeActive = themeItems.some(
    (item) => location === item.path || location.startsWith(item.path + "/")
  );

  // Check if any contact item is active
  const isContactActive = contactItems.some(
    (item) => location === item.path || location.startsWith(item.path + "/")
  );

  // Check if any employers item is active
  const isEmployersActive = employersItems.some(
    (item) => location === item.path || location.startsWith(item.path + "/")
  );

  // Check if any user management item is active
  const isUserManagementActive = userManagementItems.some(
    (item) => location === item.path || location.startsWith(item.path + "/")
  );

  // Check if any dropdown list item is active
  const isDropDownListActive = dropDownListItems.some(
    (item) => location === item.path || location.startsWith(item.path + "/")
  );

  // Check if any ledger item is active
  const isLedgerActive = allLedgerItems.some(
    (item) => location === item.path || location.startsWith(item.path + "/")
  );

  // Check if any stripe item is active
  const isStripeActive = stripeItems.some(
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
            {regularNavItems.filter(hasAccessToItem).map((item) => {
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

            {/* User Management Group */}
            {userManagementItems.some((item) => hasPermission(item.permission)) && (
              <Collapsible
                open={isUserManagementOpen || isUserManagementActive}
                onOpenChange={setIsUserManagementOpen}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant={isUserManagementActive ? "default" : "ghost"}
                    className="w-full justify-start"
                    data-testid="nav-config-user-management"
                  >
                    <Users className="mr-2 h-4 w-4" />
                    User Management
                    <ChevronDown className="ml-auto h-4 w-4 transition-transform duration-200" 
                      style={{ transform: (isUserManagementOpen || isUserManagementActive) ? 'rotate(180deg)' : 'rotate(0deg)' }} 
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="ml-4 mt-2 space-y-2">
                  {userManagementItems.filter((item) => hasPermission(item.permission)).map((item) => {
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

            {/* Workers Group */}
            {dropDownListItems.some((item) => hasPermission(item.permission)) && (
              <Collapsible
                open={isDropDownListsOpen || isDropDownListActive}
                onOpenChange={setIsDropDownListsOpen}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant={isDropDownListActive ? "default" : "ghost"}
                    className="w-full justify-start"
                    data-testid="nav-config-workers"
                  >
                    <List className="mr-2 h-4 w-4" />
                    Workers
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

            {/* Employers Group */}
            {employersItems.some((item) => hasPermission(item.permission)) && (
              <Collapsible
                open={isEmployersOpen || isEmployersActive}
                onOpenChange={setIsEmployersOpen}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant={isEmployersActive ? "default" : "ghost"}
                    className="w-full justify-start"
                    data-testid="nav-config-employers"
                  >
                    <CreditCard className="mr-2 h-4 w-4" />
                    Employers
                    <ChevronDown className="ml-auto h-4 w-4 transition-transform duration-200" 
                      style={{ transform: (isEmployersOpen || isEmployersActive) ? 'rotate(180deg)' : 'rotate(0deg)' }} 
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="ml-4 mt-2 space-y-2">
                  {employersItems.filter((item) => hasPermission(item.permission)).map((item) => {
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

            {/* Ledger Group */}
            {allLedgerItems.some(hasAccessToItem) && (
              <Collapsible
                open={isLedgerOpen || isLedgerActive}
                onOpenChange={setIsLedgerOpen}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant={isLedgerActive ? "default" : "ghost"}
                    className="w-full justify-start"
                    data-testid="nav-config-ledger"
                  >
                    <BookOpen className="mr-2 h-4 w-4" />
                    Ledger
                    <ChevronDown className="ml-auto h-4 w-4 transition-transform duration-200" 
                      style={{ transform: (isLedgerOpen || isLedgerActive) ? 'rotate(180deg)' : 'rotate(0deg)' }} 
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="ml-4 mt-2 space-y-2">
                  {/* Ledger items */}
                  {ledgerItems.filter(hasAccessToItem).map((item) => {
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

                  {/* Stripe Sub-group */}
                  {stripeItems.some(hasAccessToItem) && (
                    <Collapsible
                      open={isStripeOpen || isStripeActive}
                      onOpenChange={setIsStripeOpen}
                    >
                      <CollapsibleTrigger asChild>
                        <Button
                          variant={isStripeActive ? "secondary" : "ghost"}
                          className="w-full justify-start text-sm"
                          data-testid="nav-config-stripe"
                        >
                          <CreditCard className="mr-2 h-4 w-4" />
                          Stripe
                          <ChevronDown className="ml-auto h-4 w-4 transition-transform duration-200" 
                            style={{ transform: (isStripeOpen || isStripeActive) ? 'rotate(180deg)' : 'rotate(0deg)' }} 
                          />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="ml-4 mt-2 space-y-2">
                        {stripeItems.filter(hasAccessToItem).map((item) => {
                          const Icon = item.icon;
                          const isActive = location === item.path || location.startsWith(item.path + "/");
                          
                          return (
                            <Link key={item.path} href={item.path}>
                              <Button
                                variant={isActive ? "secondary" : "ghost"}
                                className="w-full justify-start text-xs"
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
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Trust Group */}
            {trustItems.some(hasAccessToItem) && (
              <Collapsible
                open={isTrustOpen || isTrustActive}
                onOpenChange={setIsTrustOpen}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant={isTrustActive ? "default" : "ghost"}
                    className="w-full justify-start"
                    data-testid="nav-config-trust"
                  >
                    <Heart className="mr-2 h-4 w-4" />
                    Trust
                    <ChevronDown className="ml-auto h-4 w-4 transition-transform duration-200" 
                      style={{ transform: (isTrustOpen || isTrustActive) ? 'rotate(180deg)' : 'rotate(0deg)' }} 
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="ml-4 mt-2 space-y-2">
                  {trustItems.filter(hasAccessToItem).map((item) => {
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

            {/* Theme Group */}
            {themeItems.some((item) => hasPermission(item.permission)) && (
              <Collapsible
                open={isThemeOpen || isThemeActive}
                onOpenChange={setIsThemeOpen}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant={isThemeActive ? "default" : "ghost"}
                    className="w-full justify-start"
                    data-testid="nav-config-theme"
                  >
                    <Palette className="mr-2 h-4 w-4" />
                    Theme
                    <ChevronDown className="ml-auto h-4 w-4 transition-transform duration-200" 
                      style={{ transform: (isThemeOpen || isThemeActive) ? 'rotate(180deg)' : 'rotate(0deg)' }} 
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="ml-4 mt-2 space-y-2">
                  {themeItems.filter((item) => hasPermission(item.permission)).map((item) => {
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

            {/* Contact Group */}
            {contactItems.some(hasAccessToItem) && (
              <Collapsible
                open={isContactOpen || isContactActive}
                onOpenChange={setIsContactOpen}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant={isContactActive ? "default" : "ghost"}
                    className="w-full justify-start"
                    data-testid="nav-config-contact"
                  >
                    <Users className="mr-2 h-4 w-4" />
                    Contact
                    <ChevronDown className="ml-auto h-4 w-4 transition-transform duration-200" 
                      style={{ transform: (isContactOpen || isContactActive) ? 'rotate(180deg)' : 'rotate(0deg)' }} 
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="ml-4 mt-2 space-y-2">
                  {contactItems.filter(hasAccessToItem).map((item) => {
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

            {/* System Group */}
            {systemItems.some(hasAccessToItem) && (
              <Collapsible
                open={isSystemOpen || isSystemActive}
                onOpenChange={setIsSystemOpen}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant={isSystemActive ? "default" : "ghost"}
                    className="w-full justify-start"
                    data-testid="nav-config-system"
                  >
                    <Settings className="mr-2 h-4 w-4" />
                    System
                    <ChevronDown className="ml-auto h-4 w-4 transition-transform duration-200" 
                      style={{ transform: (isSystemOpen || isSystemActive) ? 'rotate(180deg)' : 'rotate(0deg)' }} 
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="ml-4 mt-2 space-y-2">
                  {systemItems.filter(hasAccessToItem).map((item) => {
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
