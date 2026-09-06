import { ReactNode } from "react";
import { History } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useRecordMetadataTabAccess } from "@/hooks/useTabAccess";

/**
 * The shell for the record history admin page.
 *
 * The tab strip comes from the shared tab registry rather than being drawn
 * here, so access to each tab is decided in the one place every other tabbed
 * page's access is decided, and a tab nobody can reach is never rendered.
 */
interface RecordHistoryLayoutProps {
  /** Which tab is the current page. Must be an id from the record history tab tree. */
  activeTab: string;
  children: ReactNode;
}

export function RecordHistoryLayout({ activeTab, children }: RecordHistoryLayoutProps) {
  const { tabs } = useRecordMetadataTabAccess();

  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2"
          data-testid="text-page-title"
        >
          <History className="h-6 w-6" />
          Record History
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
              data-testid={`button-record-metadata-tab-${tab.id}`}
            >
              {tab.label}
            </Button>
          ) : (
            <Link key={tab.id} href={tab.href}>
              <Button
                variant="outline"
                size="sm"
                data-testid={`button-record-metadata-tab-${tab.id}`}
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
