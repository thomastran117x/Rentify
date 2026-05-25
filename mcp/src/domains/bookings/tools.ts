import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  RentifyApiClient,
  type BookingQuoteBody,
  type CancelBookingRequestBody,
  type BookingRequestBody,
  type BookingRequestDecisionBody,
  type ListBookingRequestsQuery,
} from "../../integrations/rentify-api/index.js";
import { executeTool } from "../shared/tool-results.js";

const bookingStatusSchema = z.enum([
  "pending",
  "approved",
  "awaiting_payment",
  "payment_processing",
  "paid",
  "payment_failed",
  "declined",
  "expired",
  "cancelled",
  "refunded",
]);

const bookingRequestBodySchemaShape = {
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  guestCount: z.number().int().min(1).max(20),
  note: z.string().trim().min(1).max(1000).nullable().optional(),
  contactName: z.string().trim().min(1).max(255),
  contactEmail: z.string().trim().email().max(255),
  contactPhoneNumber: z.string().trim().min(1).max(32).nullable().optional(),
};

const bookingQuoteBodySchemaShape = {
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  guestCount: z.number().int().min(1).max(20),
  note: z.string().trim().min(1).max(1000).nullable().optional(),
};

const bookingDecisionSchemaShape = {
  note: z.string().trim().min(1).max(1000).nullable().optional(),
};

export interface QuoteBookingForPostingToolArgs extends BookingQuoteBody {
  id: string;
}

export interface CreateBookingRequestToolArgs extends BookingRequestBody {
  id: string;
}

export interface ListMyBookingRequestsToolArgs extends ListBookingRequestsQuery {}

export interface ListOwnedBookingRequestsToolArgs extends ListBookingRequestsQuery {}

export interface ListPostingBookingRequestsToolArgs extends ListBookingRequestsQuery {
  id: string;
}

export interface GetBookingRequestToolArgs {
  id: string;
}

export interface UpdateBookingRequestToolArgs extends BookingRequestBody {
  id: string;
}

export interface DecideBookingRequestToolArgs extends BookingRequestDecisionBody {
  id: string;
}

export interface CancelBookingRequestToolArgs extends CancelBookingRequestBody {
  id: string;
}

function describeBookingRequest(result: Record<string, unknown>): string {
  const bookingId = typeof result.id === "string" ? result.id : "unknown";
  const status = typeof result.status === "string" ? result.status : "unknown";
  return `Fetched booking request ${bookingId} with status ${status}.`;
}

export function createBookingsToolHandlers(apiClient: RentifyApiClient) {
  return {
    quoteBookingForPosting: (args: QuoteBookingForPostingToolArgs) =>
      executeTool(
        () =>
          apiClient.quoteBookingForPosting(args.id, {
            startAt: args.startAt,
            endAt: args.endAt,
            guestCount: args.guestCount,
            note: args.note,
          }),
        (result) =>
          result.bookable
            ? `Quoted a bookable stay for posting ${result.postingId} with an estimated total of ${result.estimatedTotal ?? "unknown"}.`
            : `Quoted an unavailable stay for posting ${result.postingId}; ${result.failureReasons.length} failure reason(s) were returned.`,
      ),
    createBookingRequest: (args: CreateBookingRequestToolArgs) =>
      executeTool(
        () =>
          apiClient.createBookingRequest(args.id, {
            startAt: args.startAt,
            endAt: args.endAt,
            guestCount: args.guestCount,
            note: args.note,
            contactName: args.contactName,
            contactEmail: args.contactEmail,
            contactPhoneNumber: args.contactPhoneNumber,
          }),
        (result) => `Created booking request ${result.id} for posting ${args.id}.`,
      ),
    listMyBookingRequests: (args: ListMyBookingRequestsToolArgs) =>
      executeTool(
        () => apiClient.listMyBookingRequests(args),
        (result) =>
          `Fetched ${result.bookingRequests.length} of your booking request(s) on page ${result.pagination.page}.`,
      ),
    listOwnedBookingRequests: (args: ListOwnedBookingRequestsToolArgs) =>
      executeTool(
        () => apiClient.listOwnedBookingRequests(args),
        (result) =>
          `Fetched ${result.bookingRequests.length} owner booking request(s) on page ${result.pagination.page}.`,
      ),
    listPostingBookingRequests: (args: ListPostingBookingRequestsToolArgs) =>
      executeTool(
        () =>
          apiClient.listPostingBookingRequests(args.id, {
            page: args.page,
            pageSize: args.pageSize,
            status: args.status,
          }),
        (result) =>
          `Fetched ${result.bookingRequests.length} booking request(s) for posting ${args.id} on page ${result.pagination.page}.`,
      ),
    getBookingRequest: (args: GetBookingRequestToolArgs) =>
      executeTool(
        () => apiClient.getBookingRequest(args.id),
        (result) => describeBookingRequest(result),
      ),
    getBookingCancellationQuote: (args: GetBookingRequestToolArgs) =>
      executeTool(
        () => apiClient.getBookingCancellationQuote(args.id),
        (result) =>
          result.cancellable
            ? `Fetched a ${result.refundType} cancellation quote for booking request ${args.id}.`
            : `Fetched a non-cancellable booking quote for ${args.id} with ${result.failureReasons.length} failure reason(s).`,
      ),
    updateBookingRequest: (args: UpdateBookingRequestToolArgs) =>
      executeTool(
        () =>
          apiClient.updateBookingRequest(args.id, {
            startAt: args.startAt,
            endAt: args.endAt,
            guestCount: args.guestCount,
            note: args.note,
            contactName: args.contactName,
            contactEmail: args.contactEmail,
            contactPhoneNumber: args.contactPhoneNumber,
          }),
        (result) => `Updated booking request ${result.id} with status ${result.status}.`,
      ),
    approveBookingRequest: (args: DecideBookingRequestToolArgs) =>
      executeTool(
        () =>
          apiClient.approveBookingRequest(args.id, {
            note: args.note,
          }),
        (result) => `Approved booking request ${result.id}; it is now ${result.status}.`,
      ),
    declineBookingRequest: (args: DecideBookingRequestToolArgs) =>
      executeTool(
        () =>
          apiClient.declineBookingRequest(args.id, {
            note: args.note,
          }),
        (result) => `Declined booking request ${result.id}; it is now ${result.status}.`,
      ),
    cancelBookingRequest: (args: CancelBookingRequestToolArgs) =>
      executeTool(
        () =>
          apiClient.cancelBookingRequest(args.id, {
            reason: args.reason,
          }),
        (result) => `Cancelled booking request ${result.id}; it is now ${result.status}.`,
      ),
  };
}

export function registerBookingsTools(
  server: McpServer,
  handlers: ReturnType<typeof createBookingsToolHandlers>,
): void {
  server.registerTool(
    "quote_booking_for_posting",
    {
      title: "Quote Booking For Posting",
      description: "Calculate a booking quote for a posting without creating a payment session.",
      inputSchema: {
        id: z.string().trim().min(1),
        ...bookingQuoteBodySchemaShape,
      },
    },
    handlers.quoteBookingForPosting,
  );

  server.registerTool(
    "create_booking_request",
    {
      title: "Create Booking Request",
      description: "Create a booking request for a posting without initiating payment.",
      inputSchema: {
        id: z.string().trim().min(1),
        ...bookingRequestBodySchemaShape,
      },
    },
    handlers.createBookingRequest,
  );

  server.registerTool(
    "list_my_booking_requests",
    {
      title: "List My Booking Requests",
      description: "List booking requests for the authenticated user.",
      inputSchema: {
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(50).optional(),
        status: bookingStatusSchema.optional(),
      },
    },
    handlers.listMyBookingRequests,
  );

  server.registerTool(
    "list_owned_booking_requests",
    {
      title: "List Owned Booking Requests",
      description: "List booking requests across postings owned by the authenticated user.",
      inputSchema: {
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(50).optional(),
        status: bookingStatusSchema.optional(),
      },
    },
    handlers.listOwnedBookingRequests,
  );

  server.registerTool(
    "list_posting_booking_requests",
    {
      title: "List Posting Booking Requests",
      description: "List booking requests for one of your postings.",
      inputSchema: {
        id: z.string().trim().min(1),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(50).optional(),
        status: bookingStatusSchema.optional(),
      },
    },
    handlers.listPostingBookingRequests,
  );

  server.registerTool(
    "get_booking_request",
    {
      title: "Get Booking Request",
      description: "Fetch one booking request by id.",
      inputSchema: {
        id: z.string().trim().min(1),
      },
    },
    handlers.getBookingRequest,
  );

  server.registerTool(
    "get_booking_cancellation_quote",
    {
      title: "Get Booking Cancellation Quote",
      description: "Fetch cancellation eligibility and refund details for a booking request.",
      inputSchema: {
        id: z.string().trim().min(1),
      },
    },
    handlers.getBookingCancellationQuote,
  );

  server.registerTool(
    "update_booking_request",
    {
      title: "Update Booking Request",
      description: "Update an existing booking request without starting payment.",
      inputSchema: {
        id: z.string().trim().min(1),
        ...bookingRequestBodySchemaShape,
      },
    },
    handlers.updateBookingRequest,
  );

  server.registerTool(
    "approve_booking_request",
    {
      title: "Approve Booking Request",
      description: "Approve a booking request as the posting owner.",
      inputSchema: {
        id: z.string().trim().min(1),
        ...bookingDecisionSchemaShape,
      },
    },
    handlers.approveBookingRequest,
  );

  server.registerTool(
    "decline_booking_request",
    {
      title: "Decline Booking Request",
      description: "Decline a booking request as the posting owner.",
      inputSchema: {
        id: z.string().trim().min(1),
        ...bookingDecisionSchemaShape,
      },
    },
    handlers.declineBookingRequest,
  );

  server.registerTool(
    "cancel_booking_request",
    {
      title: "Cancel Booking Request",
      description: "Cancel an accessible booking request with an optional reason.",
      inputSchema: {
        id: z.string().trim().min(1),
        reason: z.string().trim().min(1).max(1000).nullable().optional(),
      },
    },
    handlers.cancelBookingRequest,
  );
}
