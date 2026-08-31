import { ReactNode } from "react";
import { Cloud } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useWcTabAccess } from "@/hooks/useTabAccess";

interface WcLayoutProps {
  activeTab: string;
  children: ReactNode;
}

/**
 * Shell shared by the web client browser's tabs — the cached entries and the
 * call stats.
 *
 * The tab strip comes from the shared tab registry rather than being drawn
 * here, so access to each tab is decided in the one place every other tabbed
 * page's access is decided, and a tab nobody can reach is never rendered.
 */
export function WcLayout({ activeTab, children }: WcLayoutProps) {
  const { tabs } = useWcTabAccess();

  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2"
          data-testid="text-page-title"
        >
          <Cloud className="h-6 w-6" />
          Web Client
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
              data-testid={`button-wc-tab-${tab.id}`}
            >
              {tab.label}
            </Button>
          ) : (
            <Link key={tab.id} href={tab.href}>
              <Button variant="outline" size="sm" data-testid={`button-wc-tab-${tab.id}`}>
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
