import TrustProviderLayout, { useTrustProviderLayout } from "@/components/layouts/TrustProviderLayout";
import { EntityFileManager } from "@/components/entity-files/EntityFileManager";

function TrustProviderFilesContent() {
  const { provider } = useTrustProviderLayout();

  if (!provider) {
    return null;
  }

  return <EntityFileManager context="trust_provider" entityId={provider.id} />;
}

export default function TrustProviderFilesPage() {
  return (
    <TrustProviderLayout activeTab="files">
      <TrustProviderFilesContent />
    </TrustProviderLayout>
  );
}
