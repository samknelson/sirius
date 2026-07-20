import { storage } from "../../server/storage";
import { edlsSummaryPlugin } from "../../server/plugins/dashboard/plugins/edls-summary";

async function main() {
  const sheets = await storage.edlsSheets.getAll();
  const nonTrash = sheets.filter((s) => s.status !== "trash");
  if (nonTrash.length === 0) {
    console.log("No non-trash EDLS sheets found; cannot test.");
    process.exit(1);
  }
  const ymd = nonTrash[0].ymd;
  console.log(`Testing with ymd=${ymd}`);

  const ctx = { storage, query: { ymd } } as any;
  const result = (await edlsSummaryPlugin.content(ctx)) as any;
  console.log("unassigned:", JSON.stringify(result.unassigned));
  console.log("unassignedTotal:", result.unassignedTotal);
  console.log("memberStatuses:", JSON.stringify(result.memberStatuses));

  // Sanity check: population = assigned-in-population + unassigned
  const sheetForDay = nonTrash.find((s) => s.ymd === ymd)!;
  const employer = await storage.employers.getEmployer(sheetForDay.employerId);
  const population = await storage.edlsAssignments.getAvailableWorkersForSheet(
    ymd,
    employer?.industryId ?? null,
  );
  console.log("population size:", population.length);
  const sumUnassigned = Object.values(result.unassigned as Record<string, number>).reduce(
    (s: number, v: number) => s + v,
    0,
  );
  console.log(
    "sum(unassigned) =", sumUnassigned,
    "=> assigned-in-population =", population.length - sumUnassigned,
  );
  if (sumUnassigned !== result.unassignedTotal) {
    throw new Error("unassignedTotal does not match sum of unassigned map");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
