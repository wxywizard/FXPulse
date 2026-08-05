CREATE TABLE IF NOT EXISTS provider_rate_snapshots (
  provider TEXT NOT NULL,
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  rate REAL NOT NULL CHECK (rate > 0),
  rate_type TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  source_updated_at INTEGER NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (provider, base, quote, observed_at)
);

CREATE INDEX IF NOT EXISTS idx_provider_rates_latest
  ON provider_rate_snapshots(provider, base, quote, source_updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_rates_observed_at
  ON provider_rate_snapshots(observed_at DESC);
