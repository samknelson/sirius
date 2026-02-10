import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Globe, Loader2, CheckCircle2, Info, Search } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ScrapeStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

interface ScrapeResult {
  rows: Array<{
    handler: string;
    nid: string;
    title: string;
    bpsId: string;
    bargainingUnit: string;
    postDate: string;
    name: string;
  }>;
  totalScraped: number;
  afterDedup: number;
  withBpsId: number;
  pagesScraped: number;
}

export function ScrapeStep({ wizardId, wizardType, data, onDataChange }: ScrapeStepProps) {
  const { toast } = useToast();
  const scrapedData = data?.scrapedData;
  const scrapeStats = data?.scrapeStats;
  const [singleBpsId, setSingleBpsId] = useState("");

  const scrapeMutation = useMutation({
    mutationFn: async (bpsId?: string) => {
      const body: any = { wizardId };
      if (bpsId && bpsId.trim()) {
        body.singleBpsId = bpsId.trim();
      }
      return await apiRequest("POST", "/api/btu-scraper-import/scrape", body);
    },
    onSuccess: (result: ScrapeResult) => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      toast({
        title: "Scraping Complete",
        description: `Found ${result.withBpsId} rows with BPS ID across ${result.pagesScraped} pages.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Scraping Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Scrape External Site
          </CardTitle>
          <CardDescription>
            Scrape signed card check records from the external BTU site
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!scrapedData && !scrapeMutation.isPending && (
            <div className="space-y-6">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Scraping Options</AlertTitle>
                <AlertDescription>
                  You can scrape all signed card checks, or search for a single worker by BPS Employee ID for testing purposes.
                </AlertDescription>
              </Alert>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="singleBpsId">Single BPS Employee ID (optional)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="singleBpsId"
                      placeholder="e.g. 12345"
                      value={singleBpsId}
                      onChange={(e) => setSingleBpsId(e.target.value)}
                      data-testid="input-single-bps-id"
                    />
                    <Button
                      onClick={() => scrapeMutation.mutate(singleBpsId)}
                      disabled={!singleBpsId.trim()}
                      className="gap-2 shrink-0"
                      data-testid="button-scrape-single"
                    >
                      <Search className="h-4 w-4" />
                      Search Single
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Enter a BPS ID to search for just that one worker. The scraper will stop as soon as it finds a match.
                  </p>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">or</span>
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center p-8 space-y-4">
                  <Globe className="h-12 w-12 text-muted-foreground" />
                  <p className="text-muted-foreground" data-testid="text-scrape-prompt">
                    Scrape all signed card checks from the external site
                  </p>
                  <Button
                    onClick={() => scrapeMutation.mutate(undefined)}
                    size="lg"
                    className="gap-2"
                    data-testid="button-start-scrape"
                  >
                    <Globe className="h-4 w-4" />
                    Scrape All
                  </Button>
                </div>
              </div>
            </div>
          )}

          {scrapeMutation.isPending && (
            <div className="flex flex-col items-center justify-center p-12 space-y-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-muted-foreground" data-testid="text-scraping-progress">
                Scraping the external site... This may take several minutes.
              </p>
              <p className="text-sm text-muted-foreground">
                Logging in, navigating pages, and extracting data.
              </p>
            </div>
          )}

          {scrapedData && scrapeStats && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
                <span className="text-lg font-medium" data-testid="text-scrape-complete">Scraping Complete</span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 border rounded-lg text-center">
                  <div className="text-2xl font-bold" data-testid="text-pages-scraped">{scrapeStats.pagesScraped}</div>
                  <div className="text-sm text-muted-foreground">Pages Scraped</div>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <div className="text-2xl font-bold" data-testid="text-total-scraped">{scrapeStats.totalScraped}</div>
                  <div className="text-sm text-muted-foreground">Total Rows</div>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <div className="text-2xl font-bold" data-testid="text-after-dedup">{scrapeStats.afterDedup}</div>
                  <div className="text-sm text-muted-foreground">After Dedup</div>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <div className="text-2xl font-bold text-green-600" data-testid="text-with-bps-id">{scrapeStats.withBpsId}</div>
                  <div className="text-sm text-muted-foreground">With BPS ID</div>
                </div>
              </div>

              {scrapedData.length > 0 && (
                <ScrollArea className="h-64 border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>NID</TableHead>
                        <TableHead>BPS ID</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Post Date</TableHead>
                        <TableHead>Bargaining Unit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {scrapedData.slice(0, 100).map((row: any, idx: number) => (
                        <TableRow key={idx} data-testid={`row-scraped-${idx}`}>
                          <TableCell className="font-mono text-sm">{row.nid}</TableCell>
                          <TableCell className="font-mono text-sm">{row.bpsId}</TableCell>
                          <TableCell>{row.name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{row.postDate}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{row.bargainingUnit}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}

              {scrapedData.length > 100 && (
                <p className="text-sm text-muted-foreground text-center">
                  Showing first 100 of {scrapedData.length} rows
                </p>
              )}

              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => scrapeMutation.mutate(undefined)}
                  disabled={scrapeMutation.isPending}
                  data-testid="button-rescrape"
                >
                  {scrapeMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Globe className="h-4 w-4 mr-2" />
                  )}
                  Re-Scrape
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
