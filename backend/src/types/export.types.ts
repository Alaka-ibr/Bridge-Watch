/**
 * Export format types
 */
export type ExportFormat = "csv" | "json" | "pdf";

/**
 * Export data type categories
 */
export type ExportDataType = "analytics" | "transactions" | "health_metrics";

/**
 * Export job status
 */
export type ExportStatus = "pending" | "processing" | "completed" | "failed";

/**
 * Filters for export data selection
 */
export interface ExportFilters {
  startDate: string;
  endDate: string;
  assetCodes?: string[];
  bridgeIds?: string[];
  limit?: number;
}

/**
 * API request payload for creating an export
 */
export interface ExportRequest {
  format: ExportFormat;
  dataType: ExportDataType;
  filters: ExportFilters;
  emailDelivery?: boolean;
  emailAddress?: string;
}

/**
 * Queue job payload for export processing
 */
export interface ExportJobPayload {
  exportId: string;
  requestedBy: string;
  format: ExportFormat;
  dataType: ExportDataType;
  filters: ExportFilters;
  emailDelivery: boolean;
  emailAddress?: string;
}

/**
 * Export history database record
 */
export interface ExportRecord {
  id: string;
  requested_by: string;
  format: ExportFormat;
  data_type: ExportDataType;
  filters: ExportFilters;
  status: ExportStatus;
  file_path: string | null;
  download_url: string | null;
  download_url_expires_at: Date | null;
  file_size_bytes: number | null;
  is_compressed: boolean;
  error_message: string | null;
  email_delivery: boolean;
  email_address: string | null;
  checksum_sha256?: string | null;
  signature?: string | null;
  public_key?: string | null;
  verification_status?: "verified" | "unverified" | "tampered" | "failed";
  verified_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Download link with expiry
 */
export interface DownloadLink {
  url: string;
  expiresAt: Date;
}

/**
 * Scheduled export configuration
 */
export interface ScheduledExport {
  id: string;
  owner_address: string;
  name: string;
  format: ExportFormat;
  data_type: ExportDataType;
  filters: ExportFilters;
  cron_schedule: string;
  email_delivery: boolean;
  email_address: string | null;
  is_active: boolean;
  last_run_at: Date | null;
  next_run_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Format handler interface for polymorphic handling
 */
export interface FormatHandler {
  generate(data: AsyncIterable<any>, options: FormatOptions): Promise<NodeJS.ReadableStream>;
}

/**
 * Options for format handlers
 */
export interface FormatOptions {
  dataType: ExportDataType;
  compress: boolean;
  compressionThreshold: number;
}

/**
 * Pagination options for export listing
 */
export interface PaginationOptions {
  page: number;
  limit: number;
}

/**
 * Paginated export list response
 */
export interface PaginatedExports {
  exports: ExportRecord[];
  length: number;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Concrete record shapes streamed into format handlers.  These represent the
 * three data categories supported by the format handlers and are derived from
 * the templates used by `pdf.handler.ts` and `json.handler.ts`.
 *
 * NOTE: We avoid reusing the DB `ExportRecord` name here to prevent a type
 * collision; this alias is for in-flight export rows (analytics / transactions
 * / health metrics) consumed by handlers.
 */
export interface AnalyticsRecord {
  time: string | number | Date;
  symbol?: string;
  source?: string;
  price?: number | string;
  volume_24h?: number | string;
}

export interface TransactionRecord {
  bridge_id: string;
  verified_at: string | number | Date;
  sequence?: number | string;
  leaf_hash?: string;
  leaf_index?: number | string;
  is_valid?: boolean;
  proof_depth?: number | null;
  job_id?: string | null;
}

export interface HealthMetricRecord {
  symbol: string;
  time: string | number | Date;
  overall_score: number;
  liquidity_depth_score: number;
  price_stability_score: number;
  bridge_uptime_score: number;
  reserve_backing_score: number;
  volume_trend_score: number;
}

export type ExportDataRecord = AnalyticsRecord | TransactionRecord | HealthMetricRecord;

