import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Building2, Calendar, ExternalLink, HardHat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatYmd } from "@shared/utils/date";
import type { DispatchJobForeWithWorker, DispatchJobForeWithJob } from "../../server/storage/dispatch/fore";

export function Forepersons({ job }: { job: { id: string } }) {
  const { data: forepersons = [] } = useQuery<DispatchJobForeWithWorker[]>({ queryKey: ["/api/dispatch-jobs", job.id, "fore"] });
  return <div>
    <h3 className="text-sm font-medium text-muted-foreground mb-2">Forepersons</h3>
    {forepersons.length === 0
      ? <p className="text-muted-foreground text-sm" data-testid="text-no-forepersons">No Forepersons designated for this job.</p>
      : <div className="flex flex-wrap gap-2" data-testid="forepersons-list">{forepersons.map(fore => <Badge key={fore.id} variant="secondary" className="gap-1" data-testid={`badge-foreperson-${fore.id}`}><HardHat className="h-3 w-3" />{fore.worker?.contact?.displayName || "Unknown Worker"}</Badge>)}</div>}
  </div>;
}
export function ForepersonJobsSection({ workerId }: { workerId: string }) {
  const { data: foreJobs, isLoading } = useQuery<DispatchJobForeWithJob[]>({
    queryKey: ["/api/workers", workerId, "dispatch-fore"],
    queryFn: async () => {
      const response = await fetch(`/api/workers/${workerId}/dispatch-fore`);
      if (!response.ok) throw new Error("Failed to fetch foreperson jobs");
      return response.json();
    },
  });
  if (isLoading || !foreJobs?.length) return null;
  return <Card>
    <CardHeader>
      <div className="flex items-center gap-2"><HardHat className="h-5 w-5" /><CardTitle>Foreperson Jobs</CardTitle></div>
      <CardDescription>Jobs where this worker is designated as a Foreperson.</CardDescription>
    </CardHeader>
    <CardContent><div className="space-y-2" data-testid="list-foreperson-jobs">{foreJobs.map(fore => <div key={fore.id} className="border rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap" data-testid={`card-foreperson-job-${fore.id}`}>
      <div className="space-y-1">
        <p className="font-medium" data-testid={`text-fore-job-title-${fore.id}`}>{fore.job?.title || "Unknown Job"}</p>
        <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" /><span data-testid={`text-fore-employer-${fore.id}`}>{fore.job?.employer?.name || "Unknown Employer"}</span></span>
          {fore.job?.startYmd && <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /><span data-testid={`text-fore-job-start-${fore.id}`}>{formatYmd(fore.job.startYmd, "long")}</span></span>}
        </div>
      </div>
      <Link href={`/dispatch/job/${fore.jobId}`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline" data-testid={`link-fore-job-${fore.id}`}>View Job<ExternalLink className="h-3.5 w-3.5" /></Link>
    </div>)}</div></CardContent>
  </Card>;
}
