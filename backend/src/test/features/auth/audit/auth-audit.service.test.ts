import { AuthAuditService } from "@/features/auth/audit/auth-audit.service";
import { hashAuthIdentifier } from "@/features/auth/audit/auth-audit-identifier";
import type { RecordAuthAuditEventInput } from "@/features/auth/audit/auth-audit.model";
import { testUuid } from "../../../support/uuid";

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
};

jest.mock("@/configuration/logging", () => ({
  loggerFactory: {
    forClass: () => mockLogger,
  },
}));

const USER_1_ID = testUuid(9000, 994257);
const SECRET = "test-auth-audit-identifier-secret-32";

function createInput(
  overrides: Partial<RecordAuthAuditEventInput> = {},
): RecordAuthAuditEventInput {
  return {
    eventType: "login.failed",
    outcome: "failure",
    reasonCode: "bad_credentials",
    method: "password",
    userId: USER_1_ID,
    identifierHash: "b".repeat(64),
    context: {
      ipAddress: "203.0.113.7",
      userAgent: "Mozilla/5.0",
      deviceId: "device-1",
      requestId: "request-1",
    },
    ...overrides,
  };
}

function createService(create = jest.fn(async () => undefined)) {
  return {
    create,
    service: new AuthAuditService({ create } as any, {
      identifierSecret: SECRET,
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLogger.child.mockReturnValue(mockLogger);
});

describe("AuthAuditService", () => {
  it("hashes identifiers with the configured secret", () => {
    const { service } = createService();

    expect(service.hashIdentifier(" Owner-One")).toBe(
      hashAuthIdentifier("owner-one", SECRET),
    );
  });

  it("falls back to the environment secret", () => {
    const service = new AuthAuditService({ create: jest.fn() } as any);

    expect(service.hashIdentifier("owner-one")).toBe(
      hashAuthIdentifier("owner-one", "test-auth-audit-identifier-secret-32"),
    );
  });

  it("records the event through the repository", async () => {
    const { service, create } = createService();
    const input = createInput();

    await service.record(input);

    expect(create).toHaveBeenCalledWith(input);
  });

  it("propagates a failed write from record", async () => {
    const { service } = createService(
      jest.fn(async () => {
        throw new Error("database unavailable");
      }),
    );

    await expect(service.record(createInput())).rejects.toThrow(
      "database unavailable",
    );
  });

  it("logs one structured line per outcome, scoped to the request", async () => {
    const { service, create } = createService();

    await service.recordSafely(createInput());

    expect(mockLogger.child).toHaveBeenCalledWith({ requestId: "request-1" });
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith("Auth event.", {
      eventType: "login.failed",
      outcome: "failure",
      reasonCode: "bad_credentials",
      userId: USER_1_ID,
      identifierHash: "b".repeat(64),
      ipAddress: "203.0.113.7",
    });
    expect(mockLogger.info).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("logs a successful outcome at info level", async () => {
    const { service } = createService();

    await service.recordSafely(
      createInput({
        eventType: "login.succeeded",
        outcome: "success",
        reasonCode: undefined,
        userId: null,
        context: undefined,
      }),
    );

    expect(mockLogger.child).toHaveBeenCalledWith({ requestId: undefined });
    expect(mockLogger.info).toHaveBeenCalledWith(
      "Auth event.",
      expect.objectContaining({
        eventType: "login.succeeded",
        outcome: "success",
        userId: undefined,
        ipAddress: undefined,
      }),
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("swallows a failed write and logs it without the input's extras", async () => {
    const failure = new Error("database unavailable");
    const { service } = createService(
      jest.fn(async () => {
        throw failure;
      }),
    );

    await expect(
      service.recordSafely(
        createInput({ outcome: "blocked", metadata: { triggered: true } }),
      ),
    ).resolves.toBeUndefined();

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to record auth audit event.",
      {
        eventType: "login.failed",
        outcome: "blocked",
        userId: USER_1_ID,
        error: failure,
      },
    );
  });

  it("logs a failed write without a user id when the event has none", async () => {
    const { service } = createService(
      jest.fn(async () => {
        throw new Error("database unavailable");
      }),
    );

    await service.recordSafely(createInput({ userId: undefined }));

    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to record auth audit event.",
      expect.objectContaining({ userId: undefined }),
    );
  });

  describe("listeners", () => {
    /** Lets the listeners `recordSafely` started without waiting run. */
    function flushListeners() {
      return new Promise((resolve) => setImmediate(resolve));
    }

    it("tells each listener about a written event, with the id it was stored under", async () => {
      const { service, create } = createService();
      const first = jest.fn(async () => undefined);
      const second = jest.fn(async () => undefined);
      service.subscribe(first);
      service.subscribe(second);

      await service.recordSafely(createInput());
      await flushListeners();

      const written = (create.mock.calls as unknown as unknown[][])[0]![0] as {
        id: string;
      };
      expect(written.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(first).toHaveBeenCalledWith({ ...createInput(), id: written.id });
      expect(second).toHaveBeenCalledWith(written);
    });

    it("keeps an id the caller chose", async () => {
      const { service, create } = createService();
      const listener = jest.fn(async () => undefined);
      const id = testUuid(9100, 379301);
      service.subscribe(listener);

      await service.recordSafely(createInput({ id }));
      await flushListeners();

      expect(create).toHaveBeenCalledWith(expect.objectContaining({ id }));
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id }));
    });

    it("answers the caller before a listener finishes", async () => {
      const { service } = createService();
      let release!: () => void;
      const listener = jest.fn(
        () => new Promise<void>((resolve) => (release = resolve)),
      );
      service.subscribe(listener);

      await expect(
        service.recordSafely(createInput()),
      ).resolves.toBeUndefined();
      await flushListeners();

      expect(listener).toHaveBeenCalledTimes(1);
      release();
    });

    it("does not tell listeners about an event that failed to write", async () => {
      const { service } = createService(
        jest.fn(async () => {
          throw new Error("database unavailable");
        }),
      );
      const listener = jest.fn(async () => undefined);
      service.subscribe(listener);

      await service.recordSafely(createInput());
      await flushListeners();

      expect(listener).not.toHaveBeenCalled();
    });

    it("logs a listener that rejects or throws, and still runs the others", async () => {
      const { service } = createService();
      const failure = new Error("listener broke");
      const rejecting = jest.fn(async () => {
        throw failure;
      });
      const throwing = jest.fn(() => {
        throw failure;
      });
      const healthy = jest.fn(async () => undefined);
      service.subscribe(rejecting);
      service.subscribe(throwing as any);
      service.subscribe(healthy);

      await expect(
        service.recordSafely(createInput()),
      ).resolves.toBeUndefined();
      await flushListeners();

      expect(healthy).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Auth audit listener failed.",
        expect.objectContaining({ eventType: "login.failed", error: failure }),
      );
    });
  });
});
