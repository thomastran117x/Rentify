const mockGetEnvironment = jest.fn();
const mockIsDevelopment = jest.fn();

jest.mock("@/configuration/environment/index", () => ({
  getEnvironment: () => mockGetEnvironment(),
  environment: {
    isDevelopment: () => mockIsDevelopment(),
  },
}));

import { SquarePaymentAdapter } from "@/features/payments/square.adapter";

describe("SquarePaymentAdapter", () => {
  beforeEach(() => {
    mockGetEnvironment.mockReturnValue({
      square: {
        accessToken: "change-me-square-access-token",
        locationId: "change-me-square-location-id",
        webhookSignatureKey: "change-me-square-webhook-signature-key",
        webhookNotificationUrl: "http://localhost:8040/api/v1/payments/webhooks/square",
        apiBaseUrl: "https://connect.squareupsandbox.com",
      },
      oauth: {
        google: {
          frontendBaseUrl: "http://localhost:3040",
        },
      },
    });
    mockIsDevelopment.mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockGetEnvironment.mockReset();
    mockIsDevelopment.mockReset();
  });

  it("simulates refunds in development when Square credentials are placeholders", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch");
    const adapter = new SquarePaymentAdapter();

    await expect(
      adapter.createRefund({
        idempotencyKey: "refund-123",
        providerPaymentId: "payment-123",
        amount: 184.8,
        currency: "CAD",
        reason: "Renter cancelled before start.",
      }),
    ).resolves.toEqual({
      providerRefundId: "mock-refund-refund-123",
      status: "COMPLETED",
      raw: {
        mock: true,
        providerPaymentId: "payment-123",
        amount: 184.8,
        currency: "CAD",
        reason: "Renter cancelled before start.",
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
