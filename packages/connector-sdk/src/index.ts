export type ConnectorCompleteness = "COMPLETE" | "PARTIAL" | "UNKNOWN";

export interface ConnectorResultEnvelope<TRecord> {
  connectorId: string;
  connectorVersion: string;
  dataSourceId: string;
  capability: string;
  runId: string;
  retrievedAt: string;
  completeness: ConnectorCompleteness;
  warnings?: string[];
  records: Array<{
    externalRecordId?: string;
    observedAt?: string;
    record: TRecord;
  }>;
}
