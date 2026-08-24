import TrustProviderLayout, { useTrustProviderLayout } from "@/components/layouts/TrustProviderLayout";
import NotesPanel from "@/components/notes/NotesPanel";

function TrustProviderNotesContent() {
  const { provider } = useTrustProviderLayout();

  if (!provider) {
    return null;
  }

  return <NotesPanel entityType="trust_provider" entityId={provider.id} />;
}

export default function TrustProviderNotesPage() {
  return (
    <TrustProviderLayout activeTab="notes">
      <TrustProviderNotesContent />
    </TrustProviderLayout>
  );
}
