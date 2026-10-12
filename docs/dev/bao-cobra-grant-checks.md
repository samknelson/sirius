# Manual BAO COBRA grant checks

Seed four isolated, idempotent workers in a local development database:

```sh
npm run seed:bao-cobra-grant-checks
```

The command refuses deployment/production mode and non-local database hosts. It also requires BAO's COBRA tables, the dedicated COBRA employer and October policy, an active benefit with an enabled COBRA eligibility rule that applies to a start scan, an open COBRA status, and the configured active COBRA ledger account. It does not change shared configuration or contact a payment provider. Its payment examples are marked ledger allocation rows.

For each worker ID printed by the command:

1. Open `/workers/<worker-id>/benefits/scan`.
2. Select **2026**, **October**, and **Test** mode.
3. Select **Run Test Scan**.
4. Expand the configured benefit and inspect the `sitespecific-bao-cobra` plugin result.

Expected outcomes:

| Scenario | Expected October result |
| --- | --- |
| No charge and no payment | Do not grant |
| Posted case charge, no allocated payment | Do not grant |
| Allocation, no posted case charge | Do not grant |
| Case-specific charge and same-month allocation, net zero | Grant |

Do not use Live mode; it writes benefit records. Re-running the seed reuses unchanged fixtures and refuses to overwrite manual changes or unrelated October ledger entries.
