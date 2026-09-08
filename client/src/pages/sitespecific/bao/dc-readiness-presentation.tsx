export const DC_ATTESTATION_CONTROL_ORDER = [
  "dcFormOnFile",
  "signed",
  "doctorAddress",
  "doctorPhone",
  "dates",
  "restrictionsNoted",
] as const;

export function DcReadinessSavingStatus({ pending }: { pending: boolean }) {
  return (
    <span
      className="block min-h-5 text-muted-foreground"
      role="status"
      aria-live="polite"
      data-testid="text-dc-attestation-saving"
    >
      {pending ? "Saving checklist changes…" : <span aria-hidden="true">&nbsp;</span>}
    </span>
  );
}