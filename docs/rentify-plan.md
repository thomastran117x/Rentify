# Rentify Application Plan and Design

## 1. Purpose

Rentify is a multi-category rental marketplace where users can list items or spaces for rent, discover available listings, message owners, request bookings, and complete payments through the platform.

This document outlines the recommended product scope, system design, delivery phases, and technical direction for the full Rentify application across backend, web, and possible mobile channels.

## 2. Product Vision

Rentify should make short-term and medium-term rentals feel trustworthy, fast, and easy for both sides of the marketplace:

- Owners can publish rental listings for homes, rooms, equipment, vehicles, tools, event items, and other rentable assets.
- Renters can search, compare, message owners, request bookings, and pay securely.
- Owners can approve or decline booking requests and finalize arrangements inside the platform.
- The platform should support trust, safety, communication, and clear booking workflows rather than acting as a simple classifieds board.

## 3. Core User Flows

### 3.1 Owner Flow

1. Sign up or log in.
2. Create a profile and optional verification details.
3. Create one or more listings with category, pricing, availability, photos, rules, and location.
4. Receive direct messages and booking requests.
5. Approve, decline, or counter booking details.
6. Get paid through the platform.
7. Manage active bookings, cancellations, reviews, and payout history.

### 3.2 Renter Flow

1. Sign up or log in.
2. Search listings by keyword, category, date, location, and price.
3. View listing details, photos, owner profile, and rental terms.
4. Message the owner for clarifications.
5. Submit a booking request for selected dates or duration.
6. Complete payment after approval or according to the platform payment flow.
7. Track booking status and receive updates.
8. Leave a review after the rental is completed.

### 3.3 Admin / Operations Flow

1. Review flagged listings or disputes.
2. Moderate users, listings, reviews, and messages when needed.
3. Handle refunds, risk checks, and support actions.
4. Monitor platform health, payments, and marketplace activity.

## 4. Recommended Initial Scope

The best first release is a focused marketplace MVP with a strong backend and web client, while keeping mobile support in mind from day one.

### 4.1 MVP Features

- Authentication and account management
- User profiles
- Listing creation and management
- Image upload and media storage
- Search and filters
- Booking request workflow
- Direct messaging between renter and owner
- Availability and scheduling basics
- Payment integration
- Email notifications
- Basic reviews and ratings
- Admin moderation tools

### 4.2 Post-MVP Features

- Native mobile app
- In-app push notifications
- Identity verification / KYC
- Advanced calendar sync
- Dynamic pricing and discounts
- Multi-language support
- Saved searches and favorites
- Smart recommendations
- Dispute resolution center
- Tax invoices and financial reporting
- External integrations and automation tools

## 5. Platform Recommendation

### 5.0 Preferred Tech Stack

Rentify should primarily stay within the Node ecosystem to keep the stack cohesive across backend, frontend, testing, and future automation tooling.

Recommended stack direction:

- Backend API: `Node.js` + `Hono` + `Prisma`
- Database: `MySQL`
- Cache / ephemeral state: `Redis`
- Web client: `Next.js` + `React`
- End-to-end testing: `Playwright` with Node
- File/media storage: `Azure Blob Storage`
- Search engine: `Elasticsearch`
- Future mobile client: `React Native`
- Future AI / integration tooling: Node-based MCP server(s)

This direction keeps hiring, local development, deployment, shared tooling, and package management simpler than mixing multiple backend ecosystems too early.

### 5.1 Backend

Yes, a backend server is required. The current repository already includes the foundation for this:

- `Hono` server bootstrap
- `Prisma` for data access
- `MySQL` datasource
- `Redis` integration
- Auth and device/session-related foundations
- Blob upload support
- Email service support

This is a strong base for Rentify and should remain the system of record for users, listings, bookings, messages, and payments.

### 5.2 Web Client

Yes, a web client should be part of the initial release. It is the fastest way to deliver:

- listing creation and management
- discovery and search
- booking and messaging flows
- admin operations

Recommendation: build web first.

### 5.3 Mobile Client

A mobile client is valuable, but it should be treated as phase two unless there is a hard business requirement for launch-day mobile apps.

Recommendation:

- Design APIs to be mobile-friendly from the start.
- Build responsive web first.
- Add React Native or Flutter later if adoption justifies it.

### 5.4 MCP

An MCP can be useful, but it should not block the marketplace build.

Potential MCP uses:

- internal support assistant access to bookings, listings, and disputes
- admin workflow tooling
- AI-assisted listing quality checks
- AI assistant for operations or customer support

Recommendation: treat MCP as an optional platform extension after the marketplace core is stable.

## 6. High-Level Architecture

### 6.1 Logical Components

- Client applications
  - Web client
  - Future mobile client
- Core backend API
  - Auth and identity
  - Profiles
  - Listings
  - Search
  - Messaging
  - Booking management
  - Payments
  - Reviews
  - Admin / moderation
- Supporting infrastructure
  - MySQL
  - Redis
  - Azure Blob Storage
  - Email provider
  - Payment provider
  - Elasticsearch
  - Future message broker

### 6.2 Suggested Architecture Style

- Modular monolith for the backend initially
- Shared database per application
- Clear domain modules inside the backend
- Event-driven notifications where useful

A modular monolith is the right starting point here because:

- the team can move faster
- transaction boundaries are simpler
- search, booking, payment, and messaging flows are tightly related
- it avoids premature microservice complexity

If scale later requires it, messaging, search, notifications, or payments can be extracted into separate services.

### 6.3 Infrastructure Additions

In addition to the current backend foundations, the application plan should explicitly include the following platform resources:

- `Azure Blob Storage` for listing media, profile assets, and other uploaded files
- `Elasticsearch` for scalable search, filtering, and relevance ranking
- a future `message broker` to decouple async work such as email sending, notification fanout, indexing, booking reminders, and payout processing

The message broker does not need to be part of the first implementation, but it should be anticipated in the architecture so async jobs can move out of request/response flows later without major redesign.

## 7. Proposed Backend Domain Modules

The current backend already has `auth`, `profile`, `blob`, `email`, and `cache` foundations. Rentify can evolve by adding these product modules:

### 7.1 Identity and Access

- local auth
- OAuth providers
- session/device management
- user roles
- admin authorization

### 7.2 Profiles

- public profile
- owner profile details
- verification status
- ratings summary

### 7.3 Listings

- create/update/archive listing
- categories and subcategories
- pricing model
- location data
- house rules / rental terms
- image gallery
- availability settings

### 7.4 Search and Discovery

- keyword search
- category filtering
- location filtering
- price filtering
- date availability filtering
- sorting and ranking

### 7.5 Messaging

- conversation threads
- booking-linked chat
- unread state
- moderation / reporting hooks

### 7.6 Booking

- booking request creation
- owner approval / decline
- date reservation logic
- booking statuses
- cancellation policies
- booking timeline and audit trail

### 7.7 Payments and Payouts

- payment intent creation
- capture / authorization flow
- refunds
- owner payouts
- fee calculation
- transaction ledger

### 7.8 Reviews

- renter reviews owner/listing
- owner reviews renter if desired
- eligibility only after completed bookings

### 7.9 Notifications

- email notifications
- future push notifications
- in-app notification center

### 7.10 Admin and Trust

- flagged listings
- reported messages
- disputes
- user suspension
- listing moderation

## 8. Data Model Direction

The Prisma schema currently includes `User` and `Device`. The following entities should be added as the marketplace grows.

### 8.1 Core Entities

- `User`
- `Device`
- `Profile`
- `Listing`
- `ListingImage`
- `ListingAvailabilityRule`
- `ListingBlockedDate`
- `Category`
- `Conversation`
- `ConversationParticipant`
- `Message`
- `Booking`
- `BookingStatusHistory`
- `Payment`
- `Payout`
- `Review`
- `Favorite`
- `Notification`
- `Report`

### 8.2 Example Listing Fields

- id
- ownerId
- title
- description
- categoryId
- type
- pricingModel
- priceAmount
- currency
- depositAmount
- city
- region
- country
- latitude
- longitude
- status
- minimumRentalDuration
- maximumRentalDuration
- createdAt
- updatedAt

### 8.3 Example Booking Statuses

- `pending`
- `approved`
- `declined`
- `awaiting_payment`
- `paid`
- `active`
- `completed`
- `cancelled`
- `refunded`
- `disputed`

### 8.4 Example Conversation Model

- One conversation can be tied to a listing.
- One conversation may optionally be tied to a booking.
- Only authenticated participants can read or send messages.
- Message deletion should usually be soft delete for moderation/audit safety.

## 9. API Design Direction

### 9.1 Style

- REST-first API for the initial release
- JSON request/response contracts
- versioned routes, for example `/api/v1/...`
- validation with `zod`
- auth via bearer token and secure refresh handling

### 9.2 Suggested Endpoint Areas

- `/auth`
- `/profiles`
- `/listings`
- `/categories`
- `/search`
- `/conversations`
- `/messages`
- `/bookings`
- `/payments`
- `/reviews`
- `/favorites`
- `/notifications`
- `/admin`

### 9.3 Realtime Direction

Messaging and booking updates will benefit from realtime support. Recommendation:

- Start with REST + polling for MVP if speed is critical.
- Add WebSocket or SSE for chat, booking status changes, and notifications once the core flows are stable.
  - Done for booking request messages: `GET /booking-requests/{id}/messages/stream` is a
    Server-Sent Events endpoint fanned out over Redis pub/sub. Because the API authenticates
    from the `authorization` header, clients read it with `fetch` rather than `EventSource`,
    and fall back to polling after repeated connect failures. Booking status changes and
    notifications still poll.

## 10. Payment Strategy

Payments are important enough to plan early.

### 10.1 Recommended Provider

Stripe is the most practical default for:

- marketplace payment flows
- payment intents
- saved payment methods
- refunds
- payout capabilities
- webhook-driven state updates

### 10.2 Payment Flow Recommendation

Recommended initial flow:

1. Renter submits booking request.
2. Owner approves request.
3. Platform creates payment intent.
4. Renter completes payment.
5. Booking moves to confirmed/paid state.
6. Owner payout is scheduled after the booking starts or completes, depending on policy.

Alternative flows such as pre-authorization before approval can be added later if needed.

### 10.3 Financial Considerations

- service fees
- deposits
- partial refunds
- cancellation fees
- payout delays for fraud/risk control
- webhook idempotency
- transaction reconciliation

## 11. Search Strategy

For the first version, database-backed search is acceptable if the dataset is still small to moderate.

### 11.1 MVP Search

- MySQL filtering with indexes
- Redis caching for hot queries
- category, location, price, and availability filters

### 11.2 Future Search

If search becomes more complex, move to:

- Elasticsearch

This would help with:

- typo tolerance
- relevance ranking
- faceted filters
- geo search

## 12. Security and Trust

Rentify will handle identity, messages, bookings, and payments, so trust and safety should be part of the base design.

### 12.1 Security Requirements

- secure password hashing
- email verification
- device/session awareness
- rate limiting
- CSRF protection where cookie flows are used
- upload validation
- input validation
- audit logging for critical actions
- secrets management

### 12.2 Trust and Safety Features

- listing moderation
- report user/report listing/report message flows
- suspicious login notifications
- optional owner verification
- booking dispute records

## 13. Frontend Direction

### 13.1 Web App Scope

Primary pages:

- landing page
- search results
- listing detail
- create/edit listing
- booking checkout flow
- inbox/messages
- owner dashboard
- renter bookings dashboard
- profile and account settings
- admin dashboard

### 13.2 Suggested Frontend Stack

Reasonable options:

- Next.js + React
- Tailwind or a small design system
- TanStack Query or equivalent data fetching layer

If the team prefers a simpler split, the backend can stay as Hono API and the frontend can be a separate Next.js app.

### 13.3 Mobile Readiness

Even before building native apps:

- keep API contracts client-agnostic
- avoid browser-only assumptions in auth
- support responsive design
- design notifications/events with mobile expansion in mind

## 14. Notifications and Communication

Notifications should support trust and conversion throughout the booking lifecycle.

### 14.1 Email Notifications

Use the existing email foundation for:

- account verification
- new booking request
- booking approved/declined
- payment received
- upcoming booking reminders
- new message alerts

In the short term, email sending can remain application-managed. Later, email and notification delivery should move behind a message broker so request handlers can publish work instead of waiting on downstream delivery concerns.

### 14.2 In-App Notifications

- unread message count
- booking status updates
- payout updates
- moderation notices

### 14.3 Future Push Notifications

For mobile or PWA support:

- new message
- booking action needed
- payment success/failure

## 15. Observability and Operations

The platform should be diagnosable from the start.

### 15.1 Needed Foundations

- structured logging
- request IDs
- centralized error handling
- health checks
- metrics
- background job visibility

### 15.2 Useful Background Jobs

- email dispatch retries
- notification fanout
- booking reminder sends
- stale booking expiration
- payout scheduling
- moderation review queues

These jobs are good candidates for broker-backed async processing once operational complexity grows.

## 16. Delivery Roadmap

### Phase 0: Foundation

- stabilize backend project structure
- finalize environment configuration
- define modules and API conventions
- expand Prisma schema
- add migrations
- set up local dev environments

### Phase 1: Accounts and Profiles

- auth hardening
- profile CRUD
- role model
- email verification flows

### Phase 2: Listings

- listing CRUD
- media uploads
- categories
- availability model
- search filters

### Phase 3: Messaging and Booking

- conversations and messages
- booking request lifecycle
- owner approve/decline flow
- booking dashboards

### Phase 4: Payments

- payment provider integration
- booking-payment linkage
- refunds
- payout foundations

### Phase 5: Reviews, Admin, and Trust

- ratings and reviews
- reporting
- moderation tools
- dispute handling basics

### Phase 6: Mobile / Advanced Platform

- native mobile app or PWA enhancement
- realtime messaging improvements
- MCP integration
- recommendation features

## 17. Suggested Repository Direction

Since the repository already has a `backend` folder, a practical near-term structure is:

```text
/backend
/web
/mobile              # optional later
/docs
/mcp                 # optional later
```

Suggested immediate additions:

- `docs/rentify-plan.md`
- `docs/api-design.md`
- `docs/domain-model.md`
- `web/` for the frontend client once implementation begins

## 18. Testing Strategy

Testing should also stay inside the Node ecosystem where possible.

### 18.1 Recommended Approach

- unit and service tests for backend modules
- integration tests for API and database-backed flows
- end-to-end tests with `Playwright`

Playwright should cover the highest-value user journeys:

- sign up and login
- listing creation
- listing search
- booking request flow
- owner approval flow
- payment happy path
- messaging basics

## 19. Key Product Decisions to Confirm Later

These are the main open decisions that will materially affect implementation:

- Which rental categories are in the first release: homes only, equipment only, or multi-category?
- Is booking instant, approval-based, or mixed by listing type?
- Will location be approximate or exact before booking confirmation?
- Will owner identity verification be mandatory?
- How are platform fees and deposits handled?
- Will messaging be allowed before account verification?
- Is there one booking model for all categories, or category-specific booking rules?

For now, this plan assumes:

- a multi-category marketplace
- owner approval for most bookings
- web-first delivery
- payments integrated into the platform
- mobile support later
- MCP as an optional later enhancement

## 20. Immediate Next Steps

Recommended next actions for the repository:

1. Finalize the product scope for MVP categories and booking rules.
2. Expand the Prisma schema for listings, bookings, conversations, and payments.
3. Create backend feature modules for `listings`, `bookings`, `messages`, and `payments`.
4. Decide on the web client stack and scaffold the `web` app.
5. Write API contracts for the first owner and renter workflows.
6. Choose a payment provider and define the booking-payment lifecycle.
7. Plan Azure Blob Storage, Elasticsearch, and the future broker integration points early, even if some are introduced in phases.

## 21. Summary

Rentify should be built as a web-first rental marketplace backed by the existing Hono + Prisma + MySQL + Redis backend foundation already present in this repository. The strongest delivery plan is to keep the backend as a modular monolith, add marketplace-specific domains in phases, launch a responsive web client first, and treat mobile and MCP as planned extensions rather than launch blockers.
