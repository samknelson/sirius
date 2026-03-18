import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, RefreshCw, User, Phone, Mail, Globe, ExternalLink } from "lucide-react";
import { format } from "date-fns";

interface PoliticalOfficial {
  id: string;
  name: string;
  officeName: string;
  level: string;
  division: string | null;
  party: string | null;
  phones: string[] | null;
  emails: string[] | null;
  photoUrl: string | null;
  urls: string[] | null;
  channels: { type: string; id: string }[] | null;
  ocdDivisionId: string | null;
}

interface WorkerRep {
  id: string;
  workerId: string;
  officialId: string;
  address: string | null;
  lastLookedUpAt: string;
  createdAt: string;
  official: PoliticalOfficial;
}

interface LookupResult {
  normalizedAddress: string;
  representatives: WorkerRep[];
  count: number;
}

function getLevelColor(level: string): string {
  switch (level) {
    case "federal": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    case "state": return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
    case "local": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    default: return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
  }
}

function WorkerPoliticalProfileContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const [isLookupOpen, setIsLookupOpen] = useState(false);
  const [lookupAddress, setLookupAddress] = useState("");

  const { data: reps = [], isLoading } = useQuery<WorkerRep[]>({
    queryKey: ["/api/workers", worker.id, "political", "reps"],
  });

  const { data: primaryAddressData } = useQuery<{ address: string | null }>({
    queryKey: ["/api/workers", worker.id, "political", "primary-address"],
  });

  const lookupMutation = useMutation({
    mutationFn: async (address?: string) => {
      const res = await apiRequest("POST", `/api/workers/${worker.id}/political/lookup`, address ? { address } : {});
      return res.json() as Promise<LookupResult>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "political", "reps"] });
      setIsLookupOpen(false);
      setLookupAddress("");
      toast({
        title: "Representatives found",
        description: `Found ${data.count} representative(s) for ${data.normalizedAddress}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Lookup failed",
        description: error.message || "Failed to look up representatives",
        variant: "destructive",
      });
    },
  });

  const lastLookupDate = reps.length > 0
    ? format(new Date(reps[0].lastLookedUpAt), "MMM d, yyyy h:mm a")
    : null;
  const lookupAddress_ = reps.length > 0 ? reps[0].address : null;

  const federalReps = reps.filter(r => r.official.level === "federal");
  const stateReps = reps.filter(r => r.official.level === "state");
  const localReps = reps.filter(r => r.official.level === "local");
  const otherReps = reps.filter(r => !["federal", "state", "local"].includes(r.official.level));

  const renderOfficialRow = (rep: WorkerRep) => {
    const o = rep.official;
    return (
      <TableRow key={rep.id} data-testid={`row-rep-${rep.id}`}>
        <TableCell>
          <div className="flex items-center gap-3">
            {o.photoUrl ? (
              <img
                src={o.photoUrl}
                alt={o.name}
                className="w-10 h-10 rounded-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                <User className="w-5 h-5 text-muted-foreground" />
              </div>
            )}
            <div>
              <div className="font-medium" data-testid={`text-rep-name-${rep.id}`}>{o.name}</div>
              {o.party && <div className="text-sm text-muted-foreground">{o.party}</div>}
            </div>
          </div>
        </TableCell>
        <TableCell data-testid={`text-rep-office-${rep.id}`}>{o.officeName}</TableCell>
        <TableCell>
          <Badge className={getLevelColor(o.level)} data-testid={`badge-rep-level-${rep.id}`}>
            {o.level}
          </Badge>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">{o.division || "—"}</TableCell>
        <TableCell>
          <div className="flex gap-2">
            {o.phones && o.phones.length > 0 && (
              <a href={`tel:${o.phones[0]}`} title={o.phones[0]} data-testid={`link-rep-phone-${rep.id}`}>
                <Phone className="w-4 h-4 text-muted-foreground hover:text-foreground" />
              </a>
            )}
            {o.emails && o.emails.length > 0 && (
              <a href={`mailto:${o.emails[0]}`} title={o.emails[0]} data-testid={`link-rep-email-${rep.id}`}>
                <Mail className="w-4 h-4 text-muted-foreground hover:text-foreground" />
              </a>
            )}
            {o.urls && o.urls.length > 0 && (
              <a href={o.urls[0]} target="_blank" rel="noopener noreferrer" title="Website" data-testid={`link-rep-url-${rep.id}`}>
                <Globe className="w-4 h-4 text-muted-foreground hover:text-foreground" />
              </a>
            )}
          </div>
        </TableCell>
      </TableRow>
    );
  };

  const renderSection = (title: string, items: WorkerRep[]) => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{title}</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Office</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Division</TableHead>
              <TableHead>Contact</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(renderOfficialRow)}
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg" data-testid="text-political-title">Political Representatives</CardTitle>
          <div className="flex items-center gap-2">
            {primaryAddressData?.address && (
              <Button
                size="sm"
                onClick={() => lookupMutation.mutate(undefined)}
                disabled={lookupMutation.isPending}
                data-testid="button-use-primary-address"
              >
                {lookupMutation.isPending ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Looking up...</>
                ) : reps.length > 0 ? (
                  <><RefreshCw className="w-4 h-4 mr-2" /> Refresh from Primary Address</>
                ) : (
                  <><Search className="w-4 h-4 mr-2" /> Look Up from Primary Address</>
                )}
              </Button>
            )}
            <Dialog open={isLookupOpen} onOpenChange={(open) => {
              setIsLookupOpen(open);
              if (open && primaryAddressData?.address && !lookupAddress) {
                setLookupAddress(primaryAddressData.address);
              }
            }}>
              <DialogTrigger asChild>
                <Button
                  size="sm"
                  variant={primaryAddressData?.address ? "outline" : "default"}
                  data-testid="button-lookup-reps"
                >
                  {primaryAddressData?.address ? (
                    <><Search className="w-4 h-4 mr-2" /> Custom Address</>
                  ) : reps.length > 0 ? (
                    <><RefreshCw className="w-4 h-4 mr-2" /> Re-Lookup</>
                  ) : (
                    <><Search className="w-4 h-4 mr-2" /> Look Up Representatives</>
                  )}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Look Up Political Representatives</DialogTitle>
                  <DialogDescription>
                    Enter an address to find elected representatives at all levels of government.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="lookup-address">Address</Label>
                    <Input
                      id="lookup-address"
                      placeholder="e.g., 123 Main St, Boston, MA 02101"
                      value={lookupAddress}
                      onChange={(e) => setLookupAddress(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && lookupAddress.trim()) {
                          lookupMutation.mutate(lookupAddress.trim());
                        }
                      }}
                      data-testid="input-lookup-address"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setIsLookupOpen(false)}
                    data-testid="button-lookup-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => lookupMutation.mutate(lookupAddress.trim())}
                    disabled={!lookupAddress.trim() || lookupMutation.isPending}
                    data-testid="button-lookup-submit"
                  >
                    {lookupMutation.isPending ? "Looking up..." : "Look Up"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-6 w-1/2" />
            </div>
          ) : reps.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-reps">
              <User className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-lg font-medium">No political representatives on file</p>
              <p className="text-sm mt-1">Use the "Look Up Representatives" button to find this worker's elected officials based on their home address.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {lastLookupDate && (
                <div className="text-sm text-muted-foreground" data-testid="text-last-lookup">
                  Last looked up: {lastLookupDate}
                  {lookupAddress_ && <> &middot; Address: {lookupAddress_}</>}
                </div>
              )}
              {renderSection("Federal", federalReps)}
              {renderSection("State", stateReps)}
              {renderSection("Local", localReps)}
              {renderSection("Other", otherReps)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function WorkerPoliticalProfile() {
  return (
    <WorkerLayout activeTab="political">
      <WorkerPoliticalProfileContent />
    </WorkerLayout>
  );
}
