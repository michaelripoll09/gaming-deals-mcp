CREATE TABLE access_records (
  id TEXT PRIMARY KEY,
  product_variant_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('owned', 'subscription_access', 'loan')),
  provenance TEXT NOT NULL CHECK (provenance IN ('manual')),
  active_from TEXT,
  active_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    active_from IS NULL
    OR active_until IS NULL
    OR (
      julianday(active_from) IS NOT NULL
      AND julianday(active_until) IS NOT NULL
      AND julianday(active_until) > julianday(active_from)
    )
  ),
  FOREIGN KEY (product_variant_id) REFERENCES product_variants(id)
) STRICT;

CREATE INDEX access_records_product_variant_effective_period
  ON access_records (product_variant_id, active_from, active_until, id);
