import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import CaseListPanel from "@/components/sitespecific/bao/CaseListPanel";
function Content() { const { worker } = useWorkerLayout(); return <CaseListPanel entityType="worker" entityId={worker.id} />; }
export default function WorkerCasesPage() { return <WorkerLayout activeTab="cases"><Content /></WorkerLayout>; }