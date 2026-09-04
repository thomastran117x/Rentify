# Architecture Overview

This document is a practical map of how the current Rentify codebase is organized.

## High-Level Shape

Rentify is a modular full-stack application with:

- a `Next.js` frontend in `frontend/`
- an `Express` API in `backend/`
- background workers in `backend/src/app/workers`
- shared local infrastructure through Docker Compose

At runtime, the app typically looks like this:

```text
Browser
  -> Frontend (Next.js, port 3040)
    -> Backend API (/api/v1, port 8040)
      -> MySQL for durable data
      -> Redis for cache and locking
      -> Elasticsearch for search
      -> RabbitMQ for async work
        -> background workers
```

## Frontend Layout

Main frontend areas:

- `frontend/src/app`: Next.js App Router pages and route segments
- `frontend/src/components`: UI components grouped by feature
- `frontend/src/lib`: API clients, env helpers, auth helpers, and feature-specific client logic
- `frontend/tests/e2e`: Playwright end-to-end tests

Key patterns:

- browser requests use `NEXT_PUBLIC_API_BASE_URL`
- server-side requests can use `INTERNAL_API_BASE_URL`
- API helpers expect the backend envelope with `success`, `message`, `data`, `error`, and `meta`
- auth refresh logic is handled in the frontend API client layer

## Backend Layout

Main backend areas:

- `backend/src/app/configuration`: bootstrap, env parsing, container setup, middleware, logging, and route registration
- `backend/src/app/features`: domain modules such as auth, postings, bookings, payments, organizations, rentings, reports, search, and recommendations
- `backend/src/app/workers`: long-running worker entrypoints
- `backend/src/app/seeds`: local fixture orchestration and seed modules
- `backend/prisma`: Prisma schema and migrations
- `backend/openapi`: committed OpenAPI output
- `backend/src/test`: Jest coverage for configuration, features, and integration paths

The backend follows a route-module plus feature-service structure:

- route modules register HTTP endpoints under `/api/v1`
- controllers translate requests into feature calls
- services hold application logic
- repositories handle persistence and query behavior

## Request Caller Identification

Every request is classified by caller so log lines can be split by traffic source. `clientContextMiddleware` resolves a `clientSource` onto `request.client`, and `requestLoggerMiddleware` puts it on the request-scoped logger, so every log line emitted during a request carries it alongside `clientOrigin` and `clientApp`. The HTTP access line also renders it as `src=<value>`.

First-party clients name themselves with an `x-client-app: <app>/<runtime>` header: the Next.js app sends `rentify-web/browser` or `rentify-web/server`, and the MCP server sends `rentify-mcp/server`. Anything else is inferred from `Origin`, `Referer`, `Sec-Fetch-Site`, and the user agent.

| `clientSource` | Caller |
| --- | --- |
| `frontend-browser` | The web app running in a browser |
| `frontend-server` | The web app rendering on the server |
| `api-integration` | Another first-party or partner client that named itself |
| `browser-direct` | A browser hitting the API outside the web app |
| `api-tool` | curl, Postman, Insomnia, and similar |
| `bot` | A crawler |
| `server-side` | A server-to-server call with no browser headers |
| `unknown` | Nothing matched |

The header is an unauthenticated hint and is used for observability only. Authorization, CSRF, and rate limiting never consult it, and the heuristics keep the classification useful for callers that stay silent or lie. Adding a new first-party header also means adding it to `allowedHeaders` in `cors.middleware.ts`, or browser preflight will reject it.

## Current Backend Route Areas

The route registry currently groups the API into these main areas:

- system and health routes
- auth local login/signup/session routes
- auth OAuth routes
- auth device and personal access token routes
- organizations
- profiles and blob upload support
- reports and moderation
- search admin
- owner posting management
- posting analytics, reviews, availability, and activity
- saved postings (renter wishlist)
- saved searches (renter search alerts)
- booking requests
- payments
- rentings
- public posting discovery and detail routes

## Realtime Transport

There are two realtime surfaces, both on **Socket.IO** with the **Redis
adapter** carrying events between API instances, and both mounted outside the
versioned REST prefix:

| Surface | Path | Audience |
| --- | --- | --- |
| Booking request message threads | `/ws/booking-messages` | The two participants of one booking |
| Blog post comments | `/ws/blog-comments` | Anyone reading a published post, signed in or not |

Each gateway is a feature-owned class registered as a singleton with a dispose
hook and **no constructor dependencies**; the feature service depends on the
gateway through a narrow `publish` seam, which is what keeps that edge from
closing a cycle. There is no shared socket infrastructure, deliberately: the two
differ in enough load-bearing ways (below) that a common base would be mostly
branches.

Both attach to the same Node HTTP server. That is safe because Engine.IO
dispatches upgrades by `path` and the two paths are not in a prefix
relationship, so neither claims the other's traffic. Two consequences worth
knowing: each gateway duplicates its own pair of Redis connections (four in
total for realtime), and on the **client** `socket.io-client` caches Managers by
origin rather than by path — a second client on the same origin must pass
`forceNew: true` or it can silently reuse the other gateway's transport.

The booking shape is: one room per thread, plus one room per _side_ of that
thread. Messages go to the thread room; presence is answered by asking whether
the side room has anyone in it. Blog comments have no sides, so there is one
room per post and presence is a **count** rather than a boolean (see below).
All rooms are cluster-wide, because the adapter answers for every instance
rather than just the local one.

Four things are worth knowing before extending either:

- **Deployment requires sticky sessions.** Transports keep Socket.IO's default
  of polling first and upgrading to WebSocket. The polling handshake is several
  HTTP requests that must reach the same instance, so a replicated API behind a
  load balancer needs session affinity configured. Without it the handshake
  fails in a way that looks like a flaky network. Choosing `transports:
["websocket"]` would remove that requirement at the cost of failing outright
  wherever WebSocket upgrades are blocked. Note this now applies to a **public
  marketing page** as well: a misconfigured balancer degrades blog comments in
  front of anonymous visitors, not just one authenticated panel.
- **Authentication is a two-step ticket exchange.** A browser cannot set an
  `authorization` header on this handshake. The client posts to
  `/booking-requests/{id}/messages/socket-ticket` with its bearer token and the
  server replies with a single-use 30-second ticket in an HttpOnly cookie scoped
  to the socket path, which the browser attaches to the handshake. A ticket in
  the query string would land in proxy and access logs instead. Because a ticket
  is single-use, Socket.IO's own reconnection is **disabled** on the client and
  each retry mints a fresh one — reconnecting automatically would replay a
  spent ticket.
- **Authorization happens in the handshake, not after it.** The Socket.IO
  middleware redeems the ticket _and_ resolves the participant's side and write
  capability before the connection is accepted, so someone who lost access in
  the ticket's window never reaches a room.
- **A connection holds no request scope.** Each piece of work creates and
  disposes its own container scope. A socket that pinned one would hold a
  database connection for its entire lifetime.

**Anonymous readers still mint a ticket.** Blog comments admit visitors with no
session, read-only, and the ticket route uses optional rather than required
auth. Skipping the ticket for them would have been simpler and is wrong three
ways: the ticket is what lets the server choose the room, so a client never
names one; it is the only throttle point an anonymous connection passes through,
since the upgrade never reaches Express middleware; and it is where a draft post
is rejected, before any connection exists. An anonymous identity carries no
session, so the periodic sweep checks only the post for those sockets — calling
the token service with a null user would fail closed and disconnect exactly the
readers the surface exists to serve.

**Per-viewer capabilities never enter a broadcast.** `canWrite`, and on blog
comments `viewerCanModerate`, live on the REST list response, not on the
streamed record. A capability computed for whoever triggered a write would be
correct for them and wrong for every other member of the room.

Access is re-checked every 60 seconds on two axes that are easy to conflate.
**Membership** answers whether this user may still read this thread. **The
session** answers whether they are still signed in at all — a logout, a password
change, a token-version bump. Checking only the first leaves a signed-out user
receiving message bodies over a connection that outlives their session while
every REST call they make returns 401, so the ticket records the session that
minted it and the sweep validates both.

**Presence is room membership**, which is worth stating plainly because three
hand-built designs preceded it and each failed a specific way:

- A **flag per user** cannot answer the question actually being asked — "is
  anyone from this organization watching" — without enumerating the members.
- A **tally of one process's sockets** breaks once the API is replicated: each
  instance sees only its own, so the last one to lose a manager announces the
  side offline while a colleague sits connected elsewhere.
- A **shared counter in Redis** fixes that but cannot expire a dead instance's
  share, because any surviving socket refreshing the key renews every
  contribution including the dead one's.

Asking the adapter how many sockets are in a side room avoids all three: a dead
instance's sockets leave the cluster's view on their own, and there is no
separate bookkeeping that can drift from the connections it describes.

**Online is announced on every arrival, not only the first.** Detecting the edge
needs a room count, and that count is an asynchronous cluster round trip — two
sockets joining the same side at once can each observe a size of two, each
conclude it is not the first, and leave the counterpart stuck on offline.
Presence is a state rather than an event, so re-announcing it is idempotent and
race-free. Only the _offline_ transition needs a count, and that one is safe:
an empty room is empty no matter who observed it. A connecting socket is also
told the counterpart's current state directly, since their arrival was announced
before that socket existed.

**Blog comment presence is a count, and the race is different.** The question a
post asks is cardinality — "how many people are reading" — not the boolean a
booking side asks. The transferable part is the principle, not the shape: ask
the adapter, never keep a tally. The unconditional-announce trick above is
_not_ needed here, because a stale observation is only a temporarily wrong
number rather than a stuck state; every later join or leave recounts, so the
last broadcast always reflects settled membership. What is needed instead is
**coalescing**: each recount is a cluster round trip and a popular post can take
dozens of joins a second, so broadcasts are debounced per post with a trailing
edge, which bounds the fan-out rate while still emitting the settled count.

The adapter has to be in place **before** the server accepts anything. Replacing
it on a live server does not migrate the rooms of sockets that already joined
through the in-memory one, so a client connecting during the Redis handshake
would look healthy and silently stop receiving broadcasts. `attach` is
asynchronous for that reason.

Shutdown has to dispose the container before disconnecting Redis: that is what
closes the sockets and lets their rooms empty. Skipping it makes every rollout
look like an abrupt process death to the other party. The gateway also stays
usable _through_ its own close, because the disconnect handlers that run during
it are what publish the final offline presence to the other instances.

## Background Workers

Workers currently cover:

- postings analytics
- booking expiry
- posting expiry and expiry reminders
- saved search alerts
- email delivery
- SMS delivery and webhook processing
- log consumption
- payment retry, repair, and payout release
- posting thumbnail generation
- recommendation activity and precompute
- report search indexing
- search maintenance and indexing
- username availability filter rebuilds

This keeps the API focused on request-response work while heavier or asynchronous processing can be handled off the main server path.

### Saved Search Alerts

A saved search stores the browse filters a visitor asked to be told about, and
the `saved-search-alert-worker` replays them on a schedule.

The replay goes through `PostingsService.searchPublic` — the same call the
browse page makes — rather than a second matching implementation. Geo radius,
availability windows and attribute filters are subtle enough that a parallel
evaluator would drift from the real search within a release or two, and the
visitor would only find out by getting an email about a posting that does not
match.

What counts as a new match is tracked as a set of already-alerted posting ids in
`saved_search_seen_postings`, not as a "published after" cutoff. That is what
lets an unpaused listing, or one that frees up inside the search's date window,
still alert: those postings are not new, but they are new *to this search*.
Creating a search records everything currently matching as already seen, so the
first alert only covers postings that appear afterwards.

Alerts are emailed through the existing RabbitMQ pipeline as a
`saved_search_matches` job carrying ids only, which the composer re-checks at
send time. The sweep enqueues the job *before* it records the matches as seen:
a crash between the two costs a duplicate email, where the other order would
drop the alert silently and the visitor would never learn the posting existed.

Configuration lives in `workers.savedSearchAlert`
(`SAVED_SEARCH_ALERT_POLL_INTERVAL_MS`, `SAVED_SEARCH_ALERT_BATCH_SIZE`,
`SAVED_SEARCH_ALERT_DAILY_INTERVAL_HOURS`). The poll interval doubles as the
`instant` cadence, so the frequency a visitor picks and the rate the worker runs
at cannot disagree.


## Data and Infrastructure Responsibilities

- MySQL: source of truth for product and transactional data
- Redis: cache and concurrency helpers such as booking-related locking, plus the shared username availability bloom filter
- Elasticsearch: search indexes and query acceleration
- RabbitMQ: queue backbone for worker-driven async jobs

### Database Connection Budget

Connection pool size is a per-process cost, not a per-request one. The API and
every worker that touches the database run as separate processes, and each owns
its own pool. Nineteen processes in the Compose stack connect: the API plus
eighteen workers. The SMS and log-consumer workers are queue-only and never open
a database connection. The email worker used to be queue-only too, but the
booking message notification job carries ids rather than a rendered recipient,
so delivery hydrates it from the database at send time.

That makes the arithmetic worth checking before adding a service. The pool holds
`DATABASE_POOL_MINIMUM_IDLE` connections at rest and grows to
`DATABASE_POOL_CONNECTION_LIMIT` under load. Compose gives the API 2/10 and each
worker 1/5, so the stack costs roughly twenty connections idle and
one hundred at its ceiling, against the 250 the local MySQL
container allows. A managed instance is usually stricter — connection caps there
derive from instance size, and a small instance may allow only around 150 — so
adding replicas of the API multiplies this cost rather than sharing it.

Two consequences to keep in mind:

- minimum idle must stay at or above 1; the driver only grows a pool to satisfy
  its minimum-idle target and never to satisfy a queued request, so a value of 0
  leaves every query waiting for the acquire timeout
- connections above the minimum are reaped only after the driver's 30-minute
  idle timeout, so a traffic burst holds its peak for a while before decaying
