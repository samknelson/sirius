# Worker CSV export: reproducible completion check

Run against a **development** PostgreSQL schema with the worker tables and optional benefits component installed:

```sh
RUN_WORKER_EXPORT_DB_SCALE=1 npx vitest run tests/workers/worker-export-db-scale.test.ts
cat /tmp/worker-export-scale.jsonl
npx vitest run tests/workers/worker-export.test.ts tests/workers/secure-worker-export.test.ts
```

The scale test creates 10,000 synthetic workers and contacts inside a transaction, downloads the unfiltered and contact-filtered CSVs over local HTTP, parses every row, verifies unique identities, compares keyset traversal against the list's ordering, and rolls the fixture back. It tests first byte **and** response EOF. It also runs a representative narrow legacy OFFSET SQL baseline and early/late query-plan comparison. The baseline excludes the old route's enrichment, serialization, and network time, so **do not** compare its total directly with the complete download time.

Sample development run (2026-09-23, 10,000 fixture workers plus 29 existing rows):

| Workload | Rows | Bytes | First byte | Early/late DB batch | Completion |
| --- | ---: | ---: | ---: | ---: | ---: |
| Narrow legacy OFFSET SQL only | 10,000 | — | — | 13 / 34 ms | 1,022 ms |
| New last-name reader | 10,000 | 551,436 | — | 16 / 4 ms | 1,049 ms |
| New contact-filtered first-name reader | 10,000 | 549,667 | — | 15 / 4 ms | 884 ms |
| New name-filtered employer reader (benefits requested) | 10,000 | 549,667 | — | 43 / 7 ms | 2,251 ms |
| Unfiltered local HTTP download | 10,029 | 831,464 | 9 ms | — | 476 ms |
| Contact-filtered local HTTP download (benefits requested) | 10,000 | 839,830 | 2 ms | — | 2,049 ms |

The representative late-batch `EXPLAIN (ANALYZE)` took 28.05 ms with OFFSET, 12.77 ms with keyset selection, and 17.56 ms for the employer/benefit keyset path on this fixture. Synthetic workers have no employment records, so the employer plan does not model a production distribution. Neither plan nor the small development database establishes a production speedup: the dataset, caches, production proxy, and employer distribution differ. The automated route suite also exercises a short idle-timeout local proxy, slow reads, paused consumers, exact batch boundaries, cancellation, and truncated streams. **The deployed proxy and production database have not been measured**; authenticated end-to-end throughput there remains unverified. Runtime batch logs report read, enrichment, write, bytes, and terminal completion without search terms or SSNs.