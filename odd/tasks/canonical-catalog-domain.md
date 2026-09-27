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
- Delivery strategy: single feature PR, with coherent work-unit commits; inspect authored PR size and report if review workload becomes excessive.

## Scope
Implement catalog domain types/validation, Game → Release → Edition → Product hierarchy, extensible platform family/variant and stable distribution identifiers, ProductComposition, provider-product mapping states/identity/persistence, SQLite migration 002, small typed repositories, minimum CoreServices integration/public exports, and focused domain/migration/restart persistence tests. Minimal deterministic title normalization is optional and must remain discovery-only.

## Task checklist

### C1 — Domain contracts and validation (done)
- [x] Add typed catalog contracts and input validation for Game, Release, Edition, Product, platform/distribution, compositions, and mapping states.
- [x] Add behavior-first tests, observe RED before implementation, then GREEN and REFACTOR.
- [ ] Commit evidence: pending.
- Evidence: `npm test -- --run tests/catalog.test.ts` — 5 passed, 0 skipped; `npm run typecheck` passed; Prettier check passed. RED was observed on the missing/rejected domain contracts before implementation and again for the follow-up field/error behavior; GREEN and refactor runs passed. Parent spot-check test and `git diff --check` passed.

### C2 — Migration 002 and relational repositories (in progress)
- [ ] Add only catalog tables/indexes/constraints in migration 002; preserve migration 001 definition and checksum.
- [ ] Implement typed repositories with canonical opaque IDs, safe errors, explicit duplicate/upsert semantics, foreign keys, and non-destructive deletes.
- [ ] TDD repositories and FK/integrity cases; preserve migration transaction protections.
- [ ] Commit evidence: pending.

### C3 — Composition root and persistence coverage
- [ ] Expose catalog capability minimally through CoreServices and public exports without changing database ownership semantics.
- [ ] Add graph persistence/restart, cross-platform identity, composition, and mapping roundtrip tests; include multiprocess migration startup regression.
- [ ] Commit evidence: pending.

### C4 — Documentation and release validation
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
- C1 domain contracts completed with behavior-first tests and safe input validation; C1 work-unit commit pending.
- Pending: C2-C4 implementation, full validation, commit(s), push, PR, hosted checks, review.

## Next step
Commit the completed C1 work unit, assess the candidate under the active RDD policy, then implement C2 through one bounded writer.