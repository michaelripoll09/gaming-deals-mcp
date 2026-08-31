ALTER TABLE product_variants
  ADD COLUMN region_code TEXT NOT NULL DEFAULT 'ZZ'
  CHECK (region_code GLOB '[A-Z][A-Z]');

ALTER TABLE offers
  ADD COLUMN source_observation_key TEXT NOT NULL DEFAULT 'legacy'
  CHECK (length(source_observation_key) > 0);

ALTER TABLE offers
  ADD COLUMN normalized_amount_minor INTEGER
  CHECK (normalized_amount_minor IS NULL OR normalized_amount_minor >= 0);

ALTER TABLE offers
  ADD COLUMN normalized_currency TEXT
  CHECK (
    (normalized_amount_minor IS NULL) = (normalized_currency IS NULL)
    AND (normalized_currency IS NULL OR normalized_currency GLOB '[A-Z][A-Z][A-Z]')
  );

ALTER TABLE offers
  ADD COLUMN normalized_final_amount_minor INTEGER
  CHECK (normalized_final_amount_minor IS NULL OR normalized_final_amount_minor >= 0);

ALTER TABLE offers
  ADD COLUMN normalized_final_currency TEXT
  CHECK (
    (normalized_final_amount_minor IS NULL) = (normalized_final_currency IS NULL)
    AND (normalized_final_currency IS NULL OR normalized_final_currency GLOB '[A-Z][A-Z][A-Z]')
  );

ALTER TABLE offers
  ADD COLUMN exchange_rate_source TEXT;

ALTER TABLE offers
  ADD COLUMN converted_at TEXT
  CHECK ((exchange_rate_source IS NULL) = (converted_at IS NULL));

ALTER TABLE offers
  ADD COLUMN region_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (region_status IN ('compatible', 'incompatible', 'unknown'));

ALTER TABLE offers
  ADD COLUMN retailer_class TEXT
  CHECK (retailer_class IS NULL OR retailer_class IN (
    'authorized_store', 'marketplace', 'first_party_storefront', 'physical_retailer'
  ));

ALTER TABLE offers
  ADD COLUMN source_confidence TEXT
  CHECK (source_confidence IS NULL OR source_confidence IN ('high', 'medium', 'low'));

ALTER TABLE offers
  ADD COLUMN shipping_known INTEGER NOT NULL DEFAULT 0
  CHECK (shipping_known IN (0, 1));

ALTER TABLE offers
  ADD COLUMN taxes_known INTEGER NOT NULL DEFAULT 0
  CHECK (taxes_known IN (0, 1));

UPDATE offers
SET source_observation_key = COALESCE(
  (SELECT NULLIF(source_observation_key, '')
   FROM price_observations
   WHERE price_observations.offer_id = offers.id
   ORDER BY rowid
   LIMIT 1),
  source_observation_key
);

UPDATE offers
SET normalized_amount_minor = (
      SELECT CASE WHEN normalized_amount_minor IS NULL OR comparison_currency IS NULL
        THEN NULL ELSE normalized_amount_minor END
      FROM price_observations
      WHERE price_observations.offer_id = offers.id
      ORDER BY rowid
      LIMIT 1
    ),
    normalized_currency = (
      SELECT CASE WHEN normalized_amount_minor IS NULL OR comparison_currency IS NULL
        THEN NULL ELSE comparison_currency END
      FROM price_observations
      WHERE price_observations.offer_id = offers.id
      ORDER BY rowid
      LIMIT 1
    )
WHERE EXISTS (
  SELECT 1
  FROM price_observations
  WHERE price_observations.offer_id = offers.id
);

ALTER TABLE wishlist_entries
  ADD COLUMN priority INTEGER NOT NULL DEFAULT 2
  CHECK (priority IN (1, 2, 3));

ALTER TABLE wishlist_entries
  ADD COLUMN target_amount_minor INTEGER
  CHECK (target_amount_minor IS NULL OR target_amount_minor >= 0);

ALTER TABLE wishlist_entries
  ADD COLUMN target_currency TEXT
  CHECK (
    (target_amount_minor IS NULL) = (target_currency IS NULL)
    AND (target_currency IS NULL OR target_currency GLOB '[A-Z][A-Z][A-Z]')
  );

ALTER TABLE wishlist_entries
  ADD COLUMN notes TEXT
  CHECK (notes IS NULL OR length(notes) <= 2000);

ALTER TABLE wishlist_entries
  ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';

UPDATE wishlist_entries
SET updated_at = created_at
WHERE updated_at = '';
