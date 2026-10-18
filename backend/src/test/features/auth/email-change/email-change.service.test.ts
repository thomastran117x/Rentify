import TooManyRequestError from "@/errors/http/too-many-request.error";
import BadRequestError from "@/errors/http/bad-request.error";
import { EmailChangeService } from "@/features/auth/email-change/email-change.service";
import type { EmailChangeStore } from "@/features/auth/email-change/email-change.store";
import type { EmailAvailabilityService } from "@/features/auth/email-availability/email-availability.service";
import type { IdentityBloomService } from "@/features/auth/identity-bloom/identity-bloom.service";
import type { AuthSessionService } from "@/features/auth/session/session.service";
import type { EmailService } from "@/features/email/email.service";
import type { OtpService } from "@/features/auth/otp/otp.service";
import type { TokenRepository } from "@/features/auth/token/token.repository";
import type { UsersRepository } from "@/features/auth/users/users.repository";
import {
  createClient,
  createSessionResult,
} from "../../../support/auth-controller-harness";
import { testUuid } from "../../../support/uuid";

const USER_ID = testUuid(9200, 100);
const OTHER_USER_ID = testUuid(9200, 200);
const CURRENT_EMAIL = "owner1@rentify.local";
const NEW_EMAIL = "owner-one-new@rentify.local";

function createUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: CURRENT_EMAIL,
    firstName: "Owner",
    emailVerified: true,
    tokenVersion: 3,
    profile: { username: "owner-one" },
    ...overrides,
  };
}

function createRecord(overrides: Record<string, unknown> = {}) {
  return {
    userId: USER_ID,
    currentEmail: CURRENT_EMAIL,
    newEmail: NEW_EMAIL,
    requestedAt: "2026-09-07T00:00:00.000Z",
    ...overrides,
  };
}

function createHarness() {
  const usersRepository = {
    findUserById: jest.fn(async () => createUser()),
    updateUserEmail: jest.fn(async () => createUser({ email: NEW_EMAIL })),
  };
  const tokenRepository = { rotateTokenVersion: jest.fn(async () => 4) };
  const store = {
    read: jest.fn(async () => null as unknown),
    readTtlInSeconds: jest.fn(async () => 540),
    write: jest.fn(async () => undefined),
    reserveAddress: jest.fn(async () => true),
    readAddressHolder: jest.fn(async () => null as string | null),
    releaseAddress: jest.fn(async () => undefined),
    acquireConfirmLock: jest.fn(async () => ({
      release: jest.fn(async () => true),
    })),
    clear: jest.fn(async () => undefined),
  };
  const emailAvailabilityService = {
    isEmailAvailable: jest.fn(async () => ({
      email: NEW_EMAIL,
      available: true,
      reason: null,
    })),
  };
  const otpService = {
    getTtlInSeconds: jest.fn(() => 600),
    issue: jest.fn(async () => ({
      code: "123456",
      ttlInSeconds: 600,
      resendAvailableInSeconds: 60,
    })),
    verify: jest.fn(async () => undefined),
    peek: jest.fn(async () => ({ code: "123456", expiresInSeconds: 540 })),
  };
  const emailService = {
    sendEmailChangeCodeEmail: jest.fn(async () => undefined),
    sendEmailChangeNoticeEmail: jest.fn(async () => undefined),
  };
  const authSessionService = {
    reissueSessionForUser: jest.fn(async () => createSessionResult()),
  };
  const emailBloomService = { add: jest.fn(async () => undefined) };
  const authAuditService = { recordSafely: jest.fn(async () => undefined) };

  const service = new EmailChangeService(
    usersRepository as unknown as UsersRepository,
    tokenRepository as unknown as TokenRepository,
    store as unknown as EmailChangeStore,
    emailAvailabilityService as unknown as EmailAvailabilityService,
    otpService as unknown as OtpService,
    emailService as unknown as EmailService,
    authSessionService as unknown as AuthSessionService,
    emailBloomService as unknown as IdentityBloomService,
    authAuditService as never,
  );

  return {
    service,
    authAuditService,
    usersRepository,
    tokenRepository,
    store,
    emailAvailabilityService,
    otpService,
    emailService,
    authSessionService,
    emailBloomService,
  };
}

const requestInput = {
  userId: USER_ID,
  newEmail: NEW_EMAIL,
  client: createClient(),
  deviceId: "device-1",
};

describe("EmailChangeService.requestChange", () => {
  it("reserves the address, issues a code, and mails both parties", async () => {
    const harness = createHarness();

    const result = await harness.service.requestChange(requestInput);

    expect(harness.store.reserveAddress).toHaveBeenCalledWith(
      NEW_EMAIL,
      USER_ID,
      600,
    );
    expect(harness.otpService.issue).toHaveBeenCalledWith({
      purpose: "email-change",
      subject: NEW_EMAIL,
    });
    expect(harness.emailService.sendEmailChangeCodeEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: NEW_EMAIL, verificationCode: "123456" }),
    );
    expect(
      harness.emailService.sendEmailChangeNoticeEmail,
    ).toHaveBeenCalledWith(expect.objectContaining({ to: CURRENT_EMAIL }));
    expect(harness.store.write).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        currentEmail: CURRENT_EMAIL,
        newEmail: NEW_EMAIL,
      }),
      600,
    );
    expect(result).toEqual({
      newEmail: "o***@rentify.local",
      expiresInSeconds: 600,
      resendAvailableInSeconds: 60,
    });
  });

  it("never echoes the pending address back in full", async () => {
    const harness = createHarness();

    const result = await harness.service.requestChange(requestInput);

    expect(result.newEmail).not.toBe(NEW_EMAIL);
  });

  it("refuses the address the account already holds, before sending anything", async () => {
    const harness = createHarness();

    await expect(
      harness.service.requestChange({
        ...requestInput,
        newEmail: CURRENT_EMAIL.toUpperCase(),
      }),
    ).rejects.toMatchObject({ code: "EMAIL_CHANGE_SAME_ADDRESS" });
    expect(harness.otpService.issue).not.toHaveBeenCalled();
    expect(harness.store.reserveAddress).not.toHaveBeenCalled();
  });

  it("refuses an address another account owns", async () => {
    const harness = createHarness();
    harness.emailAvailabilityService.isEmailAvailable.mockResolvedValue({
      email: NEW_EMAIL,
      available: false,
      reason: "taken",
    } as never);

    await expect(
      harness.service.requestChange(requestInput),
    ).rejects.toMatchObject({ code: "EMAIL_CHANGE_ADDRESS_UNAVAILABLE" });
    expect(harness.otpService.issue).not.toHaveBeenCalled();
  });

  it("allows an address with only a half-finished signup against it", async () => {
    const harness = createHarness();
    harness.emailAvailabilityService.isEmailAvailable.mockResolvedValue({
      email: NEW_EMAIL,
      available: true,
      reason: "pending-verification",
    } as never);

    await expect(
      harness.service.requestChange(requestInput),
    ).resolves.toMatchObject({ expiresInSeconds: 600 });
  });

  it("refuses an address another user is mid-claim on", async () => {
    const harness = createHarness();
    harness.store.reserveAddress.mockResolvedValue(false);

    await expect(
      harness.service.requestChange(requestInput),
    ).rejects.toMatchObject({ code: "EMAIL_CHANGE_ADDRESS_UNAVAILABLE" });
    expect(harness.otpService.issue).not.toHaveBeenCalled();
  });

  it("gives the reservation back when the code cannot be issued", async () => {
    const harness = createHarness();
    harness.otpService.issue.mockRejectedValue(
      new TooManyRequestError("A verification code was sent recently.", {
        retryAfterSeconds: 42,
      }),
    );

    await expect(harness.service.requestChange(requestInput)).rejects.toThrow(
      TooManyRequestError,
    );
    expect(harness.store.releaseAddress).toHaveBeenCalledWith(
      NEW_EMAIL,
      USER_ID,
    );
    expect(harness.store.write).not.toHaveBeenCalled();
  });

  it("keeps a reservation it already held when a resend is rate limited", async () => {
    const harness = createHarness();
    harness.store.read.mockResolvedValue(createRecord());
    harness.otpService.issue.mockRejectedValue(
      new TooManyRequestError("A verification code was sent recently."),
    );

    await expect(harness.service.requestChange(requestInput)).rejects.toThrow(
      TooManyRequestError,
    );
    expect(harness.store.releaseAddress).not.toHaveBeenCalled();
  });

  it("releases the previous address when the request is retargeted", async () => {
    const harness = createHarness();
    harness.store.read.mockResolvedValue(
      createRecord({ newEmail: "typo@rentify.local" }),
    );

    await harness.service.requestChange(requestInput);

    expect(harness.store.releaseAddress).toHaveBeenCalledWith(
      "typo@rentify.local",
      USER_ID,
    );
  });

  it("records the claim in the bloom filter so availability stops reporting it free", async () => {
    const harness = createHarness();

    await harness.service.requestChange(requestInput);

    expect(harness.emailBloomService.add).toHaveBeenCalledWith(NEW_EMAIL);
  });
});

describe("EmailChangeService.resendCode", () => {
  it("re-issues against the address already pending", async () => {
    const harness = createHarness();
    harness.store.read.mockResolvedValue(createRecord());

    const result = await harness.service.resendCode({
      userId: USER_ID,
      client: createClient(),
    });

    expect(harness.otpService.issue).toHaveBeenCalledWith({
      purpose: "email-change",
      subject: NEW_EMAIL,
    });
    expect(
      harness.emailService.sendEmailChangeNoticeEmail,
    ).not.toHaveBeenCalled();
    expect(result.newEmail).toBe("o***@rentify.local");
  });

  /**
   * The resent code gets a full TTL of its own. If the record and reservation
   * kept the original deadline, a code resent late in the window would stop
   * working minutes before it expired — the user would hold a live code against
   * a request that no longer exists.
   */
  it("pushes the record and the reservation out to match the new code", async () => {
    const harness = createHarness();
    const record = createRecord();
    harness.store.read.mockResolvedValue(record);

    const result = await harness.service.resendCode({
      userId: USER_ID,
      client: createClient(),
    });

    expect(harness.store.write).toHaveBeenCalledWith(record, 600);
    expect(harness.store.reserveAddress).toHaveBeenCalledWith(
      NEW_EMAIL,
      USER_ID,
      600,
    );
    // The reported lifetime is now true of all three, not just the code.
    expect(result.expiresInSeconds).toBe(600);
  });

  it("refuses when nothing is pending", async () => {
    const harness = createHarness();

    await expect(
      harness.service.resendCode({ userId: USER_ID, client: createClient() }),
    ).rejects.toMatchObject({ code: "EMAIL_CHANGE_NOT_PENDING" });
  });

  it("refuses once the address has been taken since the request", async () => {
    const harness = createHarness();
    harness.store.read.mockResolvedValue(createRecord());
    harness.emailAvailabilityService.isEmailAvailable.mockResolvedValue({
      email: NEW_EMAIL,
      available: false,
      reason: "taken",
    } as never);

    await expect(
      harness.service.resendCode({ userId: USER_ID, client: createClient() }),
    ).rejects.toMatchObject({ code: "EMAIL_CHANGE_ADDRESS_UNAVAILABLE" });
  });
});

describe("EmailChangeService.confirmChange", () => {
  const confirmInput = {
    userId: USER_ID,
    code: "123456",
    client: createClient(),
    deviceId: "device-1",
    audit: { requestId: "request-1" },
  };

  it("writes the address, rotates the token version, and reissues the session", async () => {
    const harness = createHarness();
    harness.store.read.mockResolvedValue(createRecord());

    await harness.service.confirmChange(confirmInput);

    expect(harness.otpService.verify).toHaveBeenCalledWith({
      purpose: "email-change",
      subject: NEW_EMAIL,
      code: "123456",
    });
    expect(harness.usersRepository.updateUserEmail).toHaveBeenCalledWith(
      USER_ID,
      NEW_EMAIL,
    );
    expect(harness.tokenRepository.rotateTokenVersion).toHaveBeenCalledWith(
      USER_ID,
    );
    expect(harness.store.clear).toHaveBeenCalledWith(USER_ID);
    expect(
      harness.authSessionService.reissueSessionForUser,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        email: NEW_EMAIL,
        emailVerified: true,
        tokenVersion: 4,
      }),
      expect.any(Object),
      "device-1",
      { requestId: "request-1" },
    );
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith({
      eventType: "email.changed",
      outcome: "success",
      userId: USER_ID,
      sessionId: undefined,
      context: { requestId: "request-1" },
      metadata: {
        oldEmailMasked: "o***@rentify.local",
        newEmailMasked: "o***@rentify.local",
      },
    });
    const serializedAudit = JSON.stringify(
      harness.authAuditService.recordSafely.mock.calls,
    );
    expect(serializedAudit).not.toContain(CURRENT_EMAIL);
    expect(serializedAudit).not.toContain(NEW_EMAIL);
  });

  /**
   * A code proves control of the address it was mailed to. If the request is
   * retargeted between the OTP check and the lock, that proof does not carry
   * over to the new address, so the write must not happen.
   */
  it("refuses a code proven against an address the request has since moved off", async () => {
    const harness = createHarness();
    harness.store.read
      .mockResolvedValueOnce(createRecord())
      .mockResolvedValueOnce(
        createRecord({ newEmail: "somewhere-else@rentify.local" }),
      );

    await expect(
      harness.service.confirmChange(confirmInput),
    ).rejects.toMatchObject({ code: "EMAIL_CHANGE_NOT_PENDING" });
    expect(harness.usersRepository.updateUserEmail).not.toHaveBeenCalled();
    expect(harness.tokenRepository.rotateTokenVersion).not.toHaveBeenCalled();
  });

  it("checks the code before taking the lock, so a wrong one costs nothing", async () => {
    const harness = createHarness();
    harness.store.read.mockResolvedValue(createRecord());
    harness.otpService.verify.mockRejectedValue(
      new BadRequestError("Verification code is invalid.", {
        attemptsRemaining: 4,
      }),
    );

    await expect(harness.service.confirmChange(confirmInput)).rejects.toThrow(
      BadRequestError,
    );
    expect(harness.store.acquireConfirmLock).not.toHaveBeenCalled();
    expect(harness.usersRepository.updateUserEmail).not.toHaveBeenCalled();
  });

  it("refuses when nothing is pending", async () => {
    const harness = createHarness();

    await expect(
      harness.service.confirmChange(confirmInput),
    ).rejects.toMatchObject({ code: "EMAIL_CHANGE_NOT_PENDING" });
    expect(harness.otpService.verify).not.toHaveBeenCalled();
  });

  it("refuses when a concurrent confirm already holds the lock", async () => {
    const harness = createHarness();
    harness.store.read.mockResolvedValue(createRecord());
    harness.store.acquireConfirmLock.mockResolvedValue(null as never);

    await expect(
      harness.service.confirmChange(confirmInput),
    ).rejects.toMatchObject({ code: "EMAIL_CHANGE_NOT_PENDING" });
    expect(harness.usersRepository.updateUserEmail).not.toHaveBeenCalled();
  });

  it("refuses when the account email moved after the request started", async () => {
    const harness = createHarness();
    harness.store.read.mockResolvedValue(createRecord());
    harness.usersRepository.findUserById.mockResolvedValue(
      createUser({ email: "moved-elsewhere@rentify.local" }),
    );

    await expect(
      harness.service.confirmChange(confirmInput),
    ).rejects.toMatchObject({ code: "EMAIL_CHANGE_NOT_PENDING" });
    expect(harness.usersRepository.updateUserEmail).not.toHaveBeenCalled();
    expect(harness.store.clear).toHaveBeenCalledWith(USER_ID);
  });

  it("re-checks availability after the code, and drops the request if it lost", async () => {
    const harness = createHarness();
    harness.store.read.mockResolvedValue(createRecord());
    harness.emailAvailabilityService.isEmailAvailable.mockResolvedValue({
      email: NEW_EMAIL,
      available: false,
      reason: "taken",
    } as never);

    await expect(
      harness.service.confirmChange(confirmInput),
    ).rejects.toMatchObject({ code: "EMAIL_CHANGE_ADDRESS_UNAVAILABLE" });
    expect(harness.usersRepository.updateUserEmail).not.toHaveBeenCalled();
    expect(harness.store.clear).toHaveBeenCalledWith(USER_ID);
  });

  it("releases the lock even when the write fails", async () => {
    const harness = createHarness();
    const release = jest.fn(async () => true);
    harness.store.read.mockResolvedValue(createRecord());
    harness.store.acquireConfirmLock.mockResolvedValue({ release } as never);
    harness.usersRepository.updateUserEmail.mockRejectedValue(
      new Error("database is down"),
    );

    await expect(harness.service.confirmChange(confirmInput)).rejects.toThrow(
      "database is down",
    );
    expect(release).toHaveBeenCalled();
  });
});

describe("EmailChangeService pending state", () => {
  it("reports nothing pending when no request is in flight", async () => {
    const harness = createHarness();

    await expect(harness.service.readPending(USER_ID)).resolves.toEqual({
      pending: false,
    });
  });

  it("reports the redacted address and remaining ttl", async () => {
    const harness = createHarness();
    harness.store.read.mockResolvedValue(createRecord());

    await expect(harness.service.readPending(USER_ID)).resolves.toEqual({
      pending: true,
      newEmail: "o***@rentify.local",
      expiresInSeconds: 540,
    });
  });

  it("clears both keys on cancel", async () => {
    const harness = createHarness();

    await harness.service.cancelChange(USER_ID);

    expect(harness.store.clear).toHaveBeenCalledWith(USER_ID);
  });

  it("previews the code for the pending address only", async () => {
    const harness = createHarness();
    harness.store.read.mockResolvedValue(createRecord());

    await expect(harness.service.previewPendingCode(USER_ID)).resolves.toEqual({
      code: "123456",
      expiresInSeconds: 540,
    });
    expect(harness.otpService.peek).toHaveBeenCalledWith({
      purpose: "email-change",
      subject: NEW_EMAIL,
    });
  });

  it("has no code to preview when nothing is pending", async () => {
    const harness = createHarness();

    await expect(
      harness.service.previewPendingCode(USER_ID),
    ).resolves.toBeNull();
    expect(harness.otpService.peek).not.toHaveBeenCalled();
  });

  it("rejects a request from a session whose user is gone", async () => {
    const harness = createHarness();
    harness.usersRepository.findUserById.mockResolvedValue(null as never);

    await expect(harness.service.requestChange(requestInput)).rejects.toThrow(
      "Session is no longer valid.",
    );
  });

  it("does not treat another user's reservation as its own", async () => {
    const harness = createHarness();
    harness.store.readAddressHolder.mockResolvedValue(OTHER_USER_ID);
    harness.store.reserveAddress.mockResolvedValue(false);

    await expect(
      harness.service.requestChange(requestInput),
    ).rejects.toMatchObject({ code: "EMAIL_CHANGE_ADDRESS_UNAVAILABLE" });
  });
});
