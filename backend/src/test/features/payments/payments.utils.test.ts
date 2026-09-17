import {
  calculatePlatformFeeAmount,
  classifyHttpError,
  createExponentialBackoffDate,
  createPaymentIdempotencyKey,
  formatMoneyValue,
  minorUnitsToMoney,
  moneyToMinorUnits,
} from "@/features/payments/payments.utils";

describe("payments.utils", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reuses a provided idempotency key when it contains non-whitespace text", () => {
    expect(createPaymentIdempotencyKey("  custom-key  ")).toBe("custom-key");
  });

  it("generates a UUID idempotency key when one is not provided", () => {
    expect(createPaymentIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("converts money values to and from minor units", () => {
    expect(moneyToMinorUnits(123.45)).toBe(12345n);
    expect(minorUnitsToMoney(12345n)).toBe(123.45);
    expect(minorUnitsToMoney(987)).toBe(9.87);
  });

  it("calculates platform fees using basis points and rounds to cents", () => {
    expect(calculatePlatformFeeAmount(199.99, 1250)).toBe(25);
    expect(calculatePlatformFeeAmount(80, 333)).toBe(2.66);
  });

  it("creates an exponential backoff date with capped retries and jitter", () => {
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    jest.spyOn(Math, "random").mockReturnValue(0.5);

    const scheduledAt = createExponentialBackoffDate(10, 1_000, 30_000);

    expect(scheduledAt.toISOString()).toBe("2023-11-14T22:13:51.500Z");
  });

  it("formats money values as two-decimal strings", () => {
    expect(formatMoneyValue(12.5)).toBe("12.50");
    expect(formatMoneyValue(123.456)).toBe("123.46");
    expect(formatMoneyValue(0)).toBe("0.00");
  });

  it("classifies undefined HTTP errors as retryable unknown failures", () => {
    expect(classifyHttpError(undefined, "timeout", "TIMEOUT")).toEqual({
      category: "unknown",
      code: "TIMEOUT",
      message: "timeout",
      retryable: true,
    });
  });

  it("classifies 429 and 5xx HTTP errors as transient", () => {
    expect(classifyHttpError(429, "rate limited")).toEqual({
      category: "transient",
      code: "429",
      message: "rate limited",
      retryable: true,
    });

    expect(classifyHttpError(503, "provider unavailable", "UPSTREAM")).toEqual({
      category: "transient",
      code: "UPSTREAM",
      message: "provider unavailable",
      retryable: true,
    });
  });

  it("classifies 4xx and non-error HTTP statuses appropriately", () => {
    expect(classifyHttpError(400, "bad request")).toEqual({
      category: "permanent",
      code: "400",
      message: "bad request",
      retryable: false,
    });

    expect(classifyHttpError(302, "redirected")).toEqual({
      category: "unknown",
      code: "302",
      message: "redirected",
      retryable: false,
    });
  });
});
