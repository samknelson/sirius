import { ReactNode } from "react";
import { Cloud, Network, type LucideIcon } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useWcTabAccess, useWsTabAccess } from "@/hooks/useTabAccess";
import type { ResolvedTab } from "@/hooks/useTabAccess";

/**
 * The shells for the two web services pages — incoming (what other people call
 * on us) and outgoing (what we call on other people).
 *
 * One shell serves both because the only differences are the title, the icon
 * and which tab strip is asked for. The strip itself comes from the shared tab
 * registry rather than being drawn here, so access to each tab is decided in
 * the one place every other tabbed page's access is decided, and a tab nobody
 * can reach is never rendered.
 */

interface ShellProps {
  /** Which tab is the current page. Must be an id from that page's tab tree. */
  activeTab: string;
  children: ReactNode;
}

interface TabStripProps extends ShellProps {
  title: string;
  icon: LucideIcon;
  /** Prefix for the tab buttons' test ids, so the two strips stay tellable apart. */
  testIdPrefix: string;
  tabs: ResolvedTab[];
}

function WebServicesShell({
  activeTab,
  title,
  icon: Icon,
  testIdPrefix,
  tabs,
  children,
}: TabStripProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2"
          data-testid="text-page-title"
        >
          <Icon className="h-6 w-6" />
          {title}
        </h1>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return isActive ? (
            <Button
              key={tab.id}
              variant="default"
              size="sm"
              data-testid={`button-${testIdPrefix}-tab-${tab.id}`}
            >
              {tab.label}
            </Button>
          ) : (
            <Link key={tab.id} href={tab.href}>
              <Button
                variant="outline"
                size="sm"
                data-testid={`button-${testIdPrefix}-tab-${tab.id}`}
              >
                {tab.label}
              </Button>
            </Link>
          );
        })}
      </div>

      {children}
    </div>
  );
}

/** Calls other people make to us: the services, who may call them, and usage. */
export function WsLayout({ activeTab, children }: ShellProps) {
  const { tabs } = useWsTabAccess();
  return (
    <WebServicesShell
      activeTab={activeTab}
      title="Web Services - Incoming"
      icon={Network}
      testIdPrefix="ws"
      tabs={tabs}
    >
      {children}
    </WebServicesShell>
  );
}

/** Calls we make to other people: what we can ask, what we stored, how often. */
export function WcLayout({ activeTab, children }: ShellProps) {
  const { tabs } = useWcTabAccess();
  return (
    <WebServicesShell
      activeTab={activeTab}
      title="Web Services - Outgoing"
      icon={Cloud}
      testIdPrefix="wc"
      tabs={tabs}
    >
      {children}
    </WebServicesShell>
  );
}
