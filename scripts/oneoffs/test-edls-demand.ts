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
  console.log(
    "Sheets on that day:",
    nonTrash.filter((s) => s.ymd === ymd).map((s) => ({ id: s.id, status: s.status, ymd: s.ymd })),
  );

  const ctx = { storage, query: { ymd } } as any;
  const result = (await edlsSummaryPlugin.content(ctx)) as any;
  console.log("demand:", JSON.stringify(result.demand));
  console.log("memberStatuses:", result.memberStatuses.length, "grid keys:", Object.keys(result.grid).length);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
