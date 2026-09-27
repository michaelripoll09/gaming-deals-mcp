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
- [x] Commit `0a98095109316224f03e14f715651c69b0692dc2` (`feat(catalog): expose catalog through core services`).
- Evidence: strict TDD RED observed (focused suite: 4 failed, 41 passed) before CoreServices integration; GREEN/refactor focused suite passed 45 tests, 0 skipped. Typecheck, Prettier, `git diff --check`, and independent verification passed. Restart reconstructs Game→Release→Edition and distinct PC/PlayStation products, composition, and mapping.

### C4 — Documentation and initial release validation (pending final revalidation)
- [x] Update README minimally and honestly to describe Foundation + canonical catalog and later capabilities still absent.
- [x] Run requested local validation: `npm ci`, full tests (45 passed, 0 skipped), typecheck, lint, format check, build, moderate audit (0 vulnerabilities), and `git diff --check` all pass. Initial lint run found an unused mapping projection alias; a behavior-preserving fix was made and all checks were rerun.
- [x] Review complete branch diff: only README, ODD task record, catalog domain/repository/services, SQLite migration 002, and focused catalog/Foundation tests changed. Diff confirms migration 001 is unchanged; no CI, ruleset, dependencies, provider/network, offers/pricing, wishlist/ownership, MCP/CLI/dashboard/scheduler, or unrelated files changed. Single-PR exception remains authorized.
- [x] C4 implementation commits: `877e45565cd71267cdb2e08dc3e6578a89d6eee8` (`fix(catalog): simplify mapping projection`) and `004e9d5568168cdc9e0ad4dc4a4dabb3f2558699` (`docs(catalog): document implemented catalog scope`).
- [x] Push feature branch and create issue-linked PR #14 to `main` with the single approved type label `type:feature`; PR links approved issue #13.
- [x] Hosted checks completed green at head `c7e3d75b9612a97270264920ad5e2e14c6bbbdba`; PR #14 remains open and unmerged.
- [ ] Re-run all local checks after review fixes and verify all hosted checks/review threads on the updated PR head.
- [ ] Native full-PR review remains blocked at lineage `review-10ad41b8103663df` (`reviewing`/`collect`): grouped and single-slot captures returned unknown/expired/different session route with `mutation_performed: false`; no native reviewer ran or produced a verdict. Do not replay/restart; preserve for manual harness follow-up.
- GitHub Codex review at `7fb817a` reported two actionable P2 findings tracked in C5 and C6 below.

### C5 — Permit explicit ambiguous-to-unmatched mapping demotion (done)
- [x] Add a regression test proving an ambiguous mapping may be explicitly demoted to `unmatched`, clearing its candidate Product ID, while still preventing implicit promotion to `probable` or `verified`.
- [x] Implement the narrow transition via strict TDD and verify identity/state roundtrip.
- [x] Commit `385bed8e88b94891131bc8896ebdd729c11783c3` (`fix(catalog): allow clearing ambiguous mappings`).
- Evidence: RED focused suite 1 failed/45 passed before source change; a first attempted assertion order failed after the intended demotion (the test was corrected to check forbidden promotions before demotion); GREEN 46 passed, 0 skipped. Independent verification passed focused tests, typecheck, lint, and diff-check.

### C6 — Enforce ambiguous-state guard atomically (in progress)
- [x] Add deterministic interleaving regression proving a stale pre-read cannot overwrite a concurrently ambiguous mapping.
- [x] Enforce allowed transitions atomically in SQLite and verify new/duplicate/mapping behavior.
- [ ] Commit evidence: pending.
- Evidence: after correcting a Windows temp-directory cleanup `EPERM`, the pre-implementation RED was `expected function to throw an error, but it didn't`. GREEN focused suite passed 47 tests, 0 skipped; typecheck, lint, diff-check, and independent verification passed.

## Acceptance criteria
- Canonical identity is internal and opaque; external IDs remain mapping provenance.
- Game → Release → Edition → Product relationships and platform/distribution context are explicit and persisted.
- Composition validates endpoints, positive integer quantity, type, required flag, duplicate behavior, and self-reference.
- Mapping provider identity is unique; all four states roundtrip unambiguously; unmatched has no Product; ambiguous mappings can be explicitly cleared to unmatched but never promoted to probable/verified; concurrent writes cannot bypass the ambiguous-state guard.
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
- C3 CoreServices/public API and restart coverage are complete; focused suite 45 passed, 0 skipped; work-unit commit `0a98095109316224f03e14f715651c69b0692dc2`.
- README now documents the implemented foundation/catalog domain and explicitly lists missing future capabilities.
- Full required local validation passed after behavior-preserving lint fix: tests 45/0 skipped; typecheck, lint, format, build, audit (0 vulnerabilities), diff check; `npm ci` passed before source-only cleanup.
- Lint cleanup commit: `877e45565cd71267cdb2e08dc3e6578a89d6eee8` (`fix(catalog): simplify mapping projection`).
- Full branch diff audit passed: only the nine intended README/task/domain/service/persistence/test files changed; migration 001 unchanged and migration 002 is additive.
- C4 commits: lint cleanup `877e45565cd71267cdb2e08dc3e6578a89d6eee8`; README `004e9d5568168cdc9e0ad4dc4a4dabb3f2558699`. Full required local validation passed (45 tests, 0 skipped; typecheck, lint, format, build, audit 0 vulnerabilities, diff-check; npm ci passed before source-only cleanup).
- PR #14 is open/unmerged at hosted-verified head `7fb817a6ab836da7a5fc70a5355889795103b139`, based on `main`, with exactly `type:feature`; issue #13 remains OPEN and `status:approved`.
- PR #14 has all hosted checks green at `c7e3d75b9612a97270264920ad5e2e14c6bbbdba`, but its GitHub Codex review found two P2 mapping defects: ambiguous mappings cannot be cleared to unmatched, and a concurrent write can bypass the ambiguous-state guard. Tracked for C5/C6.
- Native full-PR-slice review is unresolved at lineage `review-10ad41b8103663df`; exact capture bindings repeatedly failed as unknown/expired/different session route, with no reviewer run. Preserve the lineage and do not retry/restart.
- Pending: C5/C6 strict-TDD fixes, rerun local/hosted checks, address review findings, obtain native review closure if harness is repaired, and keep PR open/unmerged.

## Next step
Implement C5 then C6 individually via strict TDD; rerun checks and update PR #14. Preserve the blocked native review lineage without replay/restart; keep PR open and unmerged.