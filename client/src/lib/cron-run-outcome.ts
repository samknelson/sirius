export function cronRunOutcome(run: { status: string; error?: string | null; output?: string | null }) {
  const status = run.status;
  if (status !== "success" && status !== "error" && status !== "skipped" && status !== "interrupted") return null;
  let message: string | undefined;
  try {
    const output = JSON.parse(run.output || "null");
    if (typeof output?.message === "string") message = output.message;
  } catch { /* Legacy text output is not a structured reason. */ }
  return {
    title: { success: "Job Completed", error: "Job Failed", skipped: "Job Skipped", interrupted: "Job Interrupted" }[status],
    description: run.error || message || (run.status === "success"
      ? "The job has completed successfully. See results below."
      : "The job did not complete. See details below."),
    variant: run.status === "error" || run.status === "interrupted" ? "destructive" as const : "default" as const,
  };
}
