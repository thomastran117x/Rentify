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

The default CORS and CSRF allow-lists trust the local frontend at both
`http://localhost:3040` and `http://127.0.0.1:3040`, so browsers and automation
can use either loopback hostname. Runtime origin handling also expands a
configured `localhost` or `127.0.0.1` origin to its other spelling while
preserving the configured scheme and port.

Environment variables remain mandatory for secrets and secret-bearing
connection strings:

- `DATABASE_URL`, `REDIS_URL`, `REDIS_PASSWORD`, `RABBITMQ_URL`,
  `ELASTICSEARCH_PASSWORD`, and `AZURE_STORAGE_CONNECTION_STRING`
- access-token signing credentials: `ACCESS_TOKEN_SECRET` for the default
  `HS256` algorithm, or `ACCESS_TOKEN_PRIVATE_KEY` and
  `ACCESS_TOKEN_PUBLIC_KEY` for `RS256`
- `REFRESH_TOKEN_SECRET`, `PERSONAL_ACCESS_TOKEN_SECRET`, and
  `MFA_TOTP_ENCRYPTION_KEY`
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

A level above `info` also drops the media pipeline's metrics, which are logged
at `info` as `media.metric` events, and with them the alerts in the
[media worker guide](../backend/src/app/workers/media/README.md#metrics-and-alerts).
The API and the media workers log `Media metrics are disabled` at startup when
the level suppresses them.

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

## Access-token signing

Access JWTs use `HS256` by default, preserving the existing shared-secret
configuration. Set the non-secret `auth.accessTokenAlgorithm` YAML setting or
the `ACCESS_TOKEN_ALGORITHM` override to `RS256` to use asymmetric signing.

For `HS256`, `ACCESS_TOKEN_SECRET` is required and must contain at least 32
characters. For `RS256`, `ACCESS_TOKEN_PRIVATE_KEY` and
`ACCESS_TOKEN_PUBLIC_KEY` are required instead. Both must be PEM-encoded RSA
keys of at least 2048 bits from the same pair. PEM values may contain literal
newlines or `\n` escape sequences, which is useful in environment variables.
Startup fails when the selected algorithm is unsupported, its credentials are
absent or malformed, the keys are too small, or the RSA keys do not match.

For example, an RS256 deployment can use:

```dotenv
ACCESS_TOKEN_ALGORITHM=RS256
ACCESS_TOKEN_SECRET=
ACCESS_TOKEN_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
ACCESS_TOKEN_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----
```

This setting affects access JWTs only. Refresh tokens continue to use their
separate `REFRESH_TOKEN_SECRET` and configured stateful lifecycle.

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

## Blob storage

Images live in Azure Blob Storage, in two containers of one account. Client
uploads go to a private quarantine container, and everything that may be
served goes to the public container. The
[architecture overview](./architecture-overview.md#storage-layout) explains
the split.

```yaml
blobStorage:
  containerName: images # AZURE_STORAGE_CONTAINER_NAME
  quarantineContainerName: images-quarantine # AZURE_STORAGE_QUARANTINE_CONTAINER_NAME
  quarantineLegacyFallback: false # MEDIA_QUARANTINE_LEGACY_FALLBACK
  uploadSasTtlSeconds: 900 # AZURE_STORAGE_UPLOAD_SAS_TTL_SECONDS
```

The connection string stays in `AZURE_STORAGE_CONNECTION_STRING`. Setting it
or either container name selects Azure, and then all three are required and
the two container names must differ, ignoring case. Breaking either rule is a
startup error. With none of them set, development stores blobs on local disk
under `backend/tmp/blob-storage/` (`/app/tmp/blob-storage` in Compose), in a
`quarantine/` and a `public/` directory, and `GET /blob/file` serves only from
`public/`.

### Creating the quarantine container

The repository has no infrastructure-as-code, so create the container in each
storage account by hand, with anonymous access off:

```bash
az storage container create --account-name <storage-account> \
  --name <quarantine-container> --public-access off --auth-mode login
```

The public container keeps its current access level.

Browsers PUT uploads straight to Azure, so the account's Blob service CORS
rules must allow `PUT` from the frontend origin with the `x-ms-blob-type` and
`Content-Type` headers; without that, every upload fails in the browser. CORS
rules belong to the account, not to a container, so a rule that already covers
uploads covers the new container. Check with
`az storage cors list --services b --account-name <storage-account>`, and add
one if needed:

```bash
az storage cors add --services b --account-name <storage-account> \
  --methods PUT --origins <frontend-origin> \
  --allowed-headers x-ms-blob-type content-type --max-age 3600
```

Move the quarantine lifecycle rule to the new container as well; see the
[lifecycle backstop](./architecture-overview.md).

### Rolling out the split

Uploads requested before the deploy still land in the public container under
`quarantine/`. `MEDIA_QUARANTINE_LEGACY_FALLBACK=true` lets
`POST /media/{id}/complete`, the media processing worker, and the dead-letter
replay find them there: a `quarantine/` name missing from the quarantine
container is read from the public container, and deleting one removes both
copies. Without it, those few items are rejected as `missing_upload`.

1. Create the quarantine container and check CORS, as above.
2. Set `AZURE_STORAGE_QUARANTINE_CONTAINER_NAME` and
   `MEDIA_QUARANTINE_LEGACY_FALLBACK=true` for the API, every worker, and the
   maintenance commands, then deploy.
3. Once no item from before the deploy can still be completed or replayed —
   after the 24-hour pending-upload TTL and rejected retention have passed —
   turn the flag off. A follow-up release removes it.
4. Run `blob-cleanup`, preview first, then `--delete`, to remove the
   `quarantine/` leftovers from the public container.

A local `backend_blob_storage` volume from before the split keeps its files
directly under `/app/tmp/blob-storage`, where only the fallback looks, and only
for `quarantine/` names. Move the rest into `public/`:

```bash
docker compose run --rm --no-deps --entrypoint sh backend -c \
  'cd /app/tmp/blob-storage && mkdir -p public && for entry in *; do case "$entry" in public|quarantine) ;; *) mv "$entry" public/ ;; esac; done'
```

## Image upload policy

`imageUploads` in `backend/config/default.yml` controls what the blob upload
endpoints accept:

```yaml
imageUploads:
  allowedContentTypes:
    - image/jpeg
    - image/png
    - image/webp
  maxSizeBytes: 5242880
  maxWidth: 8000
  maxHeight: 8000
  maxPixels: 40000000
  maxProcessedEdge: 2560
```

The matching overrides are `ALLOWED_IMAGE_TYPES` (comma-separated),
`MAX_IMAGE_SIZE_BYTES`, `MAX_IMAGE_WIDTH`, `MAX_IMAGE_HEIGHT`,
`MAX_IMAGE_PIXELS`, and `MAX_PROCESSED_IMAGE_EDGE`.

`maxProcessedEdge` caps the image that is stored and served, not the upload.
The media processing worker scales a larger image down so that its longest
edge fits, after applying its EXIF orientation, and keeps the aspect ratio. A
6000×4000 upload is served at 2560×1707. It never enlarges a smaller image.
The value must be an integer from 256 to 8000; anything else is a startup
error. Changing it affects only images processed afterwards. Images that are
already `ready` keep their stored size.

`allowedContentTypes` can only **narrow** the built-in set. JPEG, PNG, and WebP
are the formats the pipeline can actually validate: each has a sharp decoder, a
canonical extension, and a magic-byte signature. Listing anything else — SVG,
GIF, TIFF, HEIC — is a startup error rather than a way to re-enable it.

Two limits interact and the smaller one wins:

- `MAX_IMAGE_SIZE_BYTES` (5 MB by default) is the image policy's ceiling.
- `http.requestBodyMaxBytes` (1 MiB by default) caps every request body,
  including `PUT /blob/upload`.

So on the local upload path the effective ceiling is 1 MiB unless
`requestBodyMaxBytes` is raised too. An over-1-MiB upload is refused by the body
policy with a generic 413 before the image policy ever runs. This does not
affect production, where clients upload directly to Azure and the request never
passes through the backend.

See [architecture-overview.md](./architecture-overview.md) for where each part
of the policy is enforced, and what is not enforced on the Azure path.

## Media malware scanning

`mediaScanning` selects the malware scanner that the media processing worker
runs on each upload before any image decoder reads it.

| Key              | Default    | Override                          | Meaning                                                       |
| ---------------- | ---------- | --------------------------------- | ------------------------------------------------------------- |
| `scanner`        | `none`     | `MEDIA_SCANNER`                   | `clamav` scans with a clamd daemon; `none` scans nothing      |
| `clamavHost`     | `clamav`   | `MEDIA_SCANNING_CLAMAV_HOST`      | clamd host                                                    |
| `clamavPort`     | `3310`     | `MEDIA_SCANNING_CLAMAV_PORT`      | clamd TCP port                                                |
| `timeoutMs`      | `30000`    | `MEDIA_SCANNING_TIMEOUT_MS`       | Limit for each request to clamd, from connecting to its reply |
| `maxStreamBytes` | `26214400` | `MEDIA_SCANNING_MAX_STREAM_BYTES` | Largest body sent to clamd                                    |
| `allowNone`      | `false`    | `MEDIA_SCANNING_ALLOW_NONE`       | Lets the production media worker start with `scanner: none`   |

With `none`, each item is recorded as `skipped` rather than `clean`, so an audit
can tell the two apart. In production, the media processing worker refuses to
start with `none` unless `MEDIA_SCANNING_ALLOW_NONE=true`, and logs why. No
production default is set, so every production deployment chooses one or the
other explicitly. Only that worker scans, so the API and the other workers
start either way.

With `scanner: clamav`, `maxStreamBytes` must be at least
`imageUploads.maxSizeBytes` (`MAX_IMAGE_SIZE_BYTES`); a smaller value is a
startup error. With `none` nothing is streamed and the limit is not checked.

clamd has size limits of its own, and each must cover `maxStreamBytes`:

- `StreamMaxLength` (25M by default). clamd refuses a longer stream with
  `INSTREAM size limit exceeded`, and every such job is retried and then
  dead-lettered. Its `processing_error` says to raise `StreamMaxLength`.
- `MaxFileSize` (100M by default). clamd answers `OK` for content past it
  without scanning it.
- `AlertExceedsMax yes` makes clamd report anything it could not scan in full,
  for any of its limits, as `Heuristics.Limits.Exceeded.*`. The worker
  rejects that as `malware` instead of recording it as clean.

The Compose `clamav` service sets the first two from
`MEDIA_SCANNING_MAX_STREAM_BYTES` and turns on `AlertExceedsMax`. Compose
cannot read a YAML overlay, so set the stream limit with that variable, not
`mediaScanning.maxStreamBytes`, or clamd keeps its 25M. For a clamd outside
Compose, set all three in its `clamd.conf`.

When clamd refuses or cannot be reached, the job is retried and then
dead-lettered like any other processing failure; the item is never marked
ready unscanned. Locally, clamd runs in the opt-in
`scanning` Compose profile; see the
[media worker guide](../backend/src/app/workers/media/README.md#malware-scanning-locally).
See
[architecture-overview.md](./architecture-overview.md#image-upload-validation)
for where the scan runs and what each verdict does.

## Media cleanup worker

`workers.mediaCleanup` controls the sweep that deletes abandoned uploads,
re-queues items whose processing job was lost, and deletes old rejections. See
the [media worker guide](../backend/src/app/workers/media/README.md#media-cleanup)
for what each step does.

| Key                   | Default    | Override                              | Meaning                                                         |
| --------------------- | ---------- | ------------------------------------- | --------------------------------------------------------------- |
| `pollIntervalMs`      | `300000`   | `MEDIA_CLEANUP_POLL_INTERVAL_MS`      | Wait between sweeps that found nothing to do                    |
| `batchSize`           | `100`      | `MEDIA_CLEANUP_BATCH_SIZE`            | Most items each step handles per sweep                          |
| `pendingUploadTtlMs`  | `86400000` | `MEDIA_CLEANUP_PENDING_UPLOAD_TTL_MS` | Age at which a never-completed upload is deleted                |
| `stuckThresholdMs`    | `900000`   | `MEDIA_CLEANUP_STUCK_THRESHOLD_MS`    | Time an `uploaded` or `processing` item may sit unmoved         |
| `maxRequeues`         | `3`        | `MEDIA_CLEANUP_MAX_REQUEUES`          | Re-queues after which a stuck item is rejected instead          |
| `rejectedRetentionMs` | `86400000` | `MEDIA_CLEANUP_REJECTED_RETENTION_MS` | Time a rejected item is kept, so its client can read the reason |

A `processing_failed` item keeps its quarantined upload for the whole
`rejectedRetentionMs`, which bounds how late its dead-lettered job can be
replayed; see the
[dead-letter runbook](../backend/src/app/workers/media/README.md#dead-letter-runbook).

Every value must be a positive integer, except `maxRequeues`, which may be `0`
to reject a stuck item without queuing it again. A sweep that did work is followed by
another at once, so a backlog drains without waiting for the poll interval.

`pendingUploadTtlMs` must also outlast every upload URL the API can issue, so
the cleanup never deletes an upload its client may still send or complete. The
minimum is the longer of `blobStorage.uploadSasTtlSeconds`
(`AZURE_STORAGE_UPLOAD_SAS_TTL_SECONDS`) and the fixed 15-minute local upload
lifetime, plus 15 minutes to finish and complete the upload. A shorter value is
a startup error. With the maximum one-hour SAS lifetime, that is 75 minutes.

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
