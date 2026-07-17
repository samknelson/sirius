import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  BaoCobraCaseLayout,
  useBaoCobraCaseLayout,
} from "@/components/layouts/BaoCobraCaseLayout";
import {
  CobraCaseForm,
  type CobraCaseFormValues,
} from "@/components/sitespecific/bao/CobraCaseForm";

function CaseEditForm() {
  const { cobraCase: c } = useBaoCobraCaseLayout();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const updateMutation = useMutation({
    mutationFn: async (values: CobraCaseFormValues) => {
      const { coveredPersonWorkerId, subscriberWorkerId, ...rest } = values;
      const response = await apiRequest(
        "PATCH",
        `/api/sitespecific/bao/cobra/cases/${c.id}`,
        rest,
      );
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/sitespecific/bao/cobra/cases"],
      });
      toast({ title: "COBRA case updated" });
      navigate(`/cobra/cases/${c.id}`);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update COBRA case",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <CobraCaseForm
      initial={{
        source: c.source,
        statusId: c.statusId,
        qualifyingEventId: c.qualifyingEventId,
        coveredPersonWorkerId: c.coveredPersonWorkerId,
        subscriberWorkerId: c.subscriberWorkerId,
        coveredPersonName: c.coveredPersonName,
        subscriberName: c.subscriberName,
        relationship: c.relationship,
        cobraEffectiveYmd: c.cobraEffectiveYmd,
        electionMadeYmd: c.electionMadeYmd,
        paymentStatus: c.paymentStatus,
        medicalBenefitLostId: c.medicalBenefitLostId,
        dentalBenefitLostId: c.dentalBenefitLostId,
      }}
      lockWorkers
      submitLabel="Save Changes"
      submitting={updateMutation.isPending}
      onSubmit={(values) => updateMutation.mutate(values)}
      onCancel={() => navigate(`/cobra/cases/${c.id}`)}
    />
  );
}

export default function BaoCobraCaseEdit() {
  return (
    <BaoCobraCaseLayout activeTab="edit">
      <CaseEditForm />
    </BaoCobraCaseLayout>
  );
}
