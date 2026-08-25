import { EmployerLayout, useEmployerLayout } from "@/components/layouts/EmployerLayout";
import CaseListPanel from "@/components/sitespecific/bao/CaseListPanel";
function Content() { const { employer } = useEmployerLayout(); return <CaseListPanel entityType="employer" entityId={employer.id} />; }
export default function EmployerCasesPage() { return <EmployerLayout activeTab="cases"><Content /></EmployerLayout>; }