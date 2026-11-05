-- Support Investigator on Cloudflare D1 (ADR-0048).
--
-- The Investigation Audit Trail (ADR-0034): `investigation_events` is the
-- append-only history, `investigation_current` the projection read by GET,
-- and `idempotency_keys` maps each accepted command's key to its request
-- fingerprint. Events and projections hold typed domain objects as JSON:
-- no raw ticket text, credentials or raw provider payloads (ADR-0032/0043).
CREATE TABLE investigation_events (
  investigation_id TEXT NOT NULL,
  -- 1-based. The repository computes it inside the INSERT from the current
  -- projection, so a stale expected revision yields NULL and the NOT NULL
  -- constraint aborts the whole batch (optimistic concurrency).
  revision INTEGER NOT NULL,
  event TEXT NOT NULL,
  PRIMARY KEY (investigation_id, revision)
) STRICT;

CREATE TABLE investigation_current (
  investigation_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  investigation TEXT NOT NULL
) STRICT;

CREATE TABLE idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  request_fingerprint TEXT NOT NULL,
  investigation_id TEXT NOT NULL
) STRICT;

-- Fixed-window counters for the abuse-control rules that must hold across
-- every Worker isolate and location, chiefly the global daily model budget
-- (ADR-0047). `bucket` is `<rule>:<subject>`; the subject is a salted digest
-- of the client address or `all`, never a raw address.
CREATE TABLE rate_limit_windows (
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (bucket, window_start)
) STRICT;

CREATE INDEX rate_limit_windows_expires_at ON rate_limit_windows (expires_at);
