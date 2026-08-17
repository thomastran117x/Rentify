# Username Availability Bloom Filter

## The problem

`GET /auth/username/available` used to cost a MySQL query per call. The signup
form debounces at 400ms and the rate limiter allows 60 checks a minute per IP, so
a single visitor deciding on a name could be worth dozens of round trips to the
source of truth for a question whose answer is "it's free" almost every time.

A second, worse offender read the same column. `generateAvailableUsername` walked
`john`, `john2`, `john3`… probing each one, so a popular email local part could
spend up to 25 sequential queries inside one OAuth signup.

## Why a bloom filter fits

A bloom filter is a bit array plus `k` hash functions. Adding a value sets `k`
bits; testing one checks those same bits. It gives an asymmetric answer, and the
asymmetry is exactly the right way round here:

| Filter says   | Means                         | What the endpoint does                   |
| ------------- | ----------------------------- | ---------------------------------------- |
| any bit clear | **definitely** not in the set | answer "available", skip MySQL           |
| all bits set  | _maybe_ in the set            | fall through to the authoritative lookup |

A false positive costs one query and still returns the correct verdict. There are
no false negatives _by construction_ — you cannot clear a bit by adding more
values. That reduces the entire correctness problem to one question: **has the
filter actually seen every taken name?** Most of this design is about answering
yes, and about failing safe when the answer is "not sure".

The filter is sized for 200,000 usernames at a 1% target rate, which works out to
1,917,016 bits — about **234 KB** — and 7 probes per lookup. The rate is a
performance dial, not a correctness one: exceeding capacity means more fall-through
queries, never a wrong answer.

## Shape

```
                 ┌──────────────── API instance ────────────────┐
  GET /available │  L1: in-process Uint8Array   → 0 RTT         │
                 │      bit clear ──────────────→ AVAILABLE     │
                 │      bits set / not ready ───→ MySQL + Redis │
                 └──────────────────────────────────────────────┘
                        ▲ reload (60s, and on generation bump)
                        │ SUBSCRIBE :events
  ┌─────────────────── Redis ────────────────────┐
  │ :bits    bitmap (~234 KB)   ← source of truth│
  │ :meta    {generation, builtAt, count}        │
  │ :events  pub/sub channel                     │
  └──────────────────────────────────────────────┘
                        ▲ full rebuild every 6h
              ┌─── username-bloom-worker ────┐
              │ scan profiles + reservations │
              └──────────────────────────────┘
```

L1 is what makes a check free — no network at all on the fast path. L2 is what
makes L1 _correct_ across more than one process.

## Keeping the local copy honest

Three mechanisms, each covering the previous one's blind spot:

- **Write-through.** Every path that claims a name calls `add`, which sets the
  local bits first, then the Redis bits, then publishes. The instance that
  handled the claim is correct immediately.
- **Pub/sub.** Siblings receive the name and set their own bits within a round
  trip.
- **Periodic reload.** Redis pub/sub is at-most-once, so a subscriber that was
  reconnecting simply misses messages. Re-reading the shared bitmap every 60
  seconds heals that.

On top sits a **readiness and freshness gate**, because the failure this design
cannot tolerate is answering "definitely absent" out of a bit array that merely
_looks_ empty:

- No metadata in Redis means no rebuild has ever completed. The filter reports
  `unknown` and every check goes to MySQL — which is exactly the behaviour this
  feature replaced, so a fresh deployment degrades to correct-but-slower rather
  than fast-and-wrong.
- Metadata present but the bitmap key missing is treated the same way.
- A copy older than `USERNAME_BLOOM_MAX_STALENESS_MS` also reports `unknown`, so
  a wedged subscriber falls back instead of serving stale confidence. This is why
  max staleness must exceed the reload interval; the environment parser rejects
  configurations where it does not.
- A stored bitmap whose length disagrees with the configured sizing is refused
  outright. Reading it with the current parameters would misplace every probe,
  which is the one way this design could manufacture a false negative.

## Two orderings that are load-bearing

**Metadata is read before the bitmap.** The other order lets a rebuild landing
mid-reload pair a _new_ generation number with the _old_ bitmap, leaving the
instance convinced it is current and never reloading again. In the order used,
the mismatch resolves harmlessly: one redundant reload on the next tick.

**A rebuild's replay list is written before the live bit.** During a rebuild,
`add` pushes the name onto a replay list and only then sets the live bit. Let
`P` be reading the shadow pointer, `R` the replay push, `S` the live write, and
let the rebuild do `N` (rename), `D` (delete pointer), `L` (final replay read),
with `P < R < S` and `N < D < L`. If `R ≤ L` the rebuild replays the name. If
`R > L` then `S > L > N`, so the live write lands _after_ the swap and the bit is
on the new bitmap. Either way the name survives, with no window in between.

## What a rebuild is for

Write-through can add but never remove — a bloom filter has no delete. Renamed-away
names and expired signup reservations therefore accumulate as permanent false
positives, each costing a query it should not have needed. The worker rebuilds
from the source of truth on an interval, which is the only mechanism that sheds
them.

It builds the bitmap in a local buffer while keyset-paginating the `profiles`
table, then writes it with a single `SET` rather than millions of `BITFIELD`s,
then swaps it in with `RENAME`. The generation counter in `:meta` increments, and
the announcement on `:events` tells every instance to adopt the new bitmap
instead of merging into the old one.

This is also why the service's re-apply set is scoped to writes that are still
_in flight_ rather than "everything added recently": holding on to settled adds
would make the rebuild unable to drop anything.

**Unverified signup reservations are included.** A pending signup soft-reserves
its name in Redis rather than in a row (see
[pending-signup-username.ts](../backend/src/app/features/auth/pending-signup-username.ts)),
and a filter miss skips the reservation lookup as well as the database one.
Leaving them out would let the endpoint report a reserved name as free.

## Where the filter is and is not used

| Caller                                 | Uses the filter | Why                                                                     |
| -------------------------------------- | --------------- | ----------------------------------------------------------------------- |
| `GET /auth/username/available`         | yes             | the hot path; a wrong-but-safe answer costs a query                     |
| `generateAvailableUsername`            | to skip probes  | screened-out candidates cost nothing; the chosen one is still confirmed |
| `assertUsernameIsAvailable`            | **no**          | write path — a clear error beats a later constraint violation           |
| profile rename guard, `P2002` handling | **no**          | the database remains the only arbiter of uniqueness                     |

The screening predicate is deliberately `isLikelyTaken` rather than
`isDefinitelyAvailable`. An "I do not know" answer has to read as _false_, or an
unavailable filter would skip every candidate and push every new OAuth user onto
the random-suffix fallback.

## Binary reads are not optional

`client.get` decodes a reply as UTF-8, which rewrites every byte above `0x7F` — a
bitmap byte of `0x81` comes back as `0xFD`. Those flipped bits are exactly a
false negative. All bitmap reads go through a `Buffer` type mapping
(`withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer })`), and writes pass a raw
`Buffer`.

Relatedly, the bit layout is most-significant-bit-first within each byte, so bit
0 is the top bit of byte 0 — matching how Redis addresses `SETBIT` offsets. A
short buffer from Redis is normal rather than an error: Redis grows a bitmap only
as far as its highest set bit, so a sparse filter comes back truncated and the
missing tail is all zeroes.

## Configuration

All tunable through the environment; see [.env.example](../.env.example).

| Variable                             | Default    | Notes                                                     |
| ------------------------------------ | ---------- | --------------------------------------------------------- |
| `USERNAME_BLOOM_ENABLED`             | `true`     | kill switch; `false` restores the pure-database behaviour |
| `USERNAME_BLOOM_CAPACITY`            | `200000`   | usernames the bitmap is sized for                         |
| `USERNAME_BLOOM_FALSE_POSITIVE_RATE` | `0.01`     | target rate at capacity                                   |
| `USERNAME_BLOOM_RELOAD_INTERVAL_MS`  | `60000`    | how often each instance re-reads the bitmap               |
| `USERNAME_BLOOM_MAX_STALENESS_MS`    | `300000`   | must exceed the reload interval                           |
| `USERNAME_BLOOM_REBUILD_INTERVAL_MS` | `21600000` | 6 hours                                                   |
| `USERNAME_BLOOM_REBUILD_BATCH_SIZE`  | `5000`     | rows per keyset page                                      |
| `USERNAME_BLOOM_REBUILD_LOCK_TTL_MS` | `60000`    | extended after each page                                  |

Capacity and target rate are hashed into a fingerprint that namespaces every
Redis key, so changing either lands on a fresh, empty bitmap rather than
misreading one built for different sizing. The filter reports `unknown` until the
worker rebuilds under the new key.

The worker logs a warning when the measured saturation exceeds twice the target
rate, which is the signal to raise `USERNAME_BLOOM_CAPACITY`.

## Files

| Path                                                        | Role                                              |
| ----------------------------------------------------------- | ------------------------------------------------- |
| `features/auth/username-bloom/bloom-parameters.ts`          | sizing math and the key fingerprint               |
| `features/auth/username-bloom/bloom-hash.ts`                | bit-index derivation                              |
| `features/auth/username-bloom/local-bloom-filter.ts`        | the L1 bit array                                  |
| `features/auth/username-bloom/username-bloom.service.ts`    | L1 + L2 orchestration, the readiness gate         |
| `features/auth/username-bloom/username-bloom.store.ts`      | Redis gateway (binary reads, bit writes, pub/sub) |
| `features/auth/username-bloom/username-bloom-rebuild.ts`    | rebuild logic                                     |
| `features/auth/username-bloom/username-bloom.repository.ts` | keyset scan of `profiles`                         |
| `workers/auth/username-bloom.worker.ts`                     | thin polling shell around the rebuild             |

The rebuild logic lives in the feature folder rather than the worker entrypoint
because `jest.unit.config.cjs` excludes `workers/` from coverage.

## Operating notes

- **Disabling it is safe at any time.** Set `USERNAME_BLOOM_ENABLED=false` and
  restart; every check goes back to the database.
- **A missing bitmap is safe.** Deleting the Redis keys makes every instance
  report `unknown` until the worker rebuilds.
- **Cross-instance propagation cannot be exercised through Compose as written**,
  because the `backend` service sets `container_name` and binds a host port, so
  `--scale backend=2` fails. That axis is covered by
  `username-bloom.integration.test.ts`, which runs two service instances against
  one Redis.
