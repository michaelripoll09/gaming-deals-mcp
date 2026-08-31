CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (normalized_title)
) STRICT;

CREATE TABLE releases (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  title TEXT NOT NULL,
  release_date TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (game_id) REFERENCES games(id)
) STRICT;

CREATE TABLE editions (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (release_id, name),
  FOREIGN KEY (release_id) REFERENCES releases(id)
) STRICT;

CREATE TABLE product_variants (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  distribution_channel TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (edition_id, platform, distribution_channel),
  FOREIGN KEY (edition_id) REFERENCES editions(id)
) STRICT;

CREATE TABLE provider_listings (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  provider_product_id TEXT NOT NULL,
  product_variant_id TEXT,
  mapping_state TEXT NOT NULL CHECK (mapping_state IN ('verified', 'probable', 'ambiguous', 'unmatched')),
  UNIQUE (provider_id, provider_product_id),
  FOREIGN KEY (product_variant_id) REFERENCES product_variants(id)
) STRICT;

CREATE TABLE offers (
  id TEXT PRIMARY KEY,
  provider_listing_id TEXT NOT NULL,
  country TEXT NOT NULL CHECK (length(country) = 2),
  original_currency TEXT NOT NULL CHECK (length(original_currency) = 3),
  original_amount_minor INTEGER NOT NULL CHECK (original_amount_minor >= 0),
  product_url TEXT NOT NULL,
  available INTEGER NOT NULL CHECK (available IN (0, 1)),
  observed_at TEXT NOT NULL,
  UNIQUE (provider_listing_id, country),
  FOREIGN KEY (provider_listing_id) REFERENCES provider_listings(id)
) STRICT;

CREATE TABLE price_observations (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL,
  provider_listing_id TEXT NOT NULL,
  source_observation_key TEXT NOT NULL,
  original_amount_minor INTEGER NOT NULL CHECK (original_amount_minor >= 0),
  original_currency TEXT NOT NULL CHECK (length(original_currency) = 3),
  normalized_amount_minor INTEGER,
  comparison_currency TEXT,
  observed_at TEXT NOT NULL,
  UNIQUE (provider_listing_id, source_observation_key),
  FOREIGN KEY (offer_id) REFERENCES offers(id),
  FOREIGN KEY (provider_listing_id) REFERENCES provider_listings(id)
) STRICT;

CREATE TABLE wishlist_entries (
  id TEXT PRIMARY KEY,
  product_variant_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (product_variant_id),
  FOREIGN KEY (product_variant_id) REFERENCES product_variants(id)
) STRICT;
