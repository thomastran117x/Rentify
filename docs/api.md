# API Guide

This document is intentionally lightweight. The source of truth for Rentify endpoint details is the generated OpenAPI spec, not this page.

## Where To Look

Use one of these references instead of duplicating route docs by hand:

- committed spec: [../backend/openapi/openapi.yaml](../backend/openapi/openapi.yaml)
- local served spec: `http://localhost:8040/api/v1/openapi.yaml`
- local API base: `http://localhost:8040/api/v1`
- local health check: `http://localhost:8040/api/v1/health`

## Why This Page Is Small

Rentify's API surface changes often enough that hand-maintained endpoint lists drift quickly. Keeping the OpenAPI YAML as the canonical reference makes it easier to:

- document every route in one place
- keep request and response shapes aligned with code
- avoid stale docs in multiple files
- validate that route registration and the committed spec stay in sync

## API Response Shape

Most JSON responses use the shared envelope below:

```json
{
  "success": true,
  "message": "Request completed successfully.",
  "data": {},
  "error": null,
  "meta": {
    "requestId": "..."
  }
}
```

## Working With The Spec

From `backend/`:

```bash
npm run openapi:check
npm run openapi:generate
```

Use `openapi:check` to confirm the committed spec matches the current backend routes and schemas. Use `openapi:generate` when backend API changes are intentional and the spec needs to be refreshed.

## Related Docs

- [architecture-overview.md](./architecture-overview.md): where API modules live in the backend
- [testing-guide.md](./testing-guide.md): how API changes should be validated
- [../backend/README.md](../backend/README.md): backend scripts, startup, and API endpoints
