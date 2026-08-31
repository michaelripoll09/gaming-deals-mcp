-- Preserve the v1 history rows while the dependent offers table is rebuilt.
CREATE TABLE price_observations_v1_backup AS
SELECT id, offer_id, provider_listing_id, source_observation_key,
  original_amount_minor, original_currency, normalized_amount_minor,
  comparison_currency, observed_at
FROM price_observations;
DROP TABLE price_observations;

ALTER TABLE product_variants
  ADD COLUMN region_code TEXT
  CHECK (region_code IS NULL OR length(trim(region_code)) > 0);

UPDATE product_variants
SET region_code = 'ZZ'
WHERE region_code IS NULL;

CREATE TABLE offers_v2 (
  id TEXT PRIMARY KEY,
  provider_listing_id TEXT NOT NULL,
  country TEXT NOT NULL CHECK (length(country) = 2),
  original_currency TEXT NOT NULL CHECK (original_currency GLOB '[A-Z][A-Z][A-Z]'),
  original_amount_minor INTEGER NOT NULL CHECK (original_amount_minor >= 0),
  product_url TEXT NOT NULL,
  available INTEGER NOT NULL CHECK (available IN (0, 1)),
  observed_at TEXT NOT NULL,
  source_observation_key TEXT NOT NULL DEFAULT 'legacy'
    CHECK (length(source_observation_key) > 0),
  normalized_amount_minor INTEGER
    CHECK (normalized_amount_minor IS NULL OR normalized_amount_minor >= 0),
  normalized_currency TEXT
    CHECK (
      (normalized_amount_minor IS NULL) = (normalized_currency IS NULL)
      AND (normalized_currency IS NULL OR normalized_currency GLOB '[A-Z][A-Z][A-Z]')
    ),
  normalized_final_amount_minor INTEGER
    CHECK (normalized_final_amount_minor IS NULL OR normalized_final_amount_minor >= 0),
  normalized_final_currency TEXT
    CHECK (
      (normalized_final_amount_minor IS NULL) = (normalized_final_currency IS NULL)
      AND (normalized_final_currency IS NULL OR normalized_final_currency GLOB '[A-Z][A-Z][A-Z]')
    ),
  exchange_rate_source TEXT,
  converted_at TEXT
    CHECK ((exchange_rate_source IS NULL) = (converted_at IS NULL)),
  region_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (region_status IN ('compatible', 'incompatible', 'unknown')),
  retailer_class TEXT
    CHECK (retailer_class IS NULL OR retailer_class IN (
      'authorized_store', 'marketplace', 'first_party_storefront', 'physical_retailer'
    )),
  source_confidence TEXT
    CHECK (source_confidence IS NULL OR source_confidence IN ('high', 'medium', 'low')),
  shipping_known INTEGER NOT NULL DEFAULT 0 CHECK (shipping_known IN (0, 1)),
  taxes_known INTEGER NOT NULL DEFAULT 0 CHECK (taxes_known IN (0, 1)),
  UNIQUE (provider_listing_id, country),
  FOREIGN KEY (provider_listing_id) REFERENCES provider_listings(id)
) STRICT;

INSERT INTO offers_v2 (
  id, provider_listing_id, country, original_currency, original_amount_minor,
  product_url, available, observed_at
)
SELECT id, provider_listing_id, country,
  CASE WHEN original_currency GLOB '[A-Z][A-Z][A-Z]' THEN original_currency ELSE 'XXX' END,
  original_amount_minor, product_url, available, observed_at
FROM offers;

DROP TABLE offers;
ALTER TABLE offers_v2 RENAME TO offers;

CREATE TABLE price_observations (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL,
  provider_listing_id TEXT NOT NULL,
  source_observation_key TEXT NOT NULL CHECK (length(source_observation_key) > 0),
  original_amount_minor INTEGER NOT NULL CHECK (original_amount_minor >= 0),
  original_currency TEXT NOT NULL CHECK (original_currency GLOB '[A-Z][A-Z][A-Z]'),
  normalized_amount_minor INTEGER
    CHECK (normalized_amount_minor IS NULL OR normalized_amount_minor >= 0),
  comparison_currency TEXT
    CHECK (
      (normalized_amount_minor IS NULL) = (comparison_currency IS NULL)
      AND (comparison_currency IS NULL OR comparison_currency GLOB '[A-Z][A-Z][A-Z]')
    ),
  observed_at TEXT NOT NULL,
  UNIQUE (provider_listing_id, source_observation_key),
  FOREIGN KEY (offer_id) REFERENCES offers(id),
  FOREIGN KEY (provider_listing_id) REFERENCES provider_listings(id)
) STRICT;

INSERT INTO price_observations (
  id, offer_id, provider_listing_id, source_observation_key, original_amount_minor,
  original_currency, normalized_amount_minor, comparison_currency, observed_at
)
SELECT id, offer_id, provider_listing_id,
  CASE WHEN length(source_observation_key) > 0 THEN source_observation_key ELSE 'legacy:' || id END,
  original_amount_minor,
  CASE WHEN original_currency GLOB '[A-Z][A-Z][A-Z]' THEN original_currency ELSE 'XXX' END,
  CASE WHEN normalized_amount_minor IS NOT NULL
      AND normalized_amount_minor >= 0
      AND comparison_currency GLOB '[A-Z][A-Z][A-Z]'
    THEN normalized_amount_minor ELSE NULL END,
  CASE WHEN normalized_amount_minor IS NOT NULL
      AND normalized_amount_minor >= 0
      AND comparison_currency GLOB '[A-Z][A-Z][A-Z]'
    THEN comparison_currency ELSE NULL END,
  observed_at
FROM price_observations_v1_backup;

-- A current offer can inherit history only when one and only one historical
-- observation is complete under the approved contract.
UPDATE offers
SET source_observation_key = (
      SELECT source_observation_key
      FROM price_observations_v1_backup
      WHERE price_observations_v1_backup.offer_id = offers.id
        AND length(source_observation_key) > 0
        AND original_amount_minor >= 0
        AND original_currency GLOB '[A-Z][A-Z][A-Z]'
        AND (
          (normalized_amount_minor IS NULL AND comparison_currency IS NULL)
          OR (
            normalized_amount_minor IS NOT NULL
            AND normalized_amount_minor >= 0
            AND comparison_currency GLOB '[A-Z][A-Z][A-Z]'
          )
        )
      LIMIT 1
    ),
    normalized_amount_minor = (
      SELECT normalized_amount_minor
      FROM price_observations_v1_backup
      WHERE price_observations_v1_backup.offer_id = offers.id
        AND length(source_observation_key) > 0
        AND original_amount_minor >= 0
        AND original_currency GLOB '[A-Z][A-Z][A-Z]'
        AND (
          (normalized_amount_minor IS NULL AND comparison_currency IS NULL)
          OR (
            normalized_amount_minor IS NOT NULL
            AND normalized_amount_minor >= 0
            AND comparison_currency GLOB '[A-Z][A-Z][A-Z]'
          )
        )
      LIMIT 1
    ),
    normalized_currency = (
      SELECT comparison_currency
      FROM price_observations_v1_backup
      WHERE price_observations_v1_backup.offer_id = offers.id
        AND length(source_observation_key) > 0
        AND original_amount_minor >= 0
        AND original_currency GLOB '[A-Z][A-Z][A-Z]'
        AND (
          (normalized_amount_minor IS NULL AND comparison_currency IS NULL)
          OR (
            normalized_amount_minor IS NOT NULL
            AND normalized_amount_minor >= 0
            AND comparison_currency GLOB '[A-Z][A-Z][A-Z]'
          )
        )
      LIMIT 1
    )
WHERE (
  SELECT COUNT(*)
  FROM price_observations_v1_backup
  WHERE price_observations_v1_backup.offer_id = offers.id
) = 1
AND (
  SELECT COUNT(*)
  FROM price_observations_v1_backup
  WHERE price_observations_v1_backup.offer_id = offers.id
    AND length(source_observation_key) > 0
    AND original_amount_minor >= 0
    AND original_currency GLOB '[A-Z][A-Z][A-Z]'
    AND (
      (normalized_amount_minor IS NULL AND comparison_currency IS NULL)
      OR (
        normalized_amount_minor IS NOT NULL
        AND normalized_amount_minor >= 0
        AND comparison_currency GLOB '[A-Z][A-Z][A-Z]'
      )
    )
) = 1;

DROP TABLE price_observations_v1_backup;

ALTER TABLE wishlist_entries
  ADD COLUMN priority INTEGER NOT NULL DEFAULT 2 CHECK (priority IN (1, 2, 3));

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
  ADD COLUMN notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000);

ALTER TABLE wishlist_entries
  ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';

UPDATE wishlist_entries
SET updated_at = created_at
WHERE updated_at = '';
