# Backend Configuration

Rentify keeps non-secret backend settings in layered YAML and credentials in
environment variables. The typed configuration manager loads and validates the
complete result once during process startup.

## Load order

Sources are applied from lowest to highest precedence:

1. `backend/config/default.yml`
2. `backend/config/{NODE_ENV}.yml`
3. the optional `BACKEND_CONFIG_FILE` overlay
4. values loaded from `.env`
5. environment variables that already existed in the process

`NODE_ENV` must be `development`, `test`, or `production`. A relative
`BACKEND_CONFIG_FILE` is resolved from `backend/config`; absolute paths are also
accepted. Mappings merge recursively, arrays and scalar values replace earlier
values, and `null` clears an optional scalar. Configuration is not reloaded
while a process is running.

Every configured file must exist and contain valid YAML. Unknown keys, wrong
YAML value types, malformed feature flags, invalid domain values, and invalid
cross-field combinations stop startup. Environment interpolation is not
performed inside YAML.

## What belongs where

Committed YAML contains non-secret behavior and deployment defaults: ports,
public URLs, allowed-origin lists, service hosts, index names, provider choices,
client IDs, worker polling and batch sizes, cache TTLs, logging, route switches,
and feature defaults.

Environment variables remain mandatory for secrets and secret-bearing
connection strings:

- `DATABASE_URL`, `REDIS_URL`, `REDIS_PASSWORD`, `RABBITMQ_URL`,
  `ELASTICSEARCH_PASSWORD`, and `AZURE_STORAGE_CONNECTION_STRING`
- `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`,
  `PERSONAL_ACCESS_TOKEN_SECRET`, and `MFA_TOTP_ENCRYPTION_KEY`
- `GMAIL_APP_PASSWORD`, `CLOUDFLARE_TURNSTILE_SECRET_KEY`, OAuth client
  secrets, `SQUARE_ACCESS_TOKEN`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, and
  `TELNYX_API_KEY`

Never put those keys or their values in a YAML configuration file. The loader
rejects secret-style environment keys because they are not part of the file
schema.

## Overrides

All existing uppercase backend variables remain valid overrides. For example,
this temporarily replaces the YAML logging level without editing a deployment
file:

```bash
LOG_LEVEL=warn
```

For a durable non-secret local customization, create the ignored file
`backend/config/local.yml`:

```yaml
logging:
  level: warn
oauth:
  google:
    clientIds:
      - local-client-id.apps.googleusercontent.com
```

Then set this bootstrap value in `.env`:

```bash
BACKEND_CONFIG_FILE=local.yml
```

Docker copies the config directory into the backend image. Compose uses the
committed development profile by default. YAML records the API pool default as
`10/2`, while Compose deliberately pins the API to `10/2` and each worker to
`5/1` as process-specific deployment overrides.

## Feature flags

Feature defaults use canonical names in YAML:

```yaml
features:
  search-v2:
    enabled: false
```

`FEATURE_SEARCH_V2_ENABLED=true` still overrides that value. Runtime precedence
is database override, environment override, YAML configuration, then the
disabled default. The admin API reports these sources as `db`, `env`, `config`,
or `default`.
