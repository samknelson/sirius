import { createContext, useContext, useMemo, ReactNode } from "react";
import { FileSpreadsheet, Users } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { EdlsSheet } from "@shared/schema";
import { useEdlsSheetTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { RecordTitleBar } from "@/components/shared/RecordTitleBar";
import { EntityTabNavigation } from "@/components/shared/EntityTabNavigation";

interface EdlsSheetWithRelations extends EdlsSheet {
  employer?: { id: string; name: string };
}

function sheetHeading(sheet: EdlsSheet): string {
  // ymd is a date-only string; rearrange its parts without timezone conversion.
  const [year, month, day] = sheet.ymd.split("-");
  const title = sheet.title.trim();
  const number = /^#?\s*(\d+)$/.exec(title);
  return `${day}-${month}-${year} - ${number ? `#${number[1]}` : title}`;
}

interface EdlsSheetLayoutContextValue {
  sheet: EdlsSheetWithRelations;
  isLoading: boolean;
  isError: boolean;
}

const EdlsSheetLayoutContext = createContext<EdlsSheetLayoutContextValue | null>(null);

export function useEdlsSheetLayout() {
  const context = useContext(EdlsSheetLayoutContext);
  if (!context) {
    throw new Error("useEdlsSheetLayout must be used within EdlsSheetLayout");
  }
  return context;
}

interface EdlsSheetLayoutProps {
  activeTab: string;
  children: ReactNode;
}

export function EdlsSheetLayout({ activeTab, children }: EdlsSheetLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: sheet, isLoading: sheetLoading, error: sheetError } = useQuery<EdlsSheetWithRelations>({
    queryKey: ["/api/edls/sheets", id],
    queryFn: async () => {
      const response = await fetch(`/api/edls/sheets/${id}`);
      if (!response.ok) {
        throw new Error("Sheet not found");
      }
      return response.json();
    },
  });

  const { tabs: mainTabs, getActiveRoot } = useEdlsSheetTabAccess(id || "");

  const activeRoot = useMemo(() => getActiveRoot(activeTab), [activeTab, getActiveRoot]);
  const subTabs = activeRoot?.children;

  const heading = sheet ? sheetHeading(sheet) : undefined;
  usePageTitle(heading);

  const isLoading = sheetLoading;
  const isError = !!sheetError;

  if (sheetError) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <FileSpreadsheet className="text-muted-foreground" size={32} />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">Sheet Not Found</h3>
            <p className="text-muted-foreground text-center">
              The sheet you're looking for doesn't exist or has been removed.
            </p>
            <Link href="/edls/sheets">
              <Button className="mt-4" data-testid="button-return-to-sheets">
                Return to Sheets
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !sheet) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Skeleton className="h-16 w-16 rounded-full mb-4" />
            <Skeleton className="h-6 w-48 mb-2" />
            <Skeleton className="h-4 w-64" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <EdlsSheetLayoutContext.Provider value={{ sheet, isLoading, isError }}>
      <section className="bg-background border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <RecordTitleBar
            variant="compact"
            title={heading}
            titleTestId="title-sheet"
            subtitle={
              <div className="flex items-center mt-1 text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Users className="h-4 w-4" />
                  {sheet.workerCount} workers
                </span>
              </div>
            }
            backLink={{ href: "/edls/sheets", label: "Back to Sheets" }}
            recordId={sheet.id}
          />
        </div>
      </section>

       <EntityTabNavigation
         tabs={mainTabs}
         activeTab={activeTab}
         activeRootId={activeRoot?.id}
         subTabs={subTabs}
         testIdPrefix="button-sheet-"
       />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </EdlsSheetLayoutContext.Provider>
  );
}
