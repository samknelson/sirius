import { WizardReport, ReportConfig, ReportColumn, ReportRecord } from '../report.js';
import { storage } from '../../storage/index.js';
import { getChargePlugin, getAllChargePlugins } from '../../charge-plugins/registry.js';
import type { LedgerEntryVerification } from '../../charge-plugins/types.js';
import type { ChargePluginConfig } from '@shared/schema';

interface LedgerIntegrityConfig extends ReportConfig {
  chargePlugins?: string[];
  dateFrom?: string;
  dateTo?: string;
}

export class ReportLedgerIntegrity extends WizardReport {
  name = 'report_ledger_integrity';
  displayName = 'Ledger Integrity Check';
  description = 'Verifies that ledger entries match what charge plugins would compute based on the source data';
  category = 'Ledger';

  getColumns(): ReportColumn[] {
    return [
      {
        id: 'entryId',
        header: 'Entry ID',
        type: 'string',
        width: 100
      },
      {
        id: 'chargePlugin',
        header: 'Charge Plugin',
        type: 'string',
        width: 180
      },
      {
        id: 'transactionDate',
        header: 'Transaction Date',
        type: 'date',
        width: 120
      },
      {
        id: 'actualAmount',
        header: 'Actual Amount',
        type: 'string',
        width: 120
      },
      {
        id: 'expectedAmount',
        header: 'Expected Amount',
        type: 'string',
        width: 120
      },
      {
        id: 'discrepancy',
        header: 'Discrepancy',
        type: 'string',
        width: 300
      },
      {
        id: 'referenceLink',
        header: 'Reference',
        type: 'link',
        width: 120
      }
    ];
  }

  private buildReferenceLink(referenceType: string | null, referenceId: string | null): { url: string; label: string } | null {
    if (!referenceType || !referenceId) return null;

    switch (referenceType) {
      case 'hour': {
        const parts = referenceId.split(':');
        if (parts.length >= 2) {
          const workerId = parts[0];
          return {
            url: `/workers/${workerId}/hours`,
            label: 'View Hours'
          };
        }
        break;
      }
      case 'payment': {
        return {
          url: `/ledger/payments/${referenceId}`,
          label: 'View Payment'
        };
      }
    }
    return null;
  }

  getPrimaryKeyField(): string {
    return 'entryId';
  }

  async fetchRecords(
    config: LedgerIntegrityConfig,
    batchSize: number = 100,
    onProgress?: (progress: { processed: number; total: number }) => void
  ): Promise<ReportRecord[]> {
    const records: ReportRecord[] = [];

    const filter: { chargePlugins?: string[]; dateFrom?: Date; dateTo?: Date } = {};
    
    if (config.chargePlugins && config.chargePlugins.length > 0) {
      filter.chargePlugins = config.chargePlugins;
    }
    
    if (config.dateFrom) {
      filter.dateFrom = new Date(config.dateFrom);
    }
    
    if (config.dateTo) {
      filter.dateTo = new Date(config.dateTo);
      filter.dateTo.setHours(23, 59, 59, 999);
    }

    const entries = await storage.ledger.entries.getByFilter(filter);
    const total = entries.length;

    const pluginConfigs = await storage.chargePluginConfigs.getAll();
    
    const configsByPlugin = new Map<string, ChargePluginConfig[]>();
    for (const cfg of pluginConfigs) {
      if (!cfg.enabled) continue;
      const list = configsByPlugin.get(cfg.pluginId) || [];
      list.push(cfg);
      configsByPlugin.set(cfg.pluginId, list);
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      
      const referenceLink = this.buildReferenceLink(entry.referenceType, entry.referenceId);
      
      const plugin = getChargePlugin(entry.chargePlugin);
      if (!plugin) {
        records.push({
          entryId: entry.id,
          chargePlugin: entry.chargePlugin,
          transactionDate: entry.date,
          actualAmount: entry.amount,
          expectedAmount: null,
          discrepancy: `Unknown charge plugin: ${entry.chargePlugin}`,
          referenceLink
        });
        continue;
      }

      const configs = configsByPlugin.get(entry.chargePlugin) || [];
      
      let matchingConfig: ChargePluginConfig | undefined;
      for (const cfg of configs) {
        if (entry.chargePluginKey.startsWith(`${cfg.id}:`)) {
          matchingConfig = cfg;
          break;
        }
      }

      if (!matchingConfig) {
        records.push({
          entryId: entry.id,
          chargePlugin: entry.chargePlugin,
          transactionDate: entry.date,
          actualAmount: entry.amount,
          expectedAmount: null,
          discrepancy: `No matching plugin configuration found for entry`,
          referenceLink
        });
        continue;
      }

      try {
        const verification: LedgerEntryVerification = await plugin.verifyEntry(entry, matchingConfig);
        
        if (!verification.isValid) {
          records.push({
            entryId: entry.id,
            chargePlugin: entry.chargePlugin,
            transactionDate: entry.date,
            actualAmount: verification.actualAmount,
            expectedAmount: verification.expectedAmount,
            discrepancy: verification.discrepancies.join('; '),
            referenceLink
          });
        }
      } catch (error) {
        records.push({
          entryId: entry.id,
          chargePlugin: entry.chargePlugin,
          transactionDate: entry.date,
          actualAmount: entry.amount,
          expectedAmount: null,
          discrepancy: `Verification error: ${error instanceof Error ? error.message : String(error)}`,
          referenceLink
        });
      }

      if (onProgress && (i + 1) % batchSize === 0) {
        onProgress({
          processed: i + 1,
          total
        });
      }
    }

    if (onProgress) {
      onProgress({
        processed: total,
        total
      });
    }

    return records;
  }
}
