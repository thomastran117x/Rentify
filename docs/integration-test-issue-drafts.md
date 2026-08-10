# Integration Test Issue Drafts

> **Status: closed.** All six drafts below were implemented directly rather than
> published as issues, so their acceptance criteria are satisfied in the code
> instead of being tracked externally. Kept as the record of the intended scope.

These issue drafts turn the findings in [integration-test-audit.md](./integration-test-audit.md) into implementation-sized work.

## Replace controller-level integration coverage with OpenAPI operation coverage

### Problem

The current `check:controller-integration-coverage` gate reports all 19 registered controllers as covered, but it requires only one representative HTTP request per controller. It does not prove coverage for all 174 OpenAPI method/path operations, and adding a route to an already-covered controller does not fail CI.

The 2026-08-08 audit found 98 operations with explicit integration requests, 7 additional smoke-only operations, and 69 operations with no integration request.

### Scope

- Inventory method/path operations from the committed OpenAPI spec or production route graph.
- Match each operation to an explicit integration test or a small, reviewed exception manifest.
- Report route-contract and real-persistence coverage separately.
- Keep the controller composition check only if it is renamed to describe what it proves.
- Add the operation-level check to CI so a newly added endpoint requires a coverage assignment.

### Acceptance criteria

- [ ] The checker emits every uncovered HTTP method/path and exits non-zero.
- [ ] Tests cover static, parameterized, and query-bearing request matching.
- [ ] Generic controller smoke probes do not count as endpoint behavior coverage.
- [ ] Route-contract and persistence coverage are distinguishable in output.
- [ ] CI runs the check against the committed OpenAPI artifacts.
- [ ] Testing documentation explains coverage levels and the exception process.

## Make the persistence integration harness reliable locally and in CI

### Problem

With `docker compose up --build -d`, a migrated `rent_test` schema, and all services healthy, `npm --prefix backend run test:integration` fails during persistence-suite setup. Eight suites and 27 tests fail because RabbitMQ rejects the generated `rent-test-*` vhosts as missing; only the live-infrastructure safety suite passes.

This makes the most valuable workflow tests unreliable as a development and CI gate.

### Scope

- Reproduce and fix the RabbitMQ test-vhost create/connect/purge/delete lifecycle.
- Make setup wait for usable AMQP permissions rather than only a successful management response.
- Ensure one suite cannot delete or reuse another suite's vhost.
- Add actionable setup diagnostics without logging secrets.
- Document creation/migration of the isolated `rent_test` schema for local runs.

### Acceptance criteria

- [ ] A focused test creates a unique vhost, opens AMQP, publishes/reads or purges a message, and deletes the vhost.
- [ ] Repeated and sequential suite runs do not leak or race vhosts.
- [ ] The full persistence suite passes from the documented Compose workflow.
- [ ] Failure output includes the safe test vhost name and failed lifecycle phase.
- [ ] Local and CI instructions use equivalent infrastructure assumptions.

## Add complete authentication and MFA integration workflows

### Problem

The auth persistence suite verifies signup and creates a user, but it never logs in as that new account. Login/logout uses a seeded account. Password changes use a synthesized authenticated context and do not prove the new password works. Several auth and MFA operations lack explicit HTTP integration requests.

### Scope

- Add signup -> email verification -> login -> protected request -> refresh -> logout/revocation.
- Add forgot/reset password -> old password rejected -> new password accepted.
- Add real login -> password change -> intended session invalidation -> new password accepted.
- Add TOTP begin/status/confirm/login challenge/disable/cancel workflows.
- Cover local session verification and Microsoft OAuth route behavior at the appropriate route-contract level.
- Consolidate typed cookie, OTP, login, and authenticated-request helpers.

### Acceptance criteria

- [ ] A newly created and verified account can log in through `POST /auth/local/login`.
- [ ] Refresh and logout assertions use tokens/cookies returned by preceding HTTP calls.
- [ ] Password reset/change tests assert both rejection of the old password and acceptance of the new password.
- [ ] MFA enrollment is observed by a subsequent login and verification flow.
- [ ] Authentication state is synthesized only where authentication is incidental to the scenario.
- [ ] Missing auth/MFA method/path operations have explicit tests or documented exceptions.

## Add organization endpoint and lifecycle integration coverage

### Problem

Only 12 of 36 organization operations have explicit integration requests, with one additional generic smoke probe. Twenty-three organization operations have no integration request, including workspace, slug resolution/update, invite preview, audit restore, blog/announcement mutation, and organization review lifecycle routes.

### Scope

- Cover list/my/active/workspace/public detail and slug resolution/update.
- Extend invitation coverage with preview and unauthorized/expired behavior.
- Cover audit listing and restore with version/concurrency expectations.
- Complete announcement and blog post list/update/delete workflows.
- Add organization review create/read/update/delete/reply workflows.
- Exercise owner, primary manager, manager, operator, read-only member, non-member, and anonymous boundaries where relevant.

### Acceptance criteria

- [ ] Every organization OpenAPI operation has explicit HTTP route coverage or a documented exception.
- [ ] State-changing operations assert persisted state through a later HTTP read where practical.
- [ ] Role restrictions are asserted at the API boundary and no forbidden mutation is persisted.
- [ ] Slug, invitation, audit, content, and review flows include at least one negative case.
- [ ] Tests use shared typed organization scenario fixtures without coupling cases through global state.

## Add marketplace, booking, payment, renting, and moderation integration coverage

### Problem

The write-oriented persistence workflows are a strong base, but many read and cross-domain operations are missing: public/owner posting queries and analytics, quote/dashboard/detail/cancellation views, payment detail and payouts, renting detail, and moderation list/detail.

### Scope

- Cover posting public search/detail/batch, owner lists/summary/batch, availability/pricing/reviews reads, activity capture, and analytics.
- Cover booking quote, posting booking list, renter/owner lists and dashboards, detail, and cancellation quote.
- Cover payment-by-id and payout listing with authorization boundaries.
- Cover renting list/detail and moderation report list/detail.
- Build at least one coherent marketplace workflow from owner posting creation through renter review.

### Acceptance criteria

- [ ] Every affected OpenAPI operation has explicit HTTP route coverage or a documented exception.
- [ ] One workflow covers publish -> public discovery -> quote/request -> approve -> payment -> renting -> return/review.
- [ ] List/detail/dashboard results reflect writes made earlier in the same scenario.
- [ ] Owner, renter, organization member, stranger, moderator, and admin boundaries are asserted where applicable.
- [ ] Search/analytics side effects use deterministic queues or indexes and do not rely on arbitrary sleeps.

## Refactor integration tests around domain fixtures and scenario helpers

### Problem

Several integration tests bundle many unrelated endpoint calls into one case, use broad `as any` casts or generic service proxies, and duplicate request/auth setup. `misc.routes.integration.test.ts` mixes three domains, while Jest script/config names do not clearly distinguish route-contract and persistence suites.

### Scope

- Split oversized cases into focused scenarios without losing cross-endpoint workflows.
- Move blob, profile, and admin-search tests into domain-owned files.
- Introduce typed builders for requests, auth headers/cookies, responses, and seeded scenario lookup.
- Replace generic proxies and avoidable `as any` casts with explicit typed stubs.
- Clarify Jest config and npm script names for route-contract, persistence, and all-integration runs.
- Preserve negative authorization/validation cases beside their success paths.

### Acceptance criteria

- [ ] A failing endpoint produces a focused test name and does not hide unrelated endpoint assertions.
- [ ] Shared helpers are typed, narrowly scoped, and tested where they contain logic.
- [ ] Domain integration files own their production controller/service setup.
- [ ] No all-purpose service proxy is used as evidence of endpoint behavior coverage.
- [ ] Script/config names and `docs/testing-guide.md` clearly identify infrastructure requirements and suite boundaries.
- [ ] Existing route-contract and persistence behavior remains covered during the refactor.
