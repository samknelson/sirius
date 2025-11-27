export type RetentionPeriod = '1day' | '7days' | '30days' | '1year' | 'always';

export interface ReportConfig {
  filters?: Record<string, any>;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

export interface ReportMeta {
  generatedAt: string;
  recordCount: number;
  columns: ReportColumn[];
  primaryKeyField?: string;
}

export interface ReportColumn {
  id: string;
  header: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'link';
  width?: number;
}

export interface ReportData {
  config?: ReportConfig;
  reportMeta?: ReportMeta;
  recordCount?: number;
  generatedAt?: string;
  reportDataId?: string;
  retention?: RetentionPeriod;
  progress?: {
    [key: string]: {
      status: string;
      completedAt?: string;
      percentComplete?: number;
    };
  };
}
