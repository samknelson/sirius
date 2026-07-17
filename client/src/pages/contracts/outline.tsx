import { useParams } from "wouter";
import { ContractLayout } from "@/components/layouts/ContractLayout";
import { ContractOutline } from "@/components/contracts/ContractOutline";

export default function ContractOutlinePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <ContractLayout activeTab="outline">
      {id && <ContractOutline contractId={id} />}
    </ContractLayout>
  );
}
