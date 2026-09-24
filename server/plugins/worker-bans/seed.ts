// Boot-time seeding lives in the storage layer where direct db access is
// permitted. Re-exported here so the plugin module boundary stays intact.
export { seedWorkerBanTypes } from "../../storage/worker-ban-seed";
