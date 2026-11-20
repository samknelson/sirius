import { eq } from "drizzle-orm";
import { denormSpan, denormIssue } from "@shared/schema";
import { getClient, runInTransaction } from "../transaction-context";

export interface DenormSpanInput {
  subjectId: string;
  startMonth: string;
  lastMonth: string;
  terminationMonth: string | null;
  data: unknown;
}
export interface DenormIssueInput {
  subjectId: string;
  month: string;
  reason: string;
  data: unknown;
}

/** Called only by a producer's write, inside the shared claimed apply. */
export function createDenormSpansStorage() {
  return {
    async replace(denormId: string, spans: DenormSpanInput[], issues: DenormIssueInput[]): Promise<void> {
      await runInTransaction(async () => {
        const db = getClient();
        await db.delete(denormSpan).where(eq(denormSpan.denormId, denormId));
        await db.delete(denormIssue).where(eq(denormIssue.denormId, denormId));
        for (let offset = 0; offset < spans.length; offset += 500)
          await db.insert(denormSpan).values(spans.slice(offset, offset + 500).map(row => ({ ...row, denormId })));
        for (let offset = 0; offset < issues.length; offset += 500)
          await db.insert(denormIssue).values(issues.slice(offset, offset + 500).map(row => ({ ...row, denormId })));
      });
    },
  };
}
