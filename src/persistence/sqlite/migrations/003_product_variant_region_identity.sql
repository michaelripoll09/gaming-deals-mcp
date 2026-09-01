-- A NULL region represents the single global variant for an edition/platform/channel.
-- Non-null regions represent separate regional variants. Empty strings are disallowed,
-- so the expression index can use '' as a collision-free NULL sentinel.
CREATE TABLE product_variants_v3 (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  distribution_channel TEXT NOT NULL,
  created_at TEXT NOT NULL,
  region_code TEXT
    CHECK (region_code IS NULL OR length(trim(region_code)) > 0),
  FOREIGN KEY (edition_id) REFERENCES editions(id)
) STRICT;

INSERT INTO product_variants_v3 (
  id, edition_id, platform, distribution_channel, created_at, region_code
)
SELECT id, edition_id, platform, distribution_channel, created_at, region_code
FROM product_variants;

DROP TABLE product_variants;
ALTER TABLE product_variants_v3 RENAME TO product_variants;

CREATE UNIQUE INDEX product_variants_region_identity
  ON product_variants (
    edition_id,
    platform,
    distribution_channel,
    COALESCE(region_code, '')
  );
