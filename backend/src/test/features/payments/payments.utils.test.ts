import {
  calculateBookingCharge,
  calculatePlatformFeeAmount,
  classifyHttpError,
  createExponentialBackoffDate,
  createPaymentIdempotencyKey,
  evaluateCardAuthentication,
  formatMoneyValue,
  isSameMoneyAmount,
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
  describe("calculateBookingCharge", () => {
    it("charges a deposit share of the stay plus the fee on that deposit", () => {
      expect(
        calculateBookingCharge(1000, {
          depositBps: 2500,
          platformFeeBps: 1000,
        }),
      ).toEqual({
        depositAmount: 250,
        platformFeeAmount: 25,
        totalAmount: 275,
      });
    });

    it("rounds each amount to cents", () => {
      expect(
        calculateBookingCharge(333.33, {
          depositBps: 2500,
          platformFeeBps: 1000,
        }),
      ).toEqual({
        depositAmount: 83.33,
        platformFeeAmount: 8.33,
        totalAmount: 91.66,
      });
    });
  });

  it("compares money amounts at cent precision", () => {
    expect(isSameMoneyAmount(0.1 + 0.2, 0.3)).toBe(true);
    expect(isSameMoneyAmount(10, 10.01)).toBe(false);
  });

  describe("evaluateCardAuthentication", () => {
    it.each([
      ["no 3-D Secure result", undefined],
      ["no liability shift", {}],
      [
        "liability shift POSSIBLE",
        {
          liabilityShift: "POSSIBLE",
          enrollmentStatus: "Y",
          authenticationStatus: "Y",
        },
      ],
      ["liability shift YES", { liabilityShift: "YES" }],
      [
        "an attempted authentication",
        {
          liabilityShift: "possible",
          enrollmentStatus: "Y",
          authenticationStatus: "A",
        },
      ],
      ["a card not enrolled", { liabilityShift: "NO", enrollmentStatus: "N" }],
      [
        "an unavailable enrollment check",
        { liabilityShift: "NO", enrollmentStatus: "U" },
      ],
      [
        "a bypassed authentication",
        { liabilityShift: "NO", enrollmentStatus: "B" },
      ],
    ])("captures with %s", (_label, result) => {
      expect(evaluateCardAuthentication(result)).toEqual({ capture: true });
    });

    it.each([
      [
        "a failed authentication",
        {
          liabilityShift: "NO",
          enrollmentStatus: "Y",
          authenticationStatus: "N",
        },
      ],
      [
        "a rejected authentication",
        {
          liabilityShift: "NO",
          enrollmentStatus: "Y",
          authenticationStatus: "R",
        },
      ],
      [
        "an enrolled card without a result",
        { liabilityShift: "NO", enrollmentStatus: "Y" },
      ],
      ["no enrollment result", { liabilityShift: "NO" }],
    ])("refuses %s", (_label, result) => {
      expect(evaluateCardAuthentication(result)).toEqual({
        capture: false,
        code: "CARD_AUTHENTICATION_FAILED",
        message: expect.stringContaining("could not verify"),
      });
    });

    it.each([
      [
        "an unknown liability shift",
        { liabilityShift: "UNKNOWN", enrollmentStatus: "Y" },
      ],
      [
        "an unavailable authentication",
        {
          liabilityShift: "NO",
          enrollmentStatus: "Y",
          authenticationStatus: "U",
        },
      ],
      [
        "a challenge that never finished",
        {
          liabilityShift: "NO",
          enrollmentStatus: "Y",
          authenticationStatus: "C",
        },
      ],
      ["an unrecognized liability shift", { liabilityShift: "MAYBE" }],
    ])("asks the renter to retry for %s", (_label, result) => {
      expect(evaluateCardAuthentication(result)).toEqual({
        capture: false,
        code: "CARD_AUTHENTICATION_UNAVAILABLE",
        message: expect.stringContaining("unavailable"),
      });
    });
  });
});
