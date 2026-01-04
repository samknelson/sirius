import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronDown, BookOpen, Palette } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState, useMemo } from "react";
import { usePageTitle } from "@/contexts/PageTitleContext";
import {
  configSections,
  getAllPoliciesNeeded,
  getAccessibleSections,
  isPathInSection,
  type NavItem,
  type NavSection,
  type AccessContext,
} from "@/config/navigation-registry";

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
  
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const { data: componentConfig = [] } = useQuery<ComponentConfig[]>({
    queryKey: ["/api/components/config"],
    staleTime: 60000,
  });

  const isComponentEnabled = (componentId: string) => {
    const config = componentConfig.find(c => c.componentId === componentId);
    return config?.enabled ?? false;
  };

  const policiesNeeded = useMemo(() => getAllPoliciesNeeded(), []);

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
    staleTime: 30000,
    enabled: policiesNeeded.length > 0,
  });

  const accessContext: AccessContext = useMemo(() => ({
    hasPermission,
    policyResults,
    isComponentEnabled,
  }), [hasPermission, policyResults, componentConfig]);

  const accessibleSections = useMemo(
    () => getAccessibleSections(accessContext),
    [accessContext]
  );

  const isSectionActive = (section: NavSection) => isPathInSection(location, section);

  const toggleSection = (sectionId: string) => {
    setOpenSections(prev => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const isSectionOpen = (section: NavSection) => {
    return openSections[section.id] || isSectionActive(section);
  };

  const renderNavItem = (item: NavItem, isNested: boolean = false) => {
    const Icon = item.icon;
    const isActive = location === item.path || location.startsWith(item.path + "/");
    
    return (
      <Link key={item.path} href={item.path}>
        <Button
          variant={isActive ? (isNested ? "secondary" : "default") : "ghost"}
          className={`w-full justify-start ${isNested ? "text-sm" : ""}`}
          data-testid={item.testId}
        >
          <Icon className="mr-2 h-4 w-4" />
          {item.label}
        </Button>
      </Link>
    );
  };

  const renderSubsection = (subsection: NavSection, parentActive: boolean) => {
    const isActive = isPathInSection(location, subsection);
    const isOpen = openSections[subsection.id] || isActive;
    const Icon = subsection.icon;

    return (
      <Collapsible
        key={subsection.id}
        open={isOpen}
        onOpenChange={() => toggleSection(subsection.id)}
      >
        <CollapsibleTrigger asChild>
          <Button
            variant={isActive ? "secondary" : "ghost"}
            className="w-full justify-start text-sm"
            data-testid={`nav-config-${subsection.id}`}
          >
            <Icon className="mr-2 h-4 w-4" />
            {subsection.title}
            <ChevronDown 
              className="ml-auto h-4 w-4 transition-transform duration-200" 
              style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} 
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="ml-4 mt-2 space-y-2">
          {subsection.items.map(item => renderNavItem(item, true))}
        </CollapsibleContent>
      </Collapsible>
    );
  };

  const renderSection = (section: NavSection) => {
    const isActive = isSectionActive(section);
    const isOpen = isSectionOpen(section);
    const Icon = getSectionIcon(section);

    return (
      <Collapsible
        key={section.id}
        open={isOpen}
        onOpenChange={() => toggleSection(section.id)}
      >
        <CollapsibleTrigger asChild>
          <Button
            variant={isActive ? "default" : "ghost"}
            className="w-full justify-start"
            data-testid={getSectionTestId(section)}
          >
            <Icon className="mr-2 h-4 w-4" />
            {getSectionDisplayTitle(section)}
            <ChevronDown 
              className="ml-auto h-4 w-4 transition-transform duration-200" 
              style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} 
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="ml-4 mt-2 space-y-2">
          {section.items.map(item => renderNavItem(item, true))}
          {section.subsections?.map(sub => renderSubsection(sub, isActive))}
        </CollapsibleContent>
      </Collapsible>
    );
  };

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="w-64 bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800">
        <div className="p-6">
          <Link href="/config">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-6 hover:text-primary cursor-pointer">
              Configuration
            </h2>
          </Link>
          <nav className="space-y-2">
            {accessibleSections.map(section => renderSection(section))}
          </nav>
        </div>
      </div>

      <div className="flex-1 p-6">
        {children}
      </div>
    </div>
  );
}

function getSectionDisplayTitle(section: NavSection): string {
  const titleMap: Record<string, string> = {
    "dropdown-lists": "Workers",
    "theme": "Theme",
  };
  return titleMap[section.id] || section.title;
}

function getSectionTestId(section: NavSection): string {
  const testIdMap: Record<string, string> = {
    "dropdown-lists": "nav-config-workers",
    "user-management": "nav-config-user-management",
    "contact": "nav-config-contact",
    "employers": "nav-config-employers",
    "trust": "nav-config-trust",
    "theme": "nav-config-theme",
    "system": "nav-config-system",
    "ledger": "nav-config-ledger",
  };
  return testIdMap[section.id] || `nav-config-${section.id}`;
}

function getSectionIcon(section: NavSection) {
  const iconMap: Record<string, typeof BookOpen> = {
    "ledger": BookOpen,
    "theme": Palette,
  };
  return iconMap[section.id] || section.icon;
}
