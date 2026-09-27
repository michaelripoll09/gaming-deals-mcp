# Canonical Catalog Domain (Block 2)

## Objective
Implement only the approved canonical catalog domain for Gaming Deals MCP, without starting provider capabilities, real providers, offers, pricing, wishlist/access records, Deal Score, MCP, dashboard, scheduler, or later sequence blocks.

## Problem and rationale
Foundation is complete at baseline `4a74678f327ce304fba10b1ccde5ed6a85d30e56`. Block 2 needs stable internal catalog identity, explicit hierarchy/context, relational integrity, persistent provider-product mapping state, and migration-backed repositories before provider work can safely build on it.

## Authority and constraints
- Approved source: `2026-08-30-gaming-deals-mcp-design-final.md`, sections 8, 8.1–8.4, 30, 34, and 35.
- Issue: #13 (`feat: implement canonical catalog domain`), labels `status:approved`, `type:feature`.
- Branch: `feat/canonical-catalog`, starting from main `4a74678f327ce304fba10b1ccde5ed6a85d30e56`.
- Preserve migration 001 byte-for-byte/checksum; add migration 002 only.
- No runtime dependencies; no real provider adapters or network I/O.
- Keep public errors safe; no SQL/path/stack/raw row leakage.
- Preserve CoreServices database ownership/close guarantees.
- Do not modify CI check contexts, Node compatibility, Protect main, or Dependabot PRs.
- No merge. Commit and push only this feature branch; create PR targeting main and await checks/review.
- TDD: strict RED → GREEN → REFACTOR; runner: `npm test -- --run`, selected explicitly by the user.
- Route: delegated direct implementation because multiple non-trivial files must change; parent remains responsible for scope, task reconciliation, commits, and delivery.
- Delivery strategy: `exception-ok`, explicitly authorized by the user on 2026-09-27 to keep the requested single PR despite exceeding the 400-line review guideline; retain coherent work-unit commits and report actual PR size.

## Scope
Implement catalog domain types/validation, Game → Release → Edition → Product hierarchy, extensible platform family/variant and stable distribution category identifiers, ProductComposition, provider-product mapping states/identity/persistence, SQLite migration 002, small typed repositories, minimum CoreServices integration/public exports, and focused domain/migration/restart persistence tests. Minimal deterministic title normalization is optional and must remain discovery-only.

## Task checklist

### C1 — Domain contracts and validation (done)
- [x] Add typed catalog contracts and input validation for Game, Release, Edition, Product, platform/distribution, compositions, and mapping states.
- [x] Add behavior-first tests, observe RED before implementation, then GREEN and REFACTOR.
- [x] Fix the composition-pair delimiter collision found by independent verification using an unambiguous key and add a regression test via TDD.
- [x] Commit evidence: initial contract commit `7890df5f0984603eeef4e06ff572574dd1a191e7`; correction commit `3226104e882e118a1ec9d2a440206f9a0df14d56`.
- Evidence: regression test observed RED (1 failed, 4 passed) before implementation; focused suite passed (5 tests, 0 skipped), typecheck passed, Prettier check passed, independent verification and parent `git diff --check` passed. Pair keys use JSON tuple serialization.

### C2 — Migration 002 and relational repositories (done)
- [x] Add only catalog tables/indexes/constraints in migration 002; preserve migration 001 definition and checksum.
- [x] Implement typed repositories with canonical opaque IDs, safe errors, explicit duplicate/upsert semantics, foreign keys, and non-destructive deletes.
- [x] TDD repositories and FK/integrity cases; preserve migration transaction protections.
- [x] Commit evidence: `c52fcf6bafad79c2674dc5a22940f157ed7f7340` (`feat(catalog): persist canonical catalog mappings`).
- Evidence: migration `canonical-catalog` adds the six catalog tables and FK/query indexes. `npm test -- --run tests/catalog.test.ts tests/foundation.test.ts` passed 42 tests, 0 skipped; `npm run typecheck`, Prettier, and `git diff --check` passed. Initial RED covered absent repository/migration; a follow-up RED caught the missing list API. Independent verifier reviewed schema, tests, and safe error boundaries.
- User explicitly authorized `exception-ok` to preserve the originally requested single feature PR and no-merge delivery.

### C3 — Composition root and persistence coverage (done)
- [x] Expose catalog capability minimally through CoreServices and public exports without changing database ownership semantics.
- [x] Add graph persistence/restart, cross-platform identity, composition, and mapping roundtrip tests; include multiprocess migration startup regression.
- [ ] Commit evidence: pending.
- Evidence: strict TDD RED observed (focused suite: 4 failed, 41 passed) before CoreServices integration; GREEN/refactor focused suite passed 45 tests, 0 skipped. Typecheck, Prettier, `git diff --check`, and independent verification passed. Restart reconstructs Game→Release→Edition and distinct PC/PlayStation products, composition, and mapping.

### C4 — Documentation and release validation (in progress)
- [ ] Update README minimally and honestly to describe Foundation + canonical catalog and later capabilities still absent.
- [ ] Run requested local validation, review entire diff for scope/security/integrity issues, commit final work unit, push, create PR with approved labels and issue linkage.
- [ ] Wait for all named hosted checks, inspect automated review comments/threads, address confirmed defects via TDD, and stop before merge.
- [ ] Commit/PR evidence: pending.

## Acceptance criteria
- Canonical identity is internal and opaque; external IDs remain mapping provenance.
- Game → Release → Edition → Product relationships and platform/distribution context are explicit and persisted.
- Composition validates endpoints, positive integer quantity, type, required flag, duplicate behavior, and self-reference.
- Mapping provider identity is unique; all four states roundtrip unambiguously; unmatched can have no Product; definitive identity never silently emerges from ambiguous state.
- Migration 002 applies on clean DB and upgrades 001 without altering migration 001/checksum; checksum drift/future versions/transaction controls remain protected.
- Existing Foundation tests plus catalog tests pass with zero skipped; required npm/security/local checks pass.
- Working tree clean; feature branch pushed to matching origin SHA; open unmerged PR; required hosted checks complete and green; no blocking review findings.

## Verification plan
- Focused tests for every task with strict RED/GREEN/REFACTOR evidence.
- Required final commands: `npm ci`; `npm test -- --run`; `npm run typecheck`; `npm run lint`; `npm run format:check`; `npm run build`; `npm audit --audit-level moderate`; `git diff --check`.
- Specifically verify multiprocess migration, catalog tests, fresh/upgrade/idempotent migration behavior, migration 001 checksum preservation, and file-backed restart persistence.
- Review `git diff main...feat/canonical-catalog` and `git diff --stat main...feat/canonical-catalog` against the user's complete scope exclusions.

## Progress and evidence
- Preflight: `main` and `origin/main` both `4a74678f327ce304fba10b1ccde5ed6a85d30e56`; clean status; active ruleset Protect main ID 24080942.
- Issue #13 created with only existing labels `status:approved` and `type:feature`.
- Feature branch created at the expected baseline SHA.
- Approved architecture sections reread; migration 001 is checksum protected and must remain unchanged.
- C1 initial commit `7890df5f0984603eeef4e06ff572574dd1a191e7`; correction commit `3226104e882e118a1ec9d2a440206f9a0df14d56`. The first independent review found the NUL delimiter collision; regression fixed with strict TDD and independently verified.
- C2 migration/repository commit: `c52fcf6bafad79c2674dc5a22940f157ed7f7340`; focused migration/catalog suite and typecheck/format checks green.
- C2 native review approved and acknowledged; it returned one explicitly non-blocking advisory warning `R3-001` at `src/catalog-repository.ts:244`, retained as a later informational follow-up.
- C3 CoreServices/public API and restart coverage are complete; focused suite 45 passed, 0 skipped; work-unit commit pending.
- Pending: README and full local validation, final commit(s), push, PR, hosted checks, final review.

## Next step
Update README minimally, execute every requested final check, review the complete branch diff, then complete push/PR/hosted checks without merging.