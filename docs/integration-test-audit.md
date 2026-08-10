# Backend HTTP Integration Test Audit

> **Status: closed.** Every item in the backlog below has been implemented. The
> figures in this document describe the state at the audit date and are kept as
> the record of why the work was done; they are no longer current.
>
> Where things landed:
>
> - All 174 OpenAPI operations now have an explicit integration test. The
>   generic controller smoke table has been deleted, and `check:openapi-operation-coverage`
>   enforces per-operation coverage in CI.
> - The persistence suite runs reliably from the Compose workflow. Its failure
>   was not the vhost lifecycle this audit suspected: RabbitMQ was the only
>   service published on default host ports, so the management API and the AMQP
>   endpoint could resolve to two different brokers.
> - Account, password, and MFA workflows verify their outcomes through later
>   HTTP calls rather than synthesized authentication contexts.
>
> See [testing-guide.md](./testing-guide.md) for how the suites are organized
> and how the coverage gate works today.

Audit date: 2026-08-08  
Audited branch: `auth-workflow` at `89db988`

## Executive summary

The backend does not currently have an integration test for every HTTP endpoint.

The committed OpenAPI document defines 174 method/path operations. Comparing those operations with `app.request(...)` calls in `*.integration.test.ts` found:

- 98 operations with an explicit method/path request in a route or persistence integration test
- 7 additional operations touched only by the generic registered-controller smoke table
- 69 operations with no request in the integration suite
- 56 operations exercised through the real-persistence harness
- 19 of 19 registered controllers accepted by the current controller coverage check

The last result is not endpoint coverage. The checker accepts a controller when one test instantiates it, mounts production routes, and makes any HTTP request. A controller with many untested routes therefore still passes.

The persistence tests contain several useful multi-step workflows, but the account lifecycle is incomplete: signup and email verification create a real user, while a separate seeded user is used for login/logout. There is no test proving that the newly created account can log in. The password-change test similarly creates an authenticated context directly instead of proving that the new password works through the login endpoint.

The real-persistence suite is also not presently a reliable local gate. With the Compose stack running and an isolated, migrated `rent_test` schema, 8 persistence suites failed during setup because RabbitMQ rejected connections to generated `rent-test-*` vhosts that were missing at connection time. Only the live-infrastructure safety suite passed.

## Scope and measurement

The OpenAPI operations in `backend/openapi/openapi.json` are the endpoint inventory. An operation is counted as explicitly covered only when an integration test makes an identifiable request using the same HTTP method and a matching path.

The three coverage levels used in this audit are:

1. **Explicit HTTP coverage**: a route or persistence integration test requests the operation and makes endpoint-specific assertions.
2. **Smoke-only coverage**: `registered-controllers.routes.integration.test.ts` requests one representative route for a controller and asserts only that the response is not 404 and is below 500.
3. **Persistence coverage**: a test uses `createPersistenceTestApp`, production application composition, and live backing services while asserting stored state or a cross-endpoint outcome.

Direct controller unit tests, route-registration tests, frontend Playwright tests, and HTTP calls in files outside the integration suite were not counted. They provide useful coverage, but they do not answer whether the backend integration suite exercises every endpoint.

## Coverage by OpenAPI tag

| Tag | Operations | Explicit HTTP | Smoke-only additions | Persistence |
| --- | ---: | ---: | ---: | ---: |
| admin-search | 15 | 5 | 2 | 0 |
| auth | 23 | 21 | 0 | 5 |
| blob | 4 | 4 | 0 | 0 |
| booking-requests | 13 | 5 | 1 | 5 |
| feature-flags | 3 | 0 | 1 | 0 |
| feedback | 1 | 1 | 0 | 1 |
| mfa | 9 | 6 | 0 | 0 |
| moderation | 5 | 3 | 0 | 3 |
| organizations | 36 | 12 | 1 | 12 |
| payments | 9 | 7 | 0 | 7 |
| personal-access-tokens | 3 | 3 | 0 | 2 |
| postings | 37 | 22 | 0 | 15 |
| profiles | 3 | 3 | 0 | 0 |
| rentings | 8 | 6 | 1 | 6 |
| sms | 1 | 0 | 1 | 0 |
| system | 4 | 0 | 0 | 0 |
| **Total** | **174** | **98** | **7** | **56** |

Smoke-only additions are not included in the explicit HTTP column.

## Existing persistence workflows

The current suite has a solid starting set of workflow-oriented tests:

| Domain | Workflow currently exercised | Important limitation |
| --- | --- | --- |
| Auth | signup -> queued verification email -> email verification -> user/profile persisted | Does not log in as the created user |
| Auth | seeded-user login -> session and cookies created -> logout -> session revoked | Starts from seed data rather than account creation |
| Auth/PAT | direct authenticated context -> password change -> PAT creation -> PAT revocation | Does not log in with the new password; list/read behavior is not persisted |
| Organizations | create organization -> creator becomes active primary manager | Authentication context is synthesized |
| Organizations | invite -> accept -> change role -> remove member -> revoke another invite | Good cross-endpoint persistence flow; missing preview/list/workspace checks |
| Organizations | create/list announcement and create/publish/read blog post | Update/delete and audit restore are absent |
| Bookings | create request -> update -> cancel | Read/list/dashboard/quote checks are absent |
| Bookings | create requests -> owner approve/decline | Conversion is covered separately in rentings |
| Payments | create session -> retry; refund/reconcile/webhook/repair | Payment-by-id and payout listing are absent |
| Postings | create -> update -> duplicate -> publish/pause/unpause/archive | Public/owner reads and analytics are largely absent |
| Postings | availability block and seasonal-price create/update/delete; review create/update | List/calendar/review read coverage is incomplete |
| Rentings | booking conversion -> renting lifecycle -> dispute | Renting list/detail reads are absent or smoke-only |
| Reports | create report -> assign -> change status | Moderation list/detail reads are absent |
| Feedback | anonymous/authenticated creation and failed captcha non-persistence | Complete for the single operation |

## Priority workflow gaps

1. **Complete account lifecycle**: signup -> obtain verification OTP -> verify email -> login with the new username/password -> call a protected endpoint -> refresh -> logout -> prove refresh/session revocation.
2. **Password recovery lifecycle**: forgot password -> obtain OTP -> reset password -> old password rejected -> new password accepted.
3. **Password change lifecycle**: real login -> change password -> existing sessions invalidated as intended -> old password rejected -> new password accepted.
4. **MFA lifecycle**: login -> begin TOTP -> confirm -> encounter MFA requirement on a new login -> challenge/confirm -> disable/cancel behavior.
5. **Organization lifecycle**: create -> resolve by slug -> workspace/list/active organization -> invite preview/accept -> audit and restore -> announcement/blog/review update and delete.
6. **Marketplace lifecycle**: owner creates and publishes a posting -> public search/detail -> renter quote/request -> owner dashboard/approve -> payment -> convert to renting -> check-in/return -> reviews and payouts.
7. **Authorization matrices**: verify anonymous, renter, organization role, owner, moderator, admin, and PAT behavior at both success and forbidden boundaries without manufacturing auth state when a real login is material to the behavior.

## Integration operations with no request

These 69 OpenAPI operations are not requested by any current integration test. The seven controller-smoke-only operations are listed separately afterward.

### System

- `GET /`
- `GET /health`
- `GET /openapi.yaml`
- `GET /openapi.json`

### Auth and MFA

- `POST /auth/local/verify`
- `POST /auth/oauth/microsoft`
- `GET /auth/mfa/totp/status`
- `POST /auth/mfa/totp/confirm`
- `DELETE /auth/mfa/totp/pending`

### Organizations

- `GET /organizations/me`
- `POST /organizations/me/active`
- `GET /organizations/invitations/{token}`
- `GET /organizations/{id}/workspace`
- `GET /organizations/by-slug/{slug}`
- `GET /organizations/{id}`
- `PATCH /organizations/{id}/slug`
- `GET /organizations/{id}/audit`
- `POST /organizations/{id}/audit/{auditId}/restore`
- `PATCH /organizations/{id}/announcements/{announcementId}`
- `DELETE /organizations/{id}/announcements/{announcementId}`
- `GET /blog`
- `GET /organizations/{id}/blog-posts`
- `PATCH /organizations/{id}/blog-posts/{blogPostId}`
- `DELETE /organizations/{id}/blog-posts/{blogPostId}`
- `GET /organizations/{id}/reviews`
- `POST /organizations/{id}/reviews`
- `GET /organizations/{id}/reviews/me`
- `PUT /organizations/{id}/reviews/me`
- `DELETE /organizations/{id}/reviews/me`
- `PUT /organizations/{id}/reviews/{reviewId}/reply`
- `DELETE /organizations/{id}/reviews/{reviewId}/reply`
- `DELETE /organizations/{id}/reviews/{reviewId}`

### Admin search and feature flags

- `GET /admin/organizations/search/reindex-runs/{id}`
- `GET /admin/organizations/search/status`
- `POST /admin/organizations/search/outbox/replay-dead-lettered`
- `POST /admin/organizations/search/cleanup-retained-indices`
- `GET /admin/organizations/blog-search/reindex-runs/{id}`
- `GET /admin/organizations/blog-search/status`
- `POST /admin/organizations/blog-search/outbox/replay-dead-lettered`
- `POST /admin/organizations/blog-search/cleanup-retained-indices`
- `PUT /admin/feature-flags/{name}`
- `DELETE /admin/feature-flags/{name}`

### Postings and moderation

- `GET /postings`
- `GET /postings/me`
- `GET /postings/me/summary`
- `GET /postings/me/batch`
- `GET /postings/analytics/summary`
- `GET /postings/analytics/postings`
- `GET /postings/analytics/export`
- `GET /postings/{id}/analytics`
- `GET /postings/{id}/reviews`
- `GET /postings/{id}/reviews/me`
- `GET /postings/{id}/availability-calendar`
- `GET /postings/{id}/availability-blocks`
- `GET /postings/{id}/seasonal-pricing`
- `POST /postings/{id}/activity/search-click`
- `GET /postings/batch`
- `GET /moderation/reports`
- `GET /moderation/reports/{id}`

### Booking requests, payments, and rentings

- `GET /postings/{id}/booking-requests`
- `POST /postings/{id}/booking-quote`
- `GET /booking-requests/owner`
- `GET /booking-requests/me/dashboard`
- `GET /booking-requests/owner/dashboard`
- `GET /booking-requests/{id}`
- `GET /booking-requests/{id}/cancellation-quote`
- `GET /payments/{id}`
- `GET /payouts/me`
- `GET /rentings/{id}`

### Controller-smoke-only operations

These seven operations are requested only by the generic controller table, with no endpoint-specific response or collaborator assertion:

- `GET /organizations`
- `POST /admin/organizations/search/reindex`
- `POST /admin/organizations/blog-search/reindex`
- `GET /admin/feature-flags`
- `GET /booking-requests/me`
- `GET /rentings/me`
- `POST /sms/webhooks/telnyx`

## Test harness and refactoring findings

### Coverage enforcement

- `check-controller-integration-coverage.ts` measures controller presence, not operation coverage. Its success message can be mistaken for complete HTTP coverage.
- The check does not derive operations from OpenAPI or route modules, does not match method/path pairs, and does not distinguish endpoint assertions from the generic smoke test.
- New endpoints on an already-covered controller do not create a failing gate.

### Test organization

- Several tests combine many unrelated endpoint calls in one `it`, so one early failure hides later endpoint results and failures are harder to locate.
- `registered-controllers.routes.integration.test.ts` uses an all-purpose `Proxy` service and broad `as any` casts. It proves composition at a shallow level and should not be presented as behavior coverage.
- `misc.routes.integration.test.ts` groups blob, profile, and admin-search domains, obscuring ownership and setup reuse.
- Auth route setup and token/cookie/request helpers are duplicated across route and persistence tests.
- `createAuthenticatedRequestContext` is useful for tests where authentication is incidental, but it bypasses login and can accidentally replace the workflow being tested.
- The `test:integration:routes` script is an alias of `test:integration:mocked`, while `jest.persistence.integration.config.cjs` is only an alias of `jest.integration.config.cjs`. Names do not clearly communicate route-contract versus live-persistence responsibilities.

### Runtime reliability

- `docker compose up --build -d` brought all required services up and the test schema migrated successfully.
- `npm --prefix backend run test:integration:mocked` passed: 7 suites, 43 tests.
- `npm --prefix backend run check:controller-integration-coverage` passed: 19 registered controllers.
- `npm --prefix backend run test:integration` failed: 8 suites/27 tests failed during RabbitMQ connection setup, while 1 suite/2 tests passed.
- RabbitMQ reported each generated `rent-test-*` vhost as missing. The persistence harness creates a vhost through the management API before opening AMQP and deletes it during teardown, so creation/readiness/cleanup ordering needs investigation and a regression test.

## Recommended issue backlog

Ready-to-publish issue bodies and acceptance criteria are in [integration-test-issue-drafts.md](./integration-test-issue-drafts.md).

### 1. Replace controller-level coverage with OpenAPI operation coverage

Build a deterministic checker that inventories every OpenAPI method/path, recognizes explicit integration requests or a small committed manifest, reports coverage level, and fails when a new operation lacks an assigned integration test. Keep the controller composition check separately named if it remains useful.

### 2. Make the persistence integration harness reliable locally and in CI

Fix RabbitMQ test-vhost lifecycle behavior, add a focused live-infrastructure readiness test that creates/connects/purges/deletes a vhost, document creation of `rent_test`, and make failures report the generated infrastructure targets clearly.

### 3. Add complete authentication and MFA workflows

Add the account, password recovery/change, refresh/logout, OAuth Microsoft, local verify, and TOTP workflows described above. Use real login for authentication outcomes and direct authenticated contexts only when auth is incidental.

### 4. Add organization endpoint and lifecycle integration coverage

Cover the 23 unrequested organization operations plus the smoke-only organization list route, prioritizing slug/workspace/invitation/audit and content/review CRUD workflows with role enforcement.

### 5. Add marketplace, booking, payment, renting, and moderation coverage

Cover the missing public/owner reads, analytics, quote/dashboard/detail/cancellation, payment/payout, renting detail, and moderation list/detail operations as coherent cross-domain workflows.

### 6. Refactor the integration suite around domain fixtures and scenario helpers

Split oversized tests by scenario, move `misc` tests to domain-owned files, introduce typed request/auth/response helpers, reduce `as any` and generic proxies, clarify Jest config/script naming, and retain negative authorization and validation cases beside each success scenario.

## Target acceptance standard

The backlog is complete when:

- every committed OpenAPI operation is assigned an explicit HTTP integration test or a documented exception
- all operations have at least route-contract coverage for success or intended rejection
- state-changing and security-sensitive operations have real-persistence coverage
- high-value user journeys validate outputs through later HTTP endpoints, not only direct database inspection
- the full persistence suite starts from the documented Compose workflow and passes reliably
- CI fails when an endpoint is added without an integration coverage assignment
