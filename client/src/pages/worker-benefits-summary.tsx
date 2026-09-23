import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import {
  BaoWorkerCoverageView,
  type BaoCoverageSummary,
} from "@/plugins/dashboard/bao-worker-coverage/BaoWorkerCoverage";
import { useDashboardContent } from "@/plugins/dashboard/useDashboardContent";
import { Skeleton } from "@/components/ui/skeleton";

function SummaryContent() {
  const { worker } = useWorkerLayout();
  const { data, isLoading, isError } = useDashboardContent<BaoCoverageSummary>(
    "bao-worker-coverage",
    { action: "staff-worker", params: { workerId: worker.id } },
  );

  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (isError || !data || data.state !== "available") {
    return <div role="alert" className="rounded-lg border p-6">Coverage information is unavailable. Please try again later.</div>;
  }
  return <BaoWorkerCoverageView data={data} />;
}

export default function WorkerBenefitsSummary() {
  return (
    <WorkerLayout activeTab="benefits-summary">
      <SummaryContent />
    </WorkerLayout>
  );
}