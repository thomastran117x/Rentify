import { BackendApiError } from "../../integrations/rentify-api/index.js";
import { createBookingsToolHandlers } from "../../domains/bookings/index.js";

function readFirstText(result: { content: Array<{ type: string } & Record<string, unknown>> }): string {
  const textBlock = result.content.find(
    (entry): entry is { type: "text"; text: string } => entry.type === "text",
  );

  return textBlock?.text ?? "";
}

describe("createBookingsToolHandlers", () => {
  it("maps quote_booking_for_posting to the protected booking quote API", async () => {
    const apiClient = {
      quoteBookingForPosting: jest.fn().mockResolvedValue({
        postingId: "post_1",
        bookable: true,
        durationDays: 3,
        pricingCurrency: "CAD",
        dailyPriceAmount: 120,
        estimatedTotal: 360,
        maxBookingDurationDays: 14,
        failureReasons: [],
      }),
    } as never;
    const handlers = createBookingsToolHandlers(apiClient);

    const result = await handlers.quoteBookingForPosting({
      id: "post_1",
      startAt: "2026-05-01T12:00:00.000Z",
      endAt: "2026-05-04T12:00:00.000Z",
      guestCount: 2,
      note: "Quiet guests.",
    });

    expect((apiClient as { quoteBookingForPosting: jest.Mock }).quoteBookingForPosting).toHaveBeenCalledWith(
      "post_1",
      {
        startAt: "2026-05-01T12:00:00.000Z",
        endAt: "2026-05-04T12:00:00.000Z",
        guestCount: 2,
        note: "Quiet guests.",
      },
    );
    expect(result.structuredContent).toMatchObject({
      postingId: "post_1",
      bookable: true,
      estimatedTotal: 360,
    });
    expect(readFirstText(result)).toContain("Quoted a bookable stay");
  });

  it("maps approve_booking_request to the protected booking decision API", async () => {
    const apiClient = {
      approveBookingRequest: jest.fn().mockResolvedValue({
        id: "booking_1",
        status: "approved",
        posting: {
          id: "post_1",
          name: "Loft",
        },
      }),
    } as never;
    const handlers = createBookingsToolHandlers(apiClient);

    const result = await handlers.approveBookingRequest({
      id: "booking_1",
      note: "Approved for your requested dates.",
    });

    expect((apiClient as { approveBookingRequest: jest.Mock }).approveBookingRequest).toHaveBeenCalledWith(
      "booking_1",
      {
        note: "Approved for your requested dates.",
      },
    );
    expect(result.structuredContent).toMatchObject({
      id: "booking_1",
      status: "approved",
    });
    expect(readFirstText(result)).toContain("Approved booking request booking_1");
  });

  it("maps get_booking_cancellation_quote and cancel_booking_request to the protected cancellation API", async () => {
    const apiClient = {
      getBookingCancellationQuote: jest.fn().mockResolvedValue({
        bookingRequestId: "booking_1",
        cancellable: true,
        actor: "renter",
        bookingStatus: "paid",
        reasonRequired: false,
        policyCode: "platform_default_v1",
        refundType: "partial",
        refundAmount: 165,
        currency: "CAD",
        failureReasons: [],
      }),
      cancelBookingRequest: jest.fn().mockResolvedValue({
        id: "booking_1",
        status: "cancelled",
        posting: {
          id: "post_1",
          name: "Loft",
        },
      }),
    } as never;
    const handlers = createBookingsToolHandlers(apiClient);

    const quote = await handlers.getBookingCancellationQuote({
      id: "booking_1",
    });
    const cancellation = await handlers.cancelBookingRequest({
      id: "booking_1",
      reason: "Plans changed.",
    });

    expect(
      (apiClient as { getBookingCancellationQuote: jest.Mock }).getBookingCancellationQuote,
    ).toHaveBeenCalledWith("booking_1");
    expect(
      (apiClient as { cancelBookingRequest: jest.Mock }).cancelBookingRequest,
    ).toHaveBeenCalledWith("booking_1", {
      reason: "Plans changed.",
    });
    expect(quote.structuredContent).toMatchObject({
      bookingRequestId: "booking_1",
      refundType: "partial",
      refundAmount: 165,
    });
    expect(cancellation.structuredContent).toMatchObject({
      id: "booking_1",
      status: "cancelled",
    });
  });

  it("returns isError results for protected bookings API failures", async () => {
    const apiClient = {
      createBookingRequest: jest
        .fn()
        .mockRejectedValue(
          new BackendApiError(
            403,
            "FORBIDDEN",
            { requiredScope: "mcp:write" },
            "Personal access token does not include the required scope.",
          ),
        ),
    } as never;
    const handlers = createBookingsToolHandlers(apiClient);

    const result = await handlers.createBookingRequest({
      id: "post_1",
      startAt: "2026-05-01T12:00:00.000Z",
      endAt: "2026-05-04T12:00:00.000Z",
      guestCount: 2,
      note: null,
      contactName: "Alex Renter",
      contactEmail: "alex@example.com",
      contactPhoneNumber: null,
    });

    expect(result.isError).toBe(true);
    expect(readFirstText(result)).toContain("\"status\": 403");
    expect(readFirstText(result)).toContain("\"code\": \"FORBIDDEN\"");
  });
});
