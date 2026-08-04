import path from "node:path";
import { config as loadEnvironmentFile } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma 6 loaded .env implicitly; Prisma 7 does not, so the CLI would not see
// DATABASE_URL from a local .env without this. Deployed environments (Docker,
// CI) inject it directly, where this is a no-op.
loadEnvironmentFile({ quiet: true });

// Prisma 7 moved the datasource URL, migrations directory and seed command out
// of schema.prisma and into this file. It is read by the Prisma CLI only --
// the runtime client gets its connection through the MariaDB driver adapter in
// src/app/configuration/resources/database.ts.
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  datasource: {
    // Read directly rather than via Prisma's `env()` helper, which throws at
    // config load time when the variable is absent. `prisma generate` does not
    // need a database, and it runs in contexts that have no DATABASE_URL (the
    // dependency-audit CI job, Docker image builds). Migration commands still
    // fail loudly if it is missing.
    url: process.env.DATABASE_URL,
  },
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx src/app/scripts/seed.ts",
  },
});
