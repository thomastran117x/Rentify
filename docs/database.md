# Database, Migrations, and Seeds

MySQL is the durable source of truth. Prisma schema/migrations live in [backend/prisma](../backend/prisma), CLI configuration in [prisma.config.ts](../backend/prisma.config.ts), and seed orchestration in [backend/src/app/seeds](../backend/src/app/seeds). Use Docker Compose for local infrastructure and runtime.

## Connection Targets and Startup

| Caller                                  | Default database URL                         |
| --------------------------------------- | -------------------------------------------- |
| API/workers inside Compose              | `mysql://rent:rent@mysql:3306/rent`          |
| Host-side development tooling           | `mysql://rent:rent@127.0.0.1:3307/rent`      |
| Host-side persistence integration tests | `mysql://rent:rent@127.0.0.1:3307/rent_test` |
| Container-side test migration           | `mysql://rent:rent@mysql:3306/rent_test`     |

These are committed local Compose credentials. `MYSQL_HOST_PORT` changes the published host port, not internal `mysql:3306`. The root `.env.example` URL is intended for containers; do not copy it unchanged into host-side CLI configuration.

Start from the repository root:

```bash
docker compose up --build
```

Compose's `backend-migrate` waits for MySQL and runs `prisma migrate deploy`. The API and database workers wait for successful migration completion. The standalone backend Dockerfile also has a migration startup command, but Compose overrides it and uses its dedicated migration service.

Inspect migration status without resetting data:

```bash
docker compose logs --tail=100 backend-migrate
docker compose exec backend npx prisma migrate status
```

## Changing the Schema

Use Node.js 24+ and npm 11.16+ for host-side tooling. Install locked backend dependencies with `npm --prefix backend ci`; postinstall generates the client. Explicit generation uses the schema and does not need a database connection:

```bash
npm --prefix backend run prisma:generate
```

Migration commands require `DATABASE_URL`. The Prisma CLI reads it directly and loads `backend/.env` when run through backend package scripts. Backend YAML overlays do not supply the CLI datasource URL.

Author migrations against an explicitly selected disposable local development database, using a local migration account able to create/drop Prisma's temporary shadow database. Do not use the shared test schema or production for `migrate dev`. The Compose application account is not a general-purpose shadow-database administrator.

After setting the host-side `DATABASE_URL` for that disposable database, edit the schema and create a named migration:

```bash
npm --prefix backend run prisma:migrate:dev -- --name describe_change
npm --prefix backend run prisma:generate
```

Review SQL for destructive changes, existing-row compatibility, and required backfills. Commit the schema, migration, affected code, tests, and docs together. Do not rewrite applied migrations, substitute `prisma:push` for a committed migration, or accept a reset prompt against valuable data. Apply reviewed migrations through Compose and validate affected persistence paths.

## Seed Modes and Accounts

Development/test profiles enable automatic seeding, subject to startup policy; production startup skips auto-seeding. The empty check means **zero users**, not zero rows in every table. Refresh is a separate option.

With the full stack running:

```bash
docker compose exec backend node dist/scripts/seed.js
docker compose exec backend node dist/scripts/seed.js --only-if-empty
docker compose exec backend node dist/scripts/seed.js --refresh
```

The default applies modules without refresh; `--only-if-empty` skips a populated user table; `--refresh` reapplies fixture-owned records. Refresh can overwrite edits to those records; it is not a database wipe or backup/restore. `database.autoSeedRefresh` controls startup refresh, with `DATABASE_AUTO_SEED_REFRESH` as a legacy override.

Fixture definitions are in [users.ts](../backend/src/app/seeds/fixtures/users.ts). Useful browser accounts all use `Rentify123!`:

| Username     | Email                  | Useful flow                                    |
| ------------ | ---------------------- | ---------------------------------------------- |
| `owner-one`  | `owner1@rentify.local` | Owner and primary-manager organization flows   |
| `renter-one` | `user1@rentify.local`  | Manager organization flows                     |
| `renter-two` | `user2@rentify.local`  | Operator/read-only flows and username cooldown |

Use usernames for username sign-in. Seeded `rentify.local` recipients do not receive real email outside production. MFA bypass and development OTP routes are explained in [local-development.md](./local-development.md).

## Isolated Test Database

Persistence tests truncate/reseed tables, flush Redis database 15, and reset their RabbitMQ/Elasticsearch namespaces. They must not target the application database. Start the stack, then create/grant and explicitly migrate the test schema:

```bash
docker compose exec mysql mysql -uroot -proot -e "CREATE DATABASE IF NOT EXISTS rent_test; GRANT ALL PRIVILEGES ON rent_test.* TO 'rent'@'%'; FLUSH PRIVILEGES;"
docker compose run --rm --no-deps -e DATABASE_URL=mysql://rent:rent@mysql:3306/rent_test backend-migrate npx prisma migrate deploy
```

The integration harness defaults to host MySQL port 3307 and Redis port 6380/database 15. It selects those targets in test support code; exporting arbitrary `DATABASE_URL`/`REDIS_URL` values does not change the defaults. Custom targets require the harness's supported explicit overrides. RabbitMQ/Elasticsearch overrides are in [testing-guide.md](./testing-guide.md).

Seed tests use a different harness: they honor an existing `DATABASE_URL` and otherwise default to the **`rent` application database**. Explicitly select `rent_test`. In Bash:

```bash
DATABASE_URL=mysql://rent:rent@127.0.0.1:3307/rent_test npm --prefix backend run test:db-seeds
```

In PowerShell, restore the process value afterward:

```powershell
$previousDatabaseUrl = $env:DATABASE_URL
try {
    $env:DATABASE_URL = 'mysql://rent:rent@127.0.0.1:3307/rent_test'
    npm --prefix backend run test:db-seeds
} finally {
    $env:DATABASE_URL = $previousDatabaseUrl
}
```

Do not run seed and integration suites concurrently against the same schema. Recreate test data only when intentionally discarding it. `docker compose down` preserves named volumes; `--volumes` deletes persisted database and infrastructure data and is not routine troubleshooting.
