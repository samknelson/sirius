import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronDown, BookOpen, Menu, Palette, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Portal as TooltipPortal } from "@radix-ui/react-tooltip";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  findActiveItemPath,
  isPathInSection,
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
  const layoutRef = useRef<HTMLDivElement>(null);
  const [location] = useLocation();
  const [desktopMenuOpen, setDesktopMenuOpen] = useState(loadConfigurationMenuOpen);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFlyoutId, setOpenFlyoutId] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia("(min-width: 768px)").matches,
  );
  const { sections } = useConfigNavigation();
  const { sections: accessibleSections } = useAccessibleConfigSections();
  const topLevelSectionIds = useMemo(() => accessibleSections.map(section => section.id), [accessibleSections]);
  const activeItemPath = useMemo(() => findActiveItemPath(location, sections), [location, sections]);
  const activeSectionIds = useMemo(() => {
    const ids: string[] = [];
    for (const section of accessibleSections) {
      if (isPathInSection(activeItemPath, section)) ids.push(section.id);
      for (const subsection of section.subsections ?? []) {
        if (isPathInSection(activeItemPath, subsection)) ids.push(subsection.id);
      }
    }
    return ids;
  }, [accessibleSections, activeItemPath]);
  const [sectionState, setSectionState] = useState(() =>
    createConfigurationSectionOpenState(location, activeSectionIds),
  );

  useLayoutEffect(() => {
    if (!isDesktop || !layoutRef.current) return;
    const layout = layoutRef.current;
    // The header is in normal document flow (and can grow for masquerading).
    // Measure the layout's visible top, not a hard-coded header height. As the
    // document scrolls, the sticky sidebar can use the newly available space.
    const measure = () => {
      const top = Math.max(0, layout.getBoundingClientRect().top);
      layout.style.setProperty("--configuration-top", `${top}px`);
    };
    let frame = 0;
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(scheduleMeasure);
    // Any preceding normal-flow sibling, at any ancestor level, can move us
    // without resizing us (notably the asynchronously loaded HelpDisplay).
    // Observe their sizes and refresh the set when siblings are added/removed.
    const observePrecedingContent = () => {
      observer.disconnect();
      observer.observe(layout);
      for (let node: Element | null = layout; node && node !== document.body; node = node.parentElement) {
        for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
          observer.observe(sibling, { box: "border-box" });
        }
      }
      scheduleMeasure();
    };
    const mutations = new MutationObserver(observePrecedingContent);
    for (let parent = layout.parentElement; parent; parent = parent.parentElement) {
      mutations.observe(parent, { childList: true });
    }
    observePrecedingContent();
    window.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      layout.style.removeProperty("--configuration-top");
    };
  }, [isDesktop]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const syncBreakpoint = () => {
      setIsDesktop(media.matches);
      setOpenFlyoutId(null);
    };
    syncBreakpoint();
    media.addEventListener("change", syncBreakpoint);
    return () => media.removeEventListener("change", syncBreakpoint);
  }, []);

  useEffect(() => {
    setSectionState(previous =>
      reconcileConfigurationSectionNavigation(previous, location, activeSectionIds, topLevelSectionIds),
    );
    setMobileMenuOpen(false);
    setOpenFlyoutId(null);
  }, [location, activeSectionIds, topLevelSectionIds]);

  useEffect(() => {
    saveConfigurationMenuOpen(desktopMenuOpen);
    setOpenFlyoutId(null);
  }, [desktopMenuOpen]);

  const toggleSection = (sectionId: string) => {
    setSectionState(previous => toggleConfigurationSection(previous, sectionId, topLevelSectionIds));
  };
  const isSectionOpen = (section: NavSection) => !!sectionState.openSections[section.id];
  const isSectionActive = (section: NavSection) => isPathInSection(activeItemPath, section);
  const closeNavigation = () => {
    setMobileMenuOpen(false);
    setOpenFlyoutId(null);
  };

  const renderNavItem = (item: NavItem, nested = false, flyout = false) => {
    const Icon = item.icon;
    const isActive = activeItemPath === item.path;
    return (
      <Link
        key={item.path}
        href={item.path}
        data-testid={item.testId}
        aria-current={isActive ? "page" : undefined}
        onClick={closeNavigation}
        className={cn(
          "flex min-h-10 w-full items-start rounded-md px-3 py-2 text-left text-sm font-medium transition-colors motion-reduce:transition-none",
          isActive
            ? nested || flyout
              ? "bg-muted text-foreground"
              : "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
          nested && "text-sm",
        )}
      >
        <Icon className="mr-2 mt-0.5 h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 break-words">{item.label}</span>
      </Link>
    );
  };

  const renderSubsection = (subsection: NavSection) => {
    const isActive = isPathInSection(activeItemPath, subsection);
    const isOpen = isSectionOpen(subsection);
    const Icon = subsection.icon;
    return (
      <Collapsible key={subsection.id} open={isOpen} onOpenChange={() => toggleSection(subsection.id)}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "h-auto min-h-10 w-full items-start justify-start whitespace-normal py-2 text-left text-sm",
              isActive && "bg-muted text-foreground",
            )}
            data-testid={`nav-config-${subsection.id}`}
          >
            <Icon className="mr-2 mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{subsection.title}</span>
            <ChevronDown className={cn("ml-2 mt-0.5 h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none", isOpen && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="ml-4 mt-1 space-y-1">
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
      <Collapsible key={section.id} open={isOpen} onOpenChange={() => toggleSection(section.id)}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant={isActive ? "default" : "ghost"}
            className="h-auto min-h-10 w-full items-start justify-start whitespace-normal py-2 text-left"
            data-testid={getSectionTestId(section)}
          >
            <Icon className="mr-2 mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{getSectionDisplayTitle(section)}</span>
            <ChevronDown className={cn("ml-2 mt-0.5 h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none", isOpen && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="ml-4 mt-1 space-y-1">
          <SectionBody section={section} renderItem={item => renderNavItem(item, true)} renderSubsection={renderSubsection} />
        </CollapsibleContent>
      </Collapsible>
    );
  };

  const renderRailSection = (section: NavSection) => {
    const Icon = getSectionIcon(section);
    const isActive = isSectionActive(section);
    return (
      <Popover
        key={section.id}
        open={openFlyoutId === section.id}
        onOpenChange={open => setOpenFlyoutId(open ? section.id : null)}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={getSectionDisplayTitle(section)}
                aria-haspopup="dialog"
                aria-expanded={openFlyoutId === section.id}
                data-testid={`nav-config-rail-${section.id}`}
                className={cn(
                  "relative h-10 w-10 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
                  isActive && "bg-muted text-foreground",
                  isActive && "before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-r before:bg-primary",
                )}
              >
                <Icon className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipPortal><TooltipContent side="right" className="motion-reduce:animate-none">{getSectionDisplayTitle(section)}</TooltipContent></TooltipPortal>
        </Tooltip>
        <PopoverContent
          id={`configuration-flyout-${section.id}`}
          data-testid={`configuration-flyout-${section.id}`}
          side="right"
          align="start"
          aria-label={getSectionDisplayTitle(section)}
          className="flex max-h-[var(--radix-popover-content-available-height)] w-72 max-w-[calc(100vw-5rem)] flex-col p-2 motion-reduce:animate-none"
          collisionPadding={8}
          onEscapeKeyDown={() => setOpenFlyoutId(null)}
        >
          <div className="px-2 pb-2 pt-1">
            <p className="text-sm font-semibold">{getSectionDisplayTitle(section)}</p>
          </div>
          <div className="min-h-0 max-h-[32rem] space-y-1 overflow-y-auto pr-1">
            <SectionBody
              section={section}
              renderItem={item => renderNavItem(item, false, true)}
              renderSubsection={subsection => (
                <div key={subsection.id} className="pt-2">
                  <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {subsection.title}
                  </p>
                  <div className="space-y-1">{subsection.items.map(item => renderNavItem(item, true, true))}</div>
                </div>
              )}
            />
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div ref={layoutRef} className="relative flex min-h-[100dvh] min-w-0 bg-gray-50 dark:bg-gray-900 md:min-h-[calc(100dvh-var(--configuration-top,0px))]">
        {mobileMenuOpen && <button type="button" className="fixed inset-0 z-30 bg-black/50 md:hidden" aria-label="Close configuration menu" onClick={() => setMobileMenuOpen(false)} />}
        <aside
          id="configuration-menu"
          className={cn(
            "z-40 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 md:sticky md:top-[var(--configuration-top,0px)] md:flex md:h-[calc(100dvh-var(--configuration-top,0px))] md:transition-[width] md:duration-200 motion-reduce:md:transition-none",
            desktopMenuOpen ? "md:w-64" : "md:w-14",
            mobileMenuOpen ? "fixed inset-y-0 left-0 flex w-72" : "hidden",
          )}
          aria-label="Configuration menu"
        >
          {isDesktop && !desktopMenuOpen ? (
            <div className="flex h-full min-h-0 flex-col items-center gap-2 py-3">
              <nav data-testid="configuration-nav-scroll" className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto [&>button]:shrink-0" aria-label="Configuration sections">
                {accessibleSections.map(renderRailSection)}
              </nav>
              <div className="shrink-0 border-t pt-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button type="button" variant="ghost" size="icon" aria-label="Expand configuration menu" aria-controls="configuration-menu" aria-expanded={false} onClick={() => setDesktopMenuOpen(true)} data-testid="button-configuration-menu-desktop">
                      <PanelLeftOpen className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Expand menu</TooltipContent>
                </Tooltip>
              </div>
            </div>
          ) : (
            <>
              <div className="flex shrink-0 justify-end px-3 pb-2 pt-3 md:hidden">
                <Button type="button" variant="ghost" size="icon" className="md:hidden" aria-label="Close configuration menu" aria-controls="configuration-menu" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(false)}><X className="h-5 w-5" /></Button>
              </div>
              <nav id="configuration-nav-scroll" data-testid="configuration-nav-scroll" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4" aria-label="Configuration sections">
                {accessibleSections.map(renderSection)}
              </nav>
              <div className="hidden shrink-0 border-t p-2 md:block">
                <Button type="button" variant="ghost" className="w-full justify-start text-muted-foreground" aria-label="Collapse configuration menu" aria-controls="configuration-menu" aria-expanded onClick={() => setDesktopMenuOpen(false)} data-testid="button-configuration-menu-desktop">
                  <PanelLeftClose className="mr-2 h-4 w-4" />
                  <span>Collapse menu</span>
                </Button>
              </div>
            </>
          )}
        </aside>
        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <div className="mx-auto max-w-7xl">
            <div className="mb-4 md:hidden">
              <Button type="button" variant="outline" size="sm" aria-label={mobileMenuOpen ? "Hide configuration menu" : "Show configuration menu"} aria-controls="configuration-menu" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(open => !open)} data-testid="button-configuration-menu-mobile">
                <Menu className="mr-2 h-4 w-4" />
                Configuration menu
              </Button>
            </div>
            {children}
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}

function SectionBody({ section, renderItem, renderSubsection }: { section: NavSection; renderItem: (item: NavItem) => React.ReactNode; renderSubsection: (section: NavSection) => React.ReactNode }) {
  return (
    <>
      {section.itemsStatus === "loading" && <p className="px-3 py-2 text-sm text-muted-foreground" data-testid={`text-${section.id}-loading`}>Loading…</p>}
      {section.itemsStatus === "error" && <p className="px-3 py-2 text-sm text-destructive" data-testid={`text-${section.id}-error`}>Couldn't load these</p>}
      {section.items.map(renderItem)}
      {section.subsections?.map(renderSubsection)}
    </>
  );
}

function getSectionDisplayTitle(section: NavSection): string {
  return section.id === "theme" ? "Theme" : section.title;
}

function getSectionTestId(section: NavSection): string {
  const testIdMap: Record<string, string> = { "user-management": "nav-config-user-management", contact: "nav-config-contact", employers: "nav-config-employers", trust: "nav-config-trust", theme: "nav-config-theme", system: "nav-config-system", ledger: "nav-config-ledger" };
  return testIdMap[section.id] || `nav-config-${section.id}`;
}

function getSectionIcon(section: NavSection) {
  const iconMap: Record<string, typeof BookOpen> = { ledger: BookOpen, theme: Palette };
  return iconMap[section.id] || section.icon;
}