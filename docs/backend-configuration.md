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

- `DATABASE_URL`, `REDIS_URL`, `REDIS_PASSWORD`, `RABBITMQ_URL`, and
  `ELASTICSEARCH_PASSWORD`
- `AZURE_CLIENT_SECRET`, for each service that authenticates to blob storage as
  a [Microsoft Entra ID](#microsoft-entra-id-authentication) service principal,
  and `AZURE_STORAGE_CONNECTION_STRING` in the
  [deprecated connection-string mode](#deprecated-connection-string-mode)
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
  auth: entra # AZURE_STORAGE_AUTH
  accountUrl: https://<account>.blob.core.windows.net # AZURE_STORAGE_ACCOUNT_URL
  containerName: images # AZURE_STORAGE_CONTAINER_NAME
  quarantineContainerName: images-quarantine # AZURE_STORAGE_QUARANTINE_CONTAINER_NAME
  quarantineLegacyFallback: false # MEDIA_QUARANTINE_LEGACY_FALLBACK
  uploadSasTtlSeconds: 900 # AZURE_STORAGE_UPLOAD_SAS_TTL_SECONDS
```

Every process reaches the account as its own Microsoft Entra ID identity; see
[Microsoft Entra ID authentication](#microsoft-entra-id-authentication).
Setting the account URL or either container name selects Azure, and then all
three are required and the two container names must differ, ignoring case.
Breaking either rule is a startup error. With none of them set, development
stores blobs on local disk
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

### Microsoft Entra ID authentication

Each process authenticates to the storage account as its own Microsoft Entra
ID identity through `DefaultAzureCredential`; this is `AZURE_STORAGE_AUTH=entra`,
the default. The roles assigned to that identity on each container decide what
the process may do there. The API signs upload URLs as user delegation SAS
tokens, so no process needs the account key, which can do anything to any
blob.

Entra mode has these rules, and breaking one is a startup error:

- it needs `AZURE_STORAGE_ACCOUNT_URL` and both container names;
- the account URL must be an Azure Blob endpoint with no path or port:
  `https://<account>.blob.core.windows.net`, its China or US Government
  cloud equivalent, or an Azure DNS zone endpoint. Any other host would
  receive the process's storage bearer token;
- `AZURE_STORAGE_CONNECTION_STRING` must not be set.

The last rule applies to every backend process, including the ones that
never touch blobs, so no process configuration can carry the key. A
deployment that still sets the connection string fails at startup until it
moves to Entra ID or opts in to the
[deprecated connection-string mode](#deprecated-connection-string-mode).

Every process that touches blobs also signs in when it starts, before it
connects to anything else: the API, the media processing, cleanup and
posting-thumbnail workers, and the maintenance commands. One without a usable
identity fails to boot, rather than failing each blob operation later. The
sign-in proves the identity only; whether its roles allow an operation is
still decided by Azure on each request.

Each process finds its identity through `DefaultAzureCredential`, which reads
Azure's standard environment variables rather than backend configuration:

- **Managed identity** (Container Apps, App Service, AKS and other Azure
  hosts):
  - give each service its own user-assigned identity;
  - set `AZURE_CLIENT_ID` to that identity's client ID;
  - `AZURE_TOKEN_CREDENTIALS=ManagedIdentityCredential` skips the other
    credential types.
- **Service principal** (any other host, including the local stack):
  - set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET`;
  - set `AZURE_TOKEN_CREDENTIALS=EnvironmentCredential`.
  - `AZURE_CLIENT_SECRET` is a secret, so keep it in the environment.

#### Roles

Each identity gets only what its process does. The two custom roles are
defined in [`docs/azure/roles/`](./azure/roles/):

- **Rentify Blob Reader-Deleter**: read, list and delete.
- **Rentify Blob Writer-Deleter**: write and delete.

| Identity                   | Storage account        | Quarantine container          | Public container              |
| -------------------------- | ---------------------- | ----------------------------- | ----------------------------- |
| `backend` (API)            | Storage Blob Delegator | Storage Blob Data Contributor | Rentify Blob Writer-Deleter   |
| `media-processing-worker`  | —                      | Rentify Blob Reader-Deleter   | Rentify Blob Writer-Deleter   |
| `media-cleanup-worker`     | —                      | Rentify Blob Reader-Deleter   | —                             |
| `posting-thumbnail-worker` | —                      | —                             | Storage Blob Data Contributor |
| `blob-cleanup`             | —                      | Rentify Blob Reader-Deleter   | Rentify Blob Reader-Deleter   |
| `media-variants-backfill`  | —                      | —                             | Storage Blob Data Contributor |
| `media-dead-letter-replay` | —                      | Storage Blob Data Reader      | —                             |

- **Upload SAS.** A user delegation SAS can grant no more than the identity
  that signed it, so the API needs write access to the quarantine container
  for a browser's `PUT` to succeed. Storage Blob Delegator only lets it ask
  for the signing key.
- **Known limit: the API can read quarantined bytes.** RBAC cannot separate
  reading a blob's properties from reading its content: both are the
  `blobs/read` data action. `POST /media/{id}/complete` reads an upload's
  properties to check its size and ETag, so the API has that action. The
  media processing worker reads and deletes quarantined uploads, but it
  cannot write to the quarantine container. Neither can `blob-cleanup` or
  the media cleanup worker.
- **No legacy fallback.** These roles do not cover
  `MEDIA_QUARANTINE_LEGACY_FALLBACK`, which reads and deletes `quarantine/`
  names in the public container. Turn it off before switching.

#### Creating the roles and identities

The repository has no infrastructure-as-code. Run these once per
environment, with the Azure CLI signed in as someone who can create role
definitions and assignments (Owner or User Access Administrator on the
resource group).

```bash
SUBSCRIPTION=<subscription-id>
RESOURCE_GROUP=<resource-group>
ACCOUNT=<storage-account>
ACCOUNT_SCOPE=/subscriptions/$SUBSCRIPTION/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Storage/storageAccounts/$ACCOUNT
QUARANTINE_SCOPE=$ACCOUNT_SCOPE/blobServices/default/containers/<quarantine-container>
PUBLIC_SCOPE=$ACCOUNT_SCOPE/blobServices/default/containers/<public-container>
```

1. **Create the custom roles.** Replace the placeholders in each file's
   `AssignableScopes` with the subscription and resource group first.

   ```bash
   az role definition create --role-definition @docs/azure/roles/rentify-blob-reader-deleter.json
   az role definition create --role-definition @docs/azure/roles/rentify-blob-writer-deleter.json
   ```

2. **Create one identity per service** in the table. Each assignment needs
   the identity's principal (object) ID.
   - A user-assigned managed identity:

     ```bash
     az identity create --resource-group $RESOURCE_GROUP --name rentify-backend
     az identity show --resource-group $RESOURCE_GROUP --name rentify-backend \
       --query principalId --output tsv
     ```

   - A service principal. `create-for-rbac` prints the client secret once,
     so store it straight into the secret store.

     ```bash
     az ad sp create-for-rbac --name rentify-backend
     az ad sp show --id <appId> --query id --output tsv
     ```

3. **Assign the roles from the table**, one command per cell. For the API:

   ```bash
   BACKEND=<backend-principal-id>
   az role assignment create --assignee-object-id $BACKEND \
     --assignee-principal-type ServicePrincipal \
     --role "Storage Blob Delegator" --scope $ACCOUNT_SCOPE
   az role assignment create --assignee-object-id $BACKEND \
     --assignee-principal-type ServicePrincipal \
     --role "Storage Blob Data Contributor" --scope $QUARANTINE_SCOPE
   az role assignment create --assignee-object-id $BACKEND \
     --assignee-principal-type ServicePrincipal \
     --role "Rentify Blob Writer-Deleter" --scope $PUBLIC_SCOPE
   ```

   - New assignments can take several minutes to apply. Until they do,
     requests fail with `403 AuthorizationPermissionMismatch`.
   - Check an identity's assignments with
     `az role assignment list --assignee <principal-id> --all --output table`.

#### Rolling it out

1. Turn `MEDIA_QUARANTINE_LEGACY_FALLBACK` off, as in
   [rolling out the split](#rolling-out-the-split).
2. Check how the connection string names the blob endpoint. Entra mode always
   builds blob URLs on the account URL, such as
   `https://<account>.blob.core.windows.net`. If the connection string sets
   `BlobEndpoint` (a custom domain or CDN) or `DefaultEndpointsProtocol=http`,
   the image URLs already stored in the database use that other origin. They
   then stop counting as managed blobs, and saving a posting, organization or
   profile with its existing images fails with 400. Rewrite the stored URLs to
   the account URL first, or stay on the deprecated mode until you have. A
   connection string with only `AccountName`, `AccountKey`, `https` and the
   default `EndpointSuffix` produces the same URLs, so it needs nothing.
3. Create the roles, identities and assignments, as above.
4. Deploy every backend process with `AZURE_STORAGE_ACCOUNT_URL` and its own
   identity variables, and remove `AZURE_STORAGE_CONNECTION_STRING` and any
   `AZURE_STORAGE_AUTH=connection-string` from each one.

   Upload URLs issued before the deploy are signed with the key and keep
   working until they expire.

5. Rotate both account keys, which also invalidates every SAS signed with
   them:

   ```bash
   az storage account keys renew --resource-group $RESOURCE_GROUP \
     --account-name $ACCOUNT --key primary
   az storage account keys renew --resource-group $RESOURCE_GROUP \
     --account-name $ACCOUNT --key secondary
   ```

6. Optionally, turn off shared-key access to the account with
   `az storage account update --resource-group $RESOURCE_GROUP --name $ACCOUNT --allow-shared-key-access false`.
   That breaks anything still on the deprecated connection-string mode,
   including a developer's local stack pointed at this account.

**Revoking upload URLs.** To invalidate every outstanding upload URL at once,
revoke the account's user delegation keys:

```bash
az storage account revoke-delegation-keys --resource-group $RESOURCE_GROUP \
  --name $ACCOUNT
```

The API reuses one delegation key for at most ten minutes, so for up to ten
minutes it can still hand out URLs signed with the revoked key, and their
uploads fail. The same applies after removing one of the API identity's roles.
Restart the API to stop at once.

#### Deprecated: connection-string mode

`AZURE_STORAGE_AUTH=connection-string` signs every request, and every upload
URL, with the account key in `AZURE_STORAGE_CONNECTION_STRING`. It is
deprecated and will be removed in a later release: the key can do anything to
any blob, and every process that uses it logs a deprecation warning when it
starts. The mode has to be named explicitly, and it needs the connection
string and both container names. Move off it with the
[rollout steps](#rolling-it-out).

#### Entra ID in the local stack

`docker-compose.yml` gives each service that touches blobs its own service
principal. To run the stack against an Azure account:

1. Create a service principal for each service, with the roles from the
   table: `az ad sp create-for-rbac --name <name>`, then
   `az role assignment create` as above.
2. In `.env`, set `AZURE_STORAGE_ACCOUNT_URL`, `AZURE_TENANT_ID` and one
   `<PREFIX>_AZURE_CLIENT_ID` and `<PREFIX>_AZURE_CLIENT_SECRET` pair per
   service. The prefixes are `API`, `MEDIA_PROCESSING`, `MEDIA_CLEANUP`,
   `POSTING_THUMBNAIL`, `BLOB_CLEANUP`, `MEDIA_BACKFILL` and `MEDIA_REPLAY`;
   `.env.example` lists them all.
3. Name both containers, with `AZURE_STORAGE_CONTAINER_NAME` and
   `AZURE_STORAGE_QUARANTINE_CONTAINER_NAME` or a
   [YAML overlay](#overrides), then run `docker compose up --build`.

A service without a pair fails to start, because it cannot sign in. Without
an account URL or container names, development keeps
blobs on local disk and needs none of this.

On Docker Desktop, also set `BLOB_SERVICES_DNS=1.1.1.1`. Docker Desktop's DNS
hands the Alpine image only IPv6 addresses for `login.microsoftonline.com`,
which the Docker VM cannot route, so the services fail to start with
`EnvironmentCredential authentication failed` (`ENETUNREACH`). The setting
gives just the blob services a public upstream resolver; Compose service names
still resolve. It is off by default, so networks that block public DNS and
stacks that keep blobs on local disk are unaffected.

To keep signing with the account key locally, set
`AZURE_STORAGE_AUTH=connection-string` and `AZURE_STORAGE_CONNECTION_STRING`
in `.env` instead. That mode is deprecated.

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

## Media image moderation

`mediaModeration` selects the visual content moderation that the media
processing worker applies to each image after re-encoding it, before anything
is published.

| Key                        | Default | Override                              | Meaning                                                                       |
| -------------------------- | ------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| `provider`                 | `none`  | `MEDIA_MODERATION_PROVIDER`           | `azure-content-safety`, or `none`, which allows every image                   |
| `endpoint`                 | `null`  | `MEDIA_MODERATION_ENDPOINT`           | The Content Safety resource, `https://<resource>.cognitiveservices.azure.com` |
| `auth`                     | `entra` | `MEDIA_MODERATION_AUTH`               | `entra` signs with the worker's identity; `api-key` sends the key             |
| (environment only)         |         | `MEDIA_MODERATION_API_KEY`            | The resource key, required for `api-key` and refused for `entra`              |
| `timeoutMs`                | `10000` | `MEDIA_MODERATION_TIMEOUT_MS`         | Limit for each image, from signing in to reading the reply                    |
| `blockAtSeverity.hate`     | `4`     | `MEDIA_MODERATION_BLOCK_AT_HATE`      | Severity at or above which the category blocks the image                      |
| `blockAtSeverity.sexual`   | `4`     | `MEDIA_MODERATION_BLOCK_AT_SEXUAL`    | As above                                                                      |
| `blockAtSeverity.violence` | `4`     | `MEDIA_MODERATION_BLOCK_AT_VIOLENCE`  | As above                                                                      |
| `blockAtSeverity.selfHarm` | `4`     | `MEDIA_MODERATION_BLOCK_AT_SELF_HARM` | As above                                                                      |
| `allowNone`                | `false` | `MEDIA_MODERATION_ALLOW_NONE`         | Lets the production media worker start with `provider: none`                  |

Only the media processing worker moderates, so only it checks these
settings. A missing or invalid one (an unknown provider, a bad endpoint, a key
in entra mode, a threshold out of range) stops that worker at startup with a
message listing every problem, written to its log and to stderr. The API and
the other workers start either way, as they do for the malware scanner.

In production the media processing worker also refuses to start with
`provider: none` unless `MEDIA_MODERATION_ALLOW_NONE=true`, because the
privacy policy tells users their images are screened. No production default is
set, so every production deployment either configures Content Safety or opts
out explicitly.

Every scope is moderated: posting photos, organization logos, blog covers, and
avatars. The worker sends the 800 px medium rendition, or the processed image
when it is no wider than that, fitted inside 2048 x 2048 and padded to at least
50 x 50, which are Content Safety's limits. The image is base64-encoded in the
request body of `POST {endpoint}/contentsafety/image:analyze` (API version
`2024-09-01`).

Content Safety rates each of hate, sexual, violence, and self-harm as 0, 2, 4,
or 6. An image is rejected with code `moderation` and the reason "This image
doesn't meet our content guidelines." when any category reaches its
`blockAtSeverity`, an integer from 0 to 7. The default of 4 blocks medium and
high severity, which is content that is clearly harmful, and lets low severity
through, so ordinary listing photos are not caught. 7 turns a category off. 0
blocks every image, which is only useful to test the rejection path. Each
attempt records the severities in `media.moderation_result`, for operators; no
API response carries them.

Moderation fails closed. A failure is handled by what retrying it can
achieve:

- **Throttling.** A 429, or a 503 with `Retry-After`, that asks for a wait of
  5 seconds or less is waited out once in the worker, within `timeoutMs`.
- **Outage.** A timeout, network failure, longer throttling, 408, server
  error, or unreadable answer is retried through the job's retry tiers and
  then dead-lettered like any other processing failure, and the item ends as
  `processing_failed`. The error records how long Content Safety asked to
  wait, if it did.
- **Configuration.** A 401, 403, or 404, or a failure to sign in, is retried
  the same way, but its error says which setting to check
  (`MEDIA_MODERATION_API_KEY`, the identity's role, or
  `MEDIA_MODERATION_ENDPOINT`).
- **Refusal.** Any other 4xx, such as a 400 for an image Content Safety cannot
  analyze, is final for that image. Asking again would get the same answer, so
  the item is rejected with code `unscreenable` and the reason "This image
  couldn't be checked against our content guidelines. Try a different image."
  rather than retried.

Nothing unscreened is published. After an outage or a configuration fix,
replay the `processing_failed` items with the
[dead-letter runbook](../backend/src/app/workers/media/README.md#dead-letter-runbook).

**Authentication.** `entra`, the default, uses the media processing worker's
own identity (`MEDIA_PROCESSING_AZURE_CLIENT_ID` in Compose) with the scope
of the endpoint's cloud: `https://cognitiveservices.azure.com/.default`, or
the `.azure.us` or `.azure.cn` equivalent. Give that identity the
built-in **Cognitive Services User** role on the Content Safety resource.
Microsoft Entra ID only works against a resource with a custom subdomain,
which is why the endpoint must be `<resource>.cognitiveservices.azure.com`
(or the `.azure.us` and `.azure.cn` equivalents). `api-key` sends the
resource key in `Ocp-Apim-Subscription-Key` instead. The key is a secret, so
it can only be set in the environment, never in a YAML profile.

**Cost.** Each image costs one Content Safety image analysis, billed per call,
and a retried job calls it again. Images that are rejected earlier, for
example for malware or their type, are never sent.

**Data.** Only the processed image leaves the worker: no user ID, file name,
or metadata, because re-encoding drops EXIF. Per Microsoft's
[data, privacy, and security notes](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/content-safety/data-privacy),
Content Safety does not store the image, does not use it for training, keeps it
in the resource's region, and does not make it available for human review. The
[privacy policy](../frontend/src/app/privacy/page.tsx) discloses this
screening.

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
