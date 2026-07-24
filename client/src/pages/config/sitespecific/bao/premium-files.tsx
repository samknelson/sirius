import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus, Download, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  BaoPremiumFileWithNames,
  BaoPremiumFileRowWithNames,
} from "@shared/schema/sitespecific/bao/schema";

interface ProviderOption {
  id: string;
  name: string;
  data?: { ledgerAccountId?: string } | null;
}

interface AccountOption {
  id: string;
  name: string;
}

const ALL = "__all__";

function formatMonth(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const m = ymd.slice(0, 10).match(/^(\d{4})-(\d{2})/);
  if (!m) return ymd;
  return `${parseInt(m[2])}/${m[1]}`;
}

function formatAmount(amount: string | null | undefined): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount ?? "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatTimestamp(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

interface PremiumFilesViewProps {
  /** When set, the view is locked to a single provider (provider page tab). */
  providerId?: string;
}

export function PremiumFilesView({ providerId }: PremiumFilesViewProps) {
  const { toast } = useToast();

  const [filterProviderId, setFilterProviderId] = useState<string>(ALL);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [genProviderId, setGenProviderId] = useState<string>("");
  const [viewing, setViewing] = useState<BaoPremiumFileWithNames | null>(null);

  const fixedProviderId = providerId;
  const effectiveFilterId =
    fixedProviderId ?? (filterProviderId !== ALL ? filterProviderId : undefined);
  const effectiveGenProviderId = fixedProviderId ?? genProviderId;

  const { data: providers = [] } = useQuery<ProviderOption[]>({
    queryKey: ["/api/trust/providers"],
  });

  const { data: accounts = [] } = useQuery<AccountOption[]>({
    queryKey: ["/api/ledger/accounts"],
  });

  const { data: files = [], isLoading } = useQuery<BaoPremiumFileWithNames[]>({
    queryKey: ["/api/sitespecific/bao/premium/files", effectiveFilterId ?? ALL],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (effectiveFilterId) params.set("providerId", effectiveFilterId);
      const response = await fetch(
        `/api/sitespecific/bao/premium/files?${params.toString()}`,
      );
      if (!response.ok) throw new Error("Failed to load premium files");
      return response.json();
    },
  });

  const { data: rows = [], isLoading: rowsLoading } = useQuery<
    BaoPremiumFileRowWithNames[]
  >({
    queryKey: ["/api/sitespecific/bao/premium/files", viewing?.id, "rows"],
    queryFn: async () => {
      const response = await fetch(
        `/api/sitespecific/bao/premium/files/${viewing!.id}/rows`,
      );
      if (!response.ok) throw new Error("Failed to load premium file rows");
      return response.json();
    },
    enabled: !!viewing,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(
        "POST",
        "/api/sitespecific/bao/premium/files/generate",
        { providerId: effectiveGenProviderId },
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/sitespecific/bao/premium/files"],
      });
      toast({ title: "Premium file generated" });
      setGenerateOpen(false);
      setGenProviderId("");
    },
    onError: (error: any) => {
      toast({
        title: "Failed to generate premium file",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const genProvider = providers.find((p) => p.id === effectiveGenProviderId);
  const genLinkedAccountId = genProvider?.data?.ledgerAccountId;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-2xl font-semibold"
            data-testid="text-premium-files-title"
          >
            Premium Files
          </h1>
          <p className="text-muted-foreground text-sm">
            Generated provider premium files. Generating a file snapshots every
            unpaid premium month for the provider and posts offsetting payment
            entries so those months cannot be paid twice.
          </p>
          {fixedProviderId && (
            <p className="text-sm mt-1">
              <Link
                href="/config/sitespecific/bao/premium-files"
                className="text-primary hover:underline"
                data-testid="link-all-premium-files"
              >
                View all premium files
              </Link>
            </p>
          )}
        </div>
        <Button
          onClick={() => setGenerateOpen(true)}
          data-testid="button-generate-premium-file"
        >
          <Plus size={16} className="mr-2" />
          Generate File
        </Button>
      </div>

      {!fixedProviderId && (
        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <div className="space-y-1">
              <Label>Provider</Label>
              <Select value={filterProviderId} onValueChange={setFilterProviderId}>
                <SelectTrigger className="w-64" data-testid="select-filter-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All providers</SelectItem>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-muted-foreground" />
            </div>
          ) : files.length === 0 ? (
            <div
              className="text-center py-12 text-muted-foreground"
              data-testid="text-no-premium-files"
            >
              No premium files found.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Generated</TableHead>
                  {!fixedProviderId && <TableHead>Provider</TableHead>}
                  <TableHead>Account</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((f) => (
                  <TableRow key={f.id} data-testid={`row-premium-file-${f.id}`}>
                    <TableCell data-testid={`text-file-generated-${f.id}`}>
                      {formatTimestamp(f.generatedAt as any)}
                    </TableCell>
                    {!fixedProviderId && (
                      <TableCell data-testid={`text-file-provider-${f.id}`}>
                        {f.providerName ? (
                          <Link
                            href={`/trust/provider/${f.providerId}/premium-files`}
                            className="text-primary hover:underline"
                            data-testid={`link-file-provider-${f.id}`}
                          >
                            {f.providerName}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    )}
                    <TableCell data-testid={`text-file-account-${f.id}`}>
                      {f.accountName ?? "—"}
                    </TableCell>
                    <TableCell data-testid={`text-file-rows-${f.id}`}>
                      {f.rowCount}
                    </TableCell>
                    <TableCell data-testid={`text-file-total-${f.id}`}>
                      ${formatAmount(f.totalAmount)}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setViewing(f)}
                        data-testid={`button-view-file-${f.id}`}
                      >
                        <Eye size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        asChild
                        data-testid={`button-download-file-${f.id}`}
                      >
                        <a
                          href={`/api/sitespecific/bao/premium/files/${f.id}/csv`}
                          download
                        >
                          <Download size={16} />
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={generateOpen}
        onOpenChange={(open) => {
          setGenerateOpen(open);
          if (!open) {
            setGenProviderId("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Premium File</DialogTitle>
            <DialogDescription>
              Snapshots every unpaid premium month for the provider on the chosen
              ledger account and marks them paid with offsetting entries. This
              cannot double-pay a month that is already in a file.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!fixedProviderId && (
              <div className="space-y-1">
                <Label>Provider</Label>
                <Select value={genProviderId} onValueChange={setGenProviderId}>
                  <SelectTrigger data-testid="select-generate-provider">
                    <SelectValue placeholder="Select a provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {effectiveGenProviderId && (
              <div className="space-y-1">
                <Label>Ledger Account</Label>
                {genLinkedAccountId ? (
                  <p className="text-sm" data-testid="text-generate-account">
                    {accounts.find((a) => a.id === genLinkedAccountId)?.name ??
                      genLinkedAccountId}
                  </p>
                ) : (
                  <p
                    className="text-sm text-destructive"
                    data-testid="text-generate-account-missing"
                  >
                    This provider has no linked ledger account. Set one on the
                    provider's Edit tab first.
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setGenerateOpen(false)}
              data-testid="button-cancel-generate"
            >
              Cancel
            </Button>
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={
                !effectiveGenProviderId ||
                !genLinkedAccountId ||
                generateMutation.isPending
              }
              data-testid="button-confirm-generate"
            >
              {generateMutation.isPending && (
                <Loader2 size={16} className="mr-2 animate-spin" />
              )}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Premium File Detail</DialogTitle>
            <DialogDescription>
              {viewing
                ? `${viewing.providerName ?? "Provider"} — generated ${formatTimestamp(viewing.generatedAt as any)} — total $${formatAmount(viewing.totalAmount)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {rowsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-muted-foreground" />
              </div>
            ) : rows.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No rows in this file.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Worker</TableHead>
                    <TableHead>Benefit</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} data-testid={`row-file-row-${r.id}`}>
                      <TableCell>{formatMonth(r.statementYmd)}</TableCell>
                      <TableCell>{r.workerName ?? "—"}</TableCell>
                      <TableCell>{r.benefitName ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        ${formatAmount(r.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter>
            {viewing && (
              <Button asChild variant="outline" data-testid="button-download-viewing">
                <a
                  href={`/api/sitespecific/bao/premium/files/${viewing.id}/csv`}
                  download
                >
                  <Download size={16} className="mr-2" />
                  Download CSV
                </a>
              </Button>
            )}
            <Button onClick={() => setViewing(null)} data-testid="button-close-view">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function BaoPremiumFilesPage() {
  usePageTitle("Premium Files");
  return <PremiumFilesView />;
}
