CREATE TABLE IF NOT EXISTS rate_snapshots (
  quote TEXT NOT NULL,
  rate REAL NOT NULL CHECK (rate > 0),
  observed_at INTEGER NOT NULL,
  source_updated_at INTEGER NOT NULL,
  provider TEXT NOT NULL,
  PRIMARY KEY (quote, observed_at, provider)
);

CREATE INDEX IF NOT EXISTS idx_rate_snapshots_observed_at
  ON rate_snapshots(observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_rate_snapshots_quote_observed
  ON rate_snapshots(quote, observed_at DESC);
