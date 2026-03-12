import { createContext, useContext, ReactNode } from "react";
import { FileSpreadsheet, ArrowLeft, Calendar, Users } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatYmd } from "@shared/utils/date";
import type { EdlsSheet } from "@shared/schema";
import { useEdlsSheetTabAccess } from "@/hooks/useTabAccess";
import { usePageTitle } from "@/contexts/PageTitleContext";

interface EdlsSheetWithRelations extends EdlsSheet {
  employer?: { id: string; name: string };
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

  const { tabs: mainTabs } = useEdlsSheetTabAccess(id || "");

  usePageTitle(sheet?.title);

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
          <div className="flex items-start gap-4">
            <Link href="/edls/sheets">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-foreground" data-testid="title-sheet">
                {sheet.title}
              </h1>
              <div className="flex items-center gap-4 mt-1 text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {formatYmd(sheet.ymd, 'long')}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="h-4 w-4" />
                  {sheet.workerCount} workers
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2 py-3">
            {mainTabs.map((tab) => {
              const isActive = tab.id === activeTab;
              return isActive ? (
                <Button
                  key={tab.id}
                  variant="default"
                  size="sm"
                  data-testid={`button-sheet-${tab.id}`}
                >
                  {tab.label}
                </Button>
              ) : (
                <Link key={tab.id} href={tab.href}>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid={`button-sheet-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </EdlsSheetLayoutContext.Provider>
  );
}
