import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronDown, BookOpen, Menu, Palette, X } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { createContext, useContext, useEffect, useState, useMemo } from "react";
import {
  isPathInSection,
  findActiveItemPath,
  type NavItem,
  type NavSection,
} from "@/config/navigation-registry";
import { useAccessibleConfigSections, useConfigNavigation } from "@/hooks/useConfigNavigation";
import { cn } from "@/lib/utils";
import {
  createConfigurationSectionOpenState,
  loadConfigurationMenuOpen,
  reconcileConfigurationSectionNavigation,
  saveConfigurationMenuOpen,
  toggleConfigurationSection,
} from "./configuration-sidebar-state";

interface ConfigurationLayoutProps {
  children: React.ReactNode;
}

const ConfigurationLayoutContext = createContext(false);

export default function ConfigurationLayout({ children }: ConfigurationLayoutProps) {
  const isNested = useContext(ConfigurationLayoutContext);
  if (isNested) return <>{children}</>;

  return (
    <ConfigurationLayoutContext.Provider value>
      <ConfigurationLayoutContents>{children}</ConfigurationLayoutContents>
    </ConfigurationLayoutContext.Provider>
  );
}

function ConfigurationLayoutContents({ children }: ConfigurationLayoutProps) {
  const [location] = useLocation();
  const [desktopMenuOpen, setDesktopMenuOpen] = useState(loadConfigurationMenuOpen);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

  const activeSectionIds = useMemo(() => {
    const ids: string[] = [];
    for (const section of accessibleSections) {
      if (!isPathInSection(activeItemPath, section)) continue;
      ids.push(section.id);
      for (const subsection of section.subsections ?? []) {
        if (isPathInSection(activeItemPath, subsection)) ids.push(subsection.id);
      }
    }
    return ids;
  }, [accessibleSections, activeItemPath]);

  const [sectionState, setSectionState] = useState(() =>
    createConfigurationSectionOpenState(location, activeSectionIds)
  );

  useEffect(() => {
    setSectionState(previous =>
      reconcileConfigurationSectionNavigation(previous, location, activeSectionIds)
    );
  }, [location, activeSectionIds]);

  useEffect(() => {
    saveConfigurationMenuOpen(desktopMenuOpen);
  }, [desktopMenuOpen]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location]);

  const toggleSection = (sectionId: string) => {
    setSectionState(previous => toggleConfigurationSection(previous, sectionId));
  };

  const isSectionOpen = (section: NavSection) => !!sectionState.openSections[section.id];

  const renderNavItem = (item: NavItem, isNested: boolean = false) => {
    const Icon = item.icon;
    const isActive = activeItemPath === item.path;
    
    return (
      <Link key={item.path} href={item.path}>
        <Button
          variant={isActive ? (isNested ? "secondary" : "default") : "ghost"}
          className={cn(
            "h-auto min-h-10 w-full items-start justify-start whitespace-normal py-2 text-left",
            isNested && "text-sm",
          )}
          data-testid={item.testId}
        >
          <Icon className="mr-2 mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{item.label}</span>
        </Button>
      </Link>
    );
  };

  const renderSubsection = (subsection: NavSection) => {
    const isActive = isPathInSection(activeItemPath, subsection);
    const isOpen = isSectionOpen(subsection);
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
            className="h-auto min-h-10 w-full items-start justify-start whitespace-normal py-2 text-left text-sm"
            data-testid={`nav-config-${subsection.id}`}
          >
            <Icon className="mr-2 mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{subsection.title}</span>
            <ChevronDown
              className="ml-2 mt-0.5 h-4 w-4 shrink-0 transition-transform duration-200"
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
            className="h-auto min-h-10 w-full items-start justify-start whitespace-normal py-2 text-left"
            data-testid={getSectionTestId(section)}
          >
            <Icon className="mr-2 mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{getSectionDisplayTitle(section)}</span>
            <ChevronDown
              className="ml-2 mt-0.5 h-4 w-4 shrink-0 transition-transform duration-200"
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
          {section.subsections?.map(sub => renderSubsection(sub))}
        </CollapsibleContent>
      </Collapsible>
    );
  };

  return (
    <div className="relative flex min-h-screen min-w-0 bg-gray-50 dark:bg-gray-900">
      {mobileMenuOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          aria-label="Close configuration menu"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      <aside
        id="configuration-menu"
        className={cn(
          "z-40 w-72 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950",
          "max-h-screen overflow-x-hidden overflow-y-auto md:sticky md:top-0 md:w-64",
          mobileMenuOpen ? "fixed inset-y-0 left-0 flex" : "hidden",
          desktopMenuOpen ? "md:flex" : "md:hidden",
        )}
        aria-label="Configuration menu"
      >
        <div className="p-4 sm:p-6">
          <div className="mb-6 flex items-start gap-2">
            <Link href="/config" className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-gray-900 hover:text-primary dark:text-gray-100">
                Configuration
              </h2>
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-auto shrink-0 md:hidden"
              aria-label="Close configuration menu"
              aria-controls="configuration-menu"
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen(false)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          <nav className="space-y-2">
            {accessibleSections.map(section => renderSection(section))}
          </nav>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl">
          <div className="mb-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="md:hidden"
              aria-label={mobileMenuOpen ? "Hide configuration menu" : "Show configuration menu"}
              aria-controls="configuration-menu"
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen(open => !open)}
              data-testid="button-configuration-menu-mobile"
            >
              <Menu className="mr-2 h-4 w-4" />
              Configuration menu
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="hidden md:inline-flex"
              aria-label={desktopMenuOpen ? "Hide configuration menu" : "Show configuration menu"}
              aria-controls="configuration-menu"
              aria-expanded={desktopMenuOpen}
              onClick={() => setDesktopMenuOpen(open => !open)}
              data-testid="button-configuration-menu-desktop"
            >
              <Menu className="mr-2 h-4 w-4" />
              {desktopMenuOpen ? "Hide menu" : "Show menu"}
            </Button>
          </div>
          {children}
        </div>
      </main>
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
