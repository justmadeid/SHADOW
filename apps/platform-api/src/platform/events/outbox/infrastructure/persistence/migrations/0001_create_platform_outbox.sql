CREATE TABLE platform_outbox_events (
  id uuid PRIMARY KEY,

  event_type text NOT NULL,
  event_version integer NOT NULL CHECK (event_version > 0),

  aggregate_type text,
  aggregate_id text,

  payload jsonb NOT NULL,

  request_id text,
  trace_parent text,

  occurred_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,

  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),

  lease_owner text,
  leased_until timestamptz,

  published_at timestamptz,

  last_error_code text,
  last_error_at timestamptz,

  created_at timestamptz NOT NULL
);

CREATE INDEX platform_outbox_pending_idx
  ON platform_outbox_events (available_at, occurred_at, id)
  WHERE published_at IS NULL;

CREATE INDEX platform_outbox_lease_idx
  ON platform_outbox_events (leased_until)
  WHERE published_at IS NULL;
