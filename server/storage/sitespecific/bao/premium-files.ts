import { getClient, runInTransaction } from '../../transaction-context';
import { and, eq, desc, asc, sql, getTableName } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "../../utils";
import {
  sitespecificBaoPremiumFiles,
  sitespecificBaoPremiumFileRows,
  ledger,
  ledgerEa,
  ledgerAccounts,
  trustProviders,
  trustBenefits,
  workers,
  contacts,
  type BaoPremiumFile,
  type BaoPremiumFileRow,
  type BaoPremiumFileWithNames,
  type BaoPremiumFileRowWithNames,
} from "@shared/schema";
import type { StorageLoggingConfig } from "../../middleware/logging";

export type { BaoPremiumFile, BaoPremiumFileRow, BaoPremiumFileWithNames, BaoPremiumFileRowWithNames };

/** Charge-plugin discriminator used on the offsetting payment entries. */
export const PREMIUM_FILE_LEDGER_PLUGIN = "sitespecific-bao-premium-file";

export interface BaoPremiumFilesStorage {
  list(filters: { providerId?: string }): Promise<BaoPremiumFileWithNames[]>;
  get(id: string): Promise<BaoPremiumFileWithNames | undefined>;
  getRows(fileId: string): Promise<BaoPremiumFileRowWithNames[]>;
  /**
   * Generate a premium file for a provider's entity account: snapshots every
   * (statement month, worker, benefit) group on the account whose ledger
   * entries net to a non-zero amount, records them as file rows, and writes
   * one offsetting (negative) ledger entry per group so those months are
   * marked paid. Runs in a single transaction serialized per entity account
   * with an advisory lock, so concurrent generations cannot double-pay.
   *
   * Returns undefined when the provider has no matching entity account;
   * throws NO_UNPAID_PREMIUMS when every month already nets to zero.
   */
  generate(providerId: string, accountId: string): Promise<BaoPremiumFile | undefined>;
  /**
   * Whether a (worker, benefit, statement month) group on an entity account
   * has already been swept into a premium file (i.e. an offsetting
   * premium-file payment entry exists for it). Used by the premium charge
   * plugin to avoid deleting legacy dependent-keyed charges that have been
   * settled — deleting those would leave the payment unbalanced.
   */
  isMonthSwept(
    eaId: string,
    workerId: string,
    benefitId: string,
    statementYmd: string,
  ): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

export const NO_UNPAID_PREMIUMS = "NO_UNPAID_PREMIUMS";

const files = sitespecificBaoPremiumFiles;
const fileRows = sitespecificBaoPremiumFileRows;
const filesTableName = getTableName(files);

const enrichedFileSelection = {
  id: files.id,
  providerId: files.providerId,
  accountId: files.accountId,
  eaId: files.eaId,
  generatedAt: files.generatedAt,
  totalAmount: files.totalAmount,
  rowCount: files.rowCount,
  data: files.data,
  providerName: trustProviders.name,
  accountName: ledgerAccounts.name,
};

export function createBaoPremiumFilesStorage(): BaoPremiumFilesStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(filesTableName);
    },

    async list(filters: { providerId?: string }): Promise<BaoPremiumFileWithNames[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const rows = await client
        .select(enrichedFileSelection)
        .from(files)
        .leftJoin(trustProviders, eq(trustProviders.id, files.providerId))
        .leftJoin(ledgerAccounts, eq(ledgerAccounts.id, files.accountId))
        .where(filters.providerId ? eq(files.providerId, filters.providerId) : undefined)
        .orderBy(desc(files.generatedAt));
      return rows as BaoPremiumFileWithNames[];
    },

    async get(id: string): Promise<BaoPremiumFileWithNames | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const rows = await client
        .select(enrichedFileSelection)
        .from(files)
        .leftJoin(trustProviders, eq(trustProviders.id, files.providerId))
        .leftJoin(ledgerAccounts, eq(ledgerAccounts.id, files.accountId))
        .where(eq(files.id, id));
      return rows[0] as BaoPremiumFileWithNames | undefined;
    },

    async getRows(fileId: string): Promise<BaoPremiumFileRowWithNames[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const rows = await client
        .select({
          id: fileRows.id,
          fileId: fileRows.fileId,
          workerId: fileRows.workerId,
          benefitId: fileRows.benefitId,
          statementYmd: fileRows.statementYmd,
          amount: fileRows.amount,
          data: fileRows.data,
          workerName: contacts.displayName,
          benefitName: trustBenefits.name,
        })
        .from(fileRows)
        .leftJoin(workers, eq(workers.id, fileRows.workerId))
        .leftJoin(contacts, eq(contacts.id, workers.contactId))
        .leftJoin(trustBenefits, eq(trustBenefits.id, fileRows.benefitId))
        .where(eq(fileRows.fileId, fileId))
        .orderBy(asc(fileRows.statementYmd), asc(contacts.displayName));
      return rows as BaoPremiumFileRowWithNames[];
    },

    async isMonthSwept(
      eaId: string,
      workerId: string,
      benefitId: string,
      statementYmd: string,
    ): Promise<boolean> {
      const client = getClient();
      const result = await client.execute(sql`
        SELECT 1 FROM ledger
        WHERE ea_id = ${eaId}
          AND charge_plugin = ${PREMIUM_FILE_LEDGER_PLUGIN}
          AND data->>'workerId' = ${workerId}
          AND data->>'benefitId' = ${benefitId}
          AND date_trunc('month', statement_ymd)::date = date_trunc('month', ${statementYmd}::date)::date
        LIMIT 1
      `);
      return (result.rows?.length ?? 0) > 0;
    },

    async generate(providerId: string, accountId: string): Promise<BaoPremiumFile | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      return runInTransaction(async () => {
        const client = getClient();

        const eas = await client
          .select()
          .from(ledgerEa)
          .where(
            and(
              eq(ledgerEa.accountId, accountId),
              eq(ledgerEa.entityType, "trust_provider"),
              eq(ledgerEa.entityId, providerId),
            ),
          );
        const ea = eas[0];
        if (!ea) return undefined;

        // Serialize generations per entity account so two concurrent runs
        // cannot both see the same unpaid months and double-pay them.
        await client.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${'bao-premium-file:' + ea.id}, 0))`,
        );

        // Net amount per (statement month, worker, benefit), restricted to
        // the premium accounting stream: charges written by the premium
        // charge plugin plus the offsetting payments this method writes.
        // Unrelated ledger entries on the same entity account are never
        // swept into a premium file. Entries in both streams carry
        // workerId/benefitId in data, so an already-paid month nets to zero
        // and drops out.
        const groups = await client.execute(sql`
          SELECT
            date_trunc('month', statement_ymd)::date AS statement_month,
            data->>'workerId' AS worker_id,
            data->>'benefitId' AS benefit_id,
            SUM(amount) AS net_amount,
            bool_or(COALESCE((data->>'orphanSubscriberWmb')::boolean, false)) AS orphan_subscriber_wmb
          FROM ledger
          WHERE ea_id = ${ea.id}
            AND charge_plugin IN ('sitespecific-bao-premium', ${PREMIUM_FILE_LEDGER_PLUGIN})
          GROUP BY 1, 2, 3
          HAVING SUM(amount) <> 0
          ORDER BY 1, 2, 3
        `);

        const rows = (groups.rows ?? []) as Array<{
          statement_month: string;
          worker_id: string | null;
          benefit_id: string | null;
          net_amount: string;
          orphan_subscriber_wmb: boolean | null;
        }>;
        if (rows.length === 0) {
          throw new Error(NO_UNPAID_PREMIUMS);
        }

        const total = rows.reduce((acc, r) => acc + Number(r.net_amount), 0);

        const inserted = await client
          .insert(files)
          .values({
            providerId,
            accountId,
            eaId: ea.id,
            totalAmount: total.toFixed(2),
            rowCount: rows.length,
          })
          .returning();
        const file = inserted[0];

        for (const row of rows) {
          const statementYmd =
            typeof row.statement_month === "string"
              ? row.statement_month.slice(0, 10)
              : new Date(row.statement_month).toISOString().slice(0, 10);
          const amount = Number(row.net_amount);

          await client.insert(fileRows).values({
            fileId: file.id,
            workerId: row.worker_id,
            benefitId: row.benefit_id,
            statementYmd,
            amount: amount.toFixed(2),
            // Staff-visible anomaly marker: the swept charge was billed to a
            // subscriber with no WMB row of their own (dependents only).
            data: row.orphan_subscriber_wmb ? { orphanSubscriberWmb: true } : undefined,
          });

          // Offsetting payment entry: zeroes the group so the next
          // generation run no longer sees it as unpaid.
          await client.insert(ledger).values({
            chargePlugin: PREMIUM_FILE_LEDGER_PLUGIN,
            chargePluginKey: `${file.id}:${statementYmd}:${row.worker_id ?? "none"}:${row.benefit_id ?? "none"}`,
            amount: (-amount).toFixed(2),
            eaId: ea.id,
            referenceType: "premium_file",
            referenceId: file.id,
            date: new Date(),
            statementYmd,
            memo: `Premium file payment (${statementYmd.slice(0, 7)})`,
            data: {
              workerId: row.worker_id,
              benefitId: row.benefit_id,
              premiumFileId: file.id,
            },
          });
        }

        return file;
      });
    },
  };
}

export const baoPremiumFilesLoggingConfig: StorageLoggingConfig<BaoPremiumFilesStorage> = {
  module: 'sitespecific.bao.premium-files',
  methods: {
    generate: {
      enabled: true,
      getEntityId: (args, result) => result?.id,
      getDescription: (args, result) =>
        result
          ? `Generated premium file ${result.id} (${result.rowCount} rows, total ${result.totalAmount})`
          : `Premium file generation found no entity account`,
    },
  },
};
