import TrustProviderLayout, { useTrustProviderLayout } from "@/components/layouts/TrustProviderLayout";
import CaseListPanel from "@/components/sitespecific/bao/CaseListPanel";
function Content() { const { provider } = useTrustProviderLayout(); return provider ? <CaseListPanel entityType="trust_provider" entityId={provider.id} /> : null; }
export default function TrustProviderCasesPage() { return <TrustProviderLayout activeTab="cases"><Content /></TrustProviderLayout>; }