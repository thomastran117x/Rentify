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
cross-field combinations stop startup.

Repeated non-secret strings can be declared under `variables` and referenced
with `${config.name}`. Variables merge before references resolve, so a profile
or local overlay can replace one origin for every setting that uses it:

```yaml
variables:
  backendOrigin: https://api.example.com

sms:
  webhookPublicUrl: "${config.backendOrigin}/api/v1/sms/webhooks/telnyx"
```

Variable names use lower camel case, values must be literal strings, and
secret-like names are rejected. References cannot be nested. Expressions such
as `${BACKEND_URL}` remain literal; process environment interpolation is not
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
  secrets, `PAYPAL_CLIENT_SECRET`, and `TELNYX_API_KEY`

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

Legacy derived defaults remain intact: a singular `GOOGLE_OAUTH_CLIENT_ID`,
`MICROSOFT_OAUTH_CLIENT_ID`, or `APPLE_OAUTH_CLIENT_ID` is used when no plural
YAML list is configured,
`GMAIL_USER` supplies the sender when `email.fromEmail` is omitted, and an
environment `CORS_ALLOWED_ORIGINS` override also supplies the CSRF origins
unless `CSRF_ALLOWED_ORIGINS` is explicitly set. If startup validation fails
before YAML can be loaded, the fatal logger still honors process-level
`LOG_*` and `RABBITMQ_URL` overrides.

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

## PayPal checkout

The PayPal REST app is configured in three places:

- `paypal.environment` (`sandbox` or `production`), `paypal.clientId`, and
  `paypal.webhookId` in YAML, or `PAYPAL_ENVIRONMENT`, `PAYPAL_CLIENT_ID`, and
  `PAYPAL_WEBHOOK_ID` in the environment
- `PAYPAL_CLIENT_SECRET`, which is environment-only
- `paypal.checkoutMethods`, the payment methods the renter checkout page embeds
  through the PayPal JS SDK

```yaml
paypal:
  checkoutMethods:
    - paypal # PayPal and, where eligible, Pay Later
    - paypal_guest # PayPal's guest debit and credit card form
    - card # Card fields with 3-D Secure; needs advanced card processing
```

`PAYPAL_CHECKOUT_METHODS=paypal,card` overrides the list, and an empty value
turns every embedded method off. Unknown names stop startup, and all three are
enabled by default. The PayPal redirect (`paypal_redirect`) is always available
and is not listed. The API rejects order requests for methods that are not
enabled, and the checkout summary tells the frontend which to show. Apple Pay
and Google Pay are not supported yet.

The frontend needs the same client ID at build time as
`NEXT_PUBLIC_PAYPAL_CLIENT_ID`. The PayPal JS SDK can only approve orders that
the same PayPal app created, so when the frontend value is empty, a
`change-me-` placeholder, or different from the backend's client ID, the
checkout page offers only the PayPal redirect.

The frontend does not send a Content Security Policy today. If one is added, it
must allow the PayPal SDK's scripts, frames, and API calls:
`https://www.paypal.com`, `https://www.sandbox.paypal.com`,
`https://*.paypal.com`, and `https://*.paypalobjects.com`.

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
