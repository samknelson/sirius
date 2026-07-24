import { useParams } from "wouter";
import TrustProviderLayout from "@/components/layouts/TrustProviderLayout";
import { PremiumFilesView } from "@/pages/config/sitespecific/bao/premium-files";

export default function TrustProviderPremiumFilesPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <TrustProviderLayout activeTab="premium-files">
      {id && <PremiumFilesView providerId={id} />}
    </TrustProviderLayout>
  );
}
