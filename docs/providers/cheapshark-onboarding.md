# CheapShark provider onboarding record

| Gate | Evidence URL or retained response date | Result |
|---|---|---|
| Access mechanism | [CheapShark API](https://apidocs.cheapshark.com/) — verified 2026-08-31. The official documentation exposes a public HTTPS API, documents GET endpoints, and requires a descriptive `User-Agent` header. | pass |
| Authentication model | [CheapShark API](https://apidocs.cheapshark.com/) — verified 2026-08-31. The official documentation explicitly states that no authorization or API key is needed. | pass |
| Permitted use for this public self-hosted comparator | [CheapShark API](https://apidocs.cheapshark.com/) — verified 2026-08-31. The official documentation permits developers to use CheapShark pricing data in their own app or website, subject to its deal-link condition. | pass |
| Rate limits and polling rules | [CheapShark API](https://apidocs.cheapshark.com/) — verified 2026-08-31. The official documentation requires user-driven requests where possible, warns against excessive automated catalog caching, documents HTTP `429` and `Retry-After`, and says deal pricing is generally refreshed about hourly. It does not publish a numeric request limit. | pass |
| Colombia coverage | [CheapShark API](https://apidocs.cheapshark.com/) — verified 2026-08-31. The official documentation states that pricing data is always USD and does not explicitly document Colombia eligibility, country coverage, or a country parameter. | unverified |
| Available offer fields | [CheapShark API](https://apidocs.cheapshark.com/) — verified 2026-08-31. The documented deals responses include identifiers, title, store, sale price, normal price, sale state, savings, timestamps, and ratings; the documentation states that prices are USD. | pass |
| Attribution or affiliate requirements | [CheapShark API](https://apidocs.cheapshark.com/) — verified 2026-08-31. Applications must use CheapShark redirect links when sending users to deals; mentioning CheapShark is appreciated but not required. | pass |
| Automated comparison permission | [CheapShark API](https://apidocs.cheapshark.com/) — verified 2026-08-31. The official documentation permits user-driven app queries but warns that excessive automated requests used to build a cached catalog can cause temporary or permanent blocking and directs automated use cases to contact CheapShark. No retained written approval covers this project's automated sync. | unverified |
| Failure behavior | [CheapShark API](https://apidocs.cheapshark.com/) — verified 2026-08-31. The official documentation defines rate-limit failure as HTTP `429`, a temporary block, and a `Retry-After` header; it also warns that excessive automated caching may cause a permanent block. | pass |

## Decision

enabledByDefault: false

The adapter cannot be added or enabled until every row is verified as pass. A failed or unavailable gate leaves the deterministic provider unchanged and the real adapter absent.
