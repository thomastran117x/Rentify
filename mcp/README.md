# Rentify MCP Server

This package exposes a local `stdio` MCP server for Rentify's marketplace, postings, bookings, and rentings APIs.

## What It Does

It wraps the live backend HTTP API and exposes public marketplace tools plus authenticated owner workflow tools.

Public marketplace tools:

- `search_postings`
- `get_posting`
- `batch_get_postings`
- `list_posting_reviews`

Authenticated postings tools:

- `get_my_posting`
- `list_my_postings`
- `batch_get_my_postings`
- `create_posting`
- `update_posting`
- `duplicate_posting`
- `publish_posting`
- `pause_posting`
- `unpause_posting`
- `archive_posting`
- `list_posting_availability_blocks`
- `create_posting_availability_block`
- `update_posting_availability_block`
- `delete_posting_availability_block`
- `get_postings_analytics_summary`
- `list_postings_analytics`
- `get_posting_analytics`
- `create_posting_review`
- `update_my_posting_review`

Authenticated bookings tools:

- `quote_booking_for_posting`
- `create_booking_request`
- `list_my_booking_requests`
- `list_posting_booking_requests`
- `get_booking_request`
- `update_booking_request`
- `approve_booking_request`
- `decline_booking_request`

Authenticated rentings tools:

- `list_my_rentings`
- `get_renting`

Posting photos: `create_posting` and `update_posting` take each photo either as `{ mediaId, position }`, for an image uploaded and processed through the backend's `/media` routes, or as `{ blobUrl, blobName, position }`, for a photo already on the posting. The `/media` routes do not accept personal access tokens yet, and this package has no upload tool, so an MCP client cannot add new photos. That also means it cannot create a posting, which requires at least one photo. Tracked in [#339](https://github.com/thomastran117x/Rentify/issues/339).

The backend API must already be running before this MCP server starts.

Protected MCP integrations can use a Rentify personal access token through `RENTIFY_PAT`. No `auth_*` MCP tools are exposed by this package, and this MCP intentionally does not expose payment-session or direct payment-creation tools.

## Configuration

Environment variables:

- `RENTIFY_API_BASE_URL`
  - Default: `http://127.0.0.1:8040/api/v1`
- `RENTIFY_API_TIMEOUT_MS`
  - Default: `5000`
- `RENTIFY_PAT`
  - Optional personal access token for protected MCP requests
- `RENTIFY_MCP_NAME`
  - Optional override for the MCP server name
- `RENTIFY_MCP_VERSION`
  - Optional override for the MCP server version

Public marketplace tools remain unauthenticated. Protected owner tools send `Authorization: Bearer <RENTIFY_PAT>`.

Use a PAT with:

- `mcp:read` for owner reads, booking quotes, analytics, and renting lookups
- `mcp:write` for posting mutations, availability-block writes, posting review writes, and booking-request mutations

## Explicit Non-Docker Alternative

Use direct package startup only when a non-Docker workflow is explicitly selected. The backend must still be reachable. From this directory:

```bash
npm ci
npm run dev
```

Build and run:

```bash
npm run build
npm run start
```

## Docker

The standard local path is to start the application with `docker compose up --build` from the repository root, then run this stdio server on demand through Compose.

Build the MCP image directly:

```bash
docker build -t rentify-mcp ./mcp
```

The repo also includes a compose-integrated `mcp` service. Because this server uses `stdio`, it is intended to be run on demand rather than exposed on a port:

```bash
docker compose --profile mcp run --rm --build -T mcp
```

## Example MCP Client Config

Example desktop-style MCP config on Windows:

```json
{
  "mcpServers": {
    "rentify": {
      "command": "node",
      "args": ["C:\\path\\to\\Rentify\\mcp\\dist\\index.js"],
      "env": {
        "RENTIFY_API_BASE_URL": "http://127.0.0.1:8040/api/v1",
        "RENTIFY_API_TIMEOUT_MS": "5000",
        "RENTIFY_PAT": "rpat_your_public_id_your_secret"
      }
    }
  }
}
```

Example using the compose-managed container:

```json
{
  "mcpServers": {
    "rentify-docker": {
      "command": "docker",
      "args": ["compose", "--profile", "mcp", "run", "--rm", "-T", "mcp"],
      "env": {
        "RENTIFY_PAT": "rpat_your_public_id_your_secret"
      }
    }
  }
}
```

For development you can also point a client at:

```json
{
  "mcpServers": {
    "rentify-dev": {
      "command": "node",
      "args": ["--import", "tsx", "C:\\path\\to\\Rentify\\mcp\\src\\index.ts"],
      "env": {
        "RENTIFY_API_BASE_URL": "http://127.0.0.1:8040/api/v1"
      }
    }
  }
}
```
