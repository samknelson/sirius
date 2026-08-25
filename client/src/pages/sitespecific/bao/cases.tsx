import { PageHeader } from "@/components/layout/PageHeader";
import CaseListPanel from "@/components/sitespecific/bao/CaseListPanel";
import { BriefcaseBusiness } from "lucide-react";

export default function BaoCasesPage() {
  return (
    <div>
      <PageHeader title="Cases" icon={<BriefcaseBusiness size={16} />} />
      <main className="mx-auto max-w-7xl p-6"><CaseListPanel /></main>
    </div>
  );
}