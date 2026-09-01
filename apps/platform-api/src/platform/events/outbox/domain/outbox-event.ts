export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type JsonObject = {
  [key: string]: JsonValue;
};

export type OutboxAggregateRef = {
  type: string;
  id: string;
};

export type OutboxEventInput<TPayload extends JsonObject = JsonObject> = {
  type: string;
  version: number;

  aggregate?: OutboxAggregateRef;

  payload: TPayload;

  occurredAt?: Date;
  availableAt?: Date;
};

export type OutboxEventRecord<TPayload extends JsonObject = JsonObject> = {
  id: string;

  type: string;
  version: number;

  aggregateType: string | null;
  aggregateId: string | null;

  payload: TPayload;

  requestId: string | null;
  traceParent: string | null;

  occurredAt: Date;
  availableAt: Date;

  attemptCount: number;

  leaseOwner: string | null;
  leasedUntil: Date | null;

  publishedAt: Date | null;

  lastErrorCode: string | null;
  lastErrorAt: Date | null;
};
