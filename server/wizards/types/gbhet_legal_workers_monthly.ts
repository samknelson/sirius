import { FeedConfig, FeedData, createMonthlyDateRange, getCurrentMonth, formatMonthYear } from '../feed.js';
import { GbhetLegalWorkersWizard } from './gbhet_legal_workers.js';
import { LaunchArgument } from '../base.js';

export class GbhetLegalWorkersMonthlyWizard extends GbhetLegalWorkersWizard {
  name = 'gbhet_legal_workers_monthly';
  displayName = 'GBHET Legal Workers - Monthly Feed';
  description = 'Generate monthly feed of legal workers for GBHET';
  isMonthly = true;

  getLaunchArguments(): LaunchArgument[] {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;

    return [
      {
        id: 'year',
        name: 'Year',
        type: 'year',
        required: true,
        description: 'Select the year for this monthly feed',
        defaultValue: currentYear
      },
      {
        id: 'month',
        name: 'Month',
        type: 'month',
        required: true,
        description: 'Select the month for this monthly feed',
        defaultValue: currentMonth
      }
    ];
  }

  async generateFeed(config: FeedConfig, data: any): Promise<FeedData> {
    // Use launch arguments if available, otherwise fall back to period or current month
    const launchArgs = data.launchArguments || {};
    const { year, month } = launchArgs.year && launchArgs.month 
      ? { year: launchArgs.year, month: launchArgs.month }
      : (data.period || getCurrentMonth());
    
    const dateRange = createMonthlyDateRange(year, month);
    
    const recordCount = await this.getRecordCount({ dateRange });
    
    return {
      recordCount,
      generatedAt: new Date(),
      filters: { year, month },
      outputPath: this.formatOutputFilename(`gbhet_legal_workers_${year}_${month}`, config.outputFormat || 'csv')
    };
  }

  async generateRecords(year: number, month: number): Promise<any[]> {
    return [];
  }
}

export const gbhetLegalWorkersMonthly = new GbhetLegalWorkersMonthlyWizard();
