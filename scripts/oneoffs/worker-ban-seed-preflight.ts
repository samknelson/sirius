/**
 * READ-ONLY worker-ban recovery preflight.
 *
 * Run against the intended target with the normal database environment. It
 * prints no credentials and performs no writes.
 */
import { pool } from "../../server/storage/db";
import { preflightWorkerBanSeed } from "../../server/storage/worker-ban-seed";

try {
  const report = await preflightWorkerBanSeed();
  console.log(JSON.stringify(report, null, 2));
} finally {
  await pool.end();
}