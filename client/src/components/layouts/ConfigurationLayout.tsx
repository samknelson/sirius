import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronDown, BookOpen, Palette } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState, useMemo } from "react";
import {
  isPathInSection,
  findActiveItemPath,
  type NavItem,
  type NavSection,
} from "@/config/navigation-registry";
import { useAccessibleConfigSections, useConfigNavigation } from "@/hooks/useConfigNavigation";

interface ConfigurationLayoutProps {
  children: React.ReactNode;
}

export default function ConfigurationLayout({ children }: ConfigurationLayoutProps) {
  const [location] = useLocation();

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  // Sections come resolved (the options lists are named by the registry) and
  // already filtered by permission, policy and component.
  const { sections } = useConfigNavigation();
  const { sections: accessibleSections } = useAccessibleConfigSections();

  // The single most-specific nav item that matches the current location.
  // Highlighting is keyed off this so sub-paths (e.g. plugin-config kinds at
  // /admin/plugin-configs/:kind) light up their own item rather than the
  // generic parent, and never highlight two items at once.
  const activeItemPath = useMemo(() => findActiveItemPath(location, sections), [location, sections]);

  const isSectionActive = (section: NavSection) => isPathInSection(activeItemPath, section);

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
    const isActive = activeItemPath === item.path;
    
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
    const isActive = isPathInSection(activeItemPath, subsection);
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
          {section.itemsStatus === "loading" && (
            <p className="px-3 py-2 text-sm text-muted-foreground" data-testid={`text-${section.id}-loading`}>
              Loading…
            </p>
          )}
          {section.itemsStatus === "error" && (
            <p className="px-3 py-2 text-sm text-destructive" data-testid={`text-${section.id}-error`}>
              Couldn't load these
            </p>
          )}
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
        <div className="max-w-7xl mx-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

function getSectionDisplayTitle(section: NavSection): string {
  const titleMap: Record<string, string> = {
    "theme": "Theme",
  };
  return titleMap[section.id] || section.title;
}

function getSectionTestId(section: NavSection): string {
  const testIdMap: Record<string, string> = {
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
