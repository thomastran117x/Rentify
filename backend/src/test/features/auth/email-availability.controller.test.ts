import type { EmailAvailabilityService } from "@/features/auth/email-availability/email-availability.service";
import { EmailAvailabilityController } from "@/features/auth/email-availability/email-availability.controller";
import {
  createClaims,
  createContext,
  invoke,
} from "../../support/auth-controller-harness";
import { testUuid } from "../../support/uuid";

const USER_7_ID = testUuid(9000, 994263);

const mockGetOptionalJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: jest.fn(),
  getOptionalJwtAuth: (...args: unknown[]) => mockGetOptionalJwtAuth(...args),
}));

function createController() {
  const emailAvailabilityService = {
    resolveEmailAvailabilityHint: jest.fn(async () => ({
      email: "casey@example.com",
      available: true,
      reason: null,
    })),
  };

  return {
    emailAvailabilityService,
    controller: new EmailAvailabilityController(
      emailAvailabilityService as unknown as EmailAvailabilityService,
    ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetOptionalJwtAuth.mockResolvedValue(undefined);
});

describe("EmailAvailabilityController.checkEmailAvailability", () => {
  it("normalizes the query and answers for an anonymous caller", async () => {
    const { controller, emailAvailabilityService } = createController();

    const response = await invoke(
      controller.checkEmailAvailability,
      createContext({
        url: "https://example.test/auth/email/available?email=Casey%40Example.COM",
      }),
    );

    expect(
      emailAvailabilityService.resolveEmailAvailabilityHint,
    ).toHaveBeenCalledWith("casey@example.com", undefined);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { email: "casey@example.com", available: true },
    });
  });

  it("passes the signed-in caller's id so their own address reads as free", async () => {
    mockGetOptionalJwtAuth.mockResolvedValue(createClaims({ sub: USER_7_ID }));
    const { controller, emailAvailabilityService } = createController();

    await invoke(
      controller.checkEmailAvailability,
      createContext({
        url: "https://example.test/auth/email/available?email=casey@example.com",
      }),
    );

    expect(
      emailAvailabilityService.resolveEmailAvailabilityHint,
    ).toHaveBeenCalledWith("casey@example.com", USER_7_ID);
  });

  it("rejects a request with no email", async () => {
    const { controller, emailAvailabilityService } = createController();

    await expect(
      invoke(
        controller.checkEmailAvailability,
        createContext({ url: "https://example.test/auth/email/available" }),
      ),
    ).rejects.toMatchObject({ name: "RequestValidationError" });
    expect(
      emailAvailabilityService.resolveEmailAvailabilityHint,
    ).not.toHaveBeenCalled();
  });

  it("rejects a value that is not an email address", async () => {
    const { controller, emailAvailabilityService } = createController();

    await expect(
      invoke(
        controller.checkEmailAvailability,
        createContext({
          url: "https://example.test/auth/email/available?email=not-an-email",
        }),
      ),
    ).rejects.toMatchObject({ name: "RequestValidationError" });
    expect(
      emailAvailabilityService.resolveEmailAvailabilityHint,
    ).not.toHaveBeenCalled();
  });

  it("surfaces the pending-verification reason unchanged", async () => {
    // The frontend needs to tell "nobody has this" apart from "you already
    // started signing up with this", and both are available.
    const { controller, emailAvailabilityService } = createController();
    emailAvailabilityService.resolveEmailAvailabilityHint.mockResolvedValue({
      email: "casey@example.com",
      available: true,
      reason: "pending-verification",
    } as never);

    const response = await invoke(
      controller.checkEmailAvailability,
      createContext({
        url: "https://example.test/auth/email/available?email=casey@example.com",
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      data: { available: true, reason: "pending-verification" },
    });
  });
});
