import { ReactNode } from "react";
import { History } from "lucide-react";
import { useRecordMetadataTabAccess } from "@/hooks/useTabAccess";
import { EntityTabNavigation } from "@/components/shared/EntityTabNavigation";

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

      <EntityTabNavigation
        tabs={tabs}
        activeTab={activeTab}
        testIdPrefix="button-record-metadata-tab-"
      />

      {children}
    </div>
  );
}
