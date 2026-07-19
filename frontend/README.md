# Rentify Frontend

The frontend is the Rentify web application built with Next.js App Router. It covers the public marketplace, authentication flows, owner dashboards, booking views, organization tooling, moderation screens, and supporting marketing pages.

## Stack

- `Next.js 16`
- `React 19`
- `Tailwind CSS 4`
- `Vitest` for unit tests
- `Playwright` for browser E2E tests

## Current App Areas

- public marketing pages such as home, about, FAQ, contact, privacy, and terms
- auth flows for login, signup, forgot password, email verification, and OAuth popup completion
- public postings search and posting detail pages
- owner posting creation and dashboard flows
- account, bookings, organizations, moderation, and analytics surfaces

## Recommended Startup

For the real local app, run the full stack from the repo root:

```bash
cp .env.example .env
docker compose up --build
```

That serves the frontend at `http://localhost:3040` and points it at the backend API running on `http://localhost:8040/api/v1`.

## Standalone Frontend Development

For frontend-only work:

```bash
npm install
npm run dev
```

The dev server runs on `http://localhost:3040`.

Environment loading:

- Docker Compose injects frontend env values from the repo-root `.env`
- local Next.js runs can use `frontend/.env.local`
- `INTERNAL_API_BASE_URL` is used for server-side requests
- `NEXT_PUBLIC_API_BASE_URL` is used in the browser and defaults to the local API route prefix

## Frontend Env Values

- `NEXT_PUBLIC_API_BASE_URL`: public API base URL; `http://localhost:8040/api/v1` is the recommended local value
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`: enables Cloudflare Turnstile on auth pages
- `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID`: enables Google OAuth UI
- `NEXT_PUBLIC_MICROSOFT_OAUTH_CLIENT_ID`: enables Microsoft OAuth UI
- `NEXT_PUBLIC_MICROSOFT_OAUTH_TENANT`: Microsoft authority segment such as `consumers`, `organizations`, `common`, or a tenant ID
- `INTERNAL_API_BASE_URL`: server-side API base URL, typically `http://backend:8040/api/v1` in Docker

The frontend normalizes loopback API URLs and will add `/api/v1` when the configured pathname is `/` or `/api`, but using the full API base path is still the clearest option.

## Useful Scripts

```bash
npm run dev
npm run build
npm run start
npm run format
npm run format:diff
npm run lint
npm run test:unit
npm run test:unit:watch
npm run test:e2e
npm run test:e2e:headed
npm run test:e2e:ui
```

## Testing

Unit tests live alongside `src/**` files and run with Vitest.

Browser tests live in `tests/e2e`. By default, Playwright starts the frontend dev server on `http://127.0.0.1:3040` automatically. If you want Playwright to reuse an already running app, set `PLAYWRIGHT_EXTERNAL_SERVER=1`.

## Auth and API Notes

- Google and Microsoft sign-in use authorization code + PKCE
- OAuth popup completion routes live at `/auth/google` and `/auth/microsoft`
- the API client includes device headers, refresh-session retry logic, and CSRF support for auth-related requests
- frontend API helpers expect the backend response envelope with `success`, `message`, `data`, `error`, and `meta`
