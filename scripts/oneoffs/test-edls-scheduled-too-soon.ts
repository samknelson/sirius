import { storage } from "../../server/storage";
import { ReportEdlsScheduledTooSoon } from "../../server/plugins/wizards/engine/types/report_edls_scheduled_too_soon";

async function main() {
  void storage;
  const r = new ReportEdlsScheduledTooSoon();

  const recs = await r.fetchRecords({});
  console.log("default window records:", recs.length);
  console.log(JSON.stringify(recs.slice(0, 2), null, 2));

  const wide = await r.fetchRecords({ minHours: 48, startDate: "2025-01-01", endDate: "2026-12-31" });
  console.log("wide window (48h, 2025-2026):", wide.length);
  console.log(JSON.stringify(wide.slice(0, 2), null, 2));

  const cols = await r.getRuntimeColumns();
  console.log("columns:", cols.map((c) => c.id).join(","));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
