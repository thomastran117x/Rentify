import { isoBase64URL } from "@simplewebauthn/server/helpers";
import ConflictError from "@/errors/http/conflict.error";
import PasskeyRegistrationFailedError from "@/errors/http/passkey-registration-failed.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { PasskeyChallengeStore } from "@/features/auth/mfa/passkey/passkey-challenge.store";
import { MAX_PASSKEYS_PER_USER } from "@/features/auth/mfa/passkey/passkey.model";
import { PasskeyService } from "@/features/auth/mfa/passkey/passkey.service";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";
import { createInMemoryCache } from "../../../support/in-memory-cache";
import {
  buildPasskeyRow,
  createInMemoryPasskeyRepository,
} from "../../../support/passkey-fakes";
import { testUuid } from "../../../support/uuid";
import {
  SoftwareAuthenticator,
  TEST_WEBAUTHN_ORIGIN,
  TEST_WEBAUTHN_RP_ID,
} from "../../../support/webauthn-authenticator";

const USER_ID = testUuid(9000, 465101);
const OTHER_USER_ID = testUuid(9000, 465102);
const CONTEXT = { ipAddress: "127.0.0.1", requestId: "request-1" };
const ACTOR = { userId: USER_ID, sessionId: "session-1", context: CONTEXT };
const AUTH = {
  authMethod: "jwt",
  sub: USER_ID,
  sessionId: "session-1",
} as JwtAuthPrincipal;
const RECOVERY_CODE_SET = {
  codes: ["ABCDE-FGH23"],
  rows: [{ id: "code-1", userId: USER_ID, codeHash: "a".repeat(64) }],
};

const USER = {
  id: USER_ID,
  email: "renter@example.com",
  firstName: "Casey",
  lastName: "Renter",
  profile: { username: "casey" },
};

function createService(
  options: {
    rows?: ReturnType<typeof buildPasskeyRow>[];
    user?: unknown;
    totpActive?: boolean;
  } = {},
) {
  const cache = createInMemoryCache();
  const passkeyRepository = createInMemoryPasskeyRepository(
    options.rows,
    options.totpActive ? [USER_ID] : [],
  );
  const passkeyChallengeStore = new PasskeyChallengeStore(cache as never);
  const usersRepository = {
    findUserById: jest.fn(async () =>
      "user" in options ? options.user : USER,
    ),
  };
  const authAuditService = { recordSafely: jest.fn(async () => undefined) };
  const securityNotificationService = {
    notify: jest.fn(async () => "sent" as const),
  };
  const mfaRecoveryCodeService = {
    generateSet: jest.fn(() => RECOVERY_CODE_SET),
  };
  const authSessionService = {
    revokeManagedSessions: jest.fn(async () => ({}) as never),
  };
  const service = new PasskeyService({
    passkeyRepository: passkeyRepository as never,
    passkeyChallengeStore,
    usersRepository: usersRepository as never,
    mfaFactorRepository: { getSummary: passkeyRepository.factorSummary },
    mfaRecoveryCodeService,
    authSessionService,
    authAuditService: authAuditService as never,
    securityNotificationService: securityNotificationService as never,
    getConfig: () => ({
      rpId: TEST_WEBAUTHN_RP_ID,
      rpName: "Rentify",
      origins: [TEST_WEBAUTHN_ORIGIN],
    }),
  });

  return {
    cache,
    service,
    passkeyRepository,
    authAuditService,
    authSessionService,
    securityNotificationService,
  };
}

async function register(
  service: PasskeyService,
  authenticator = new SoftwareAuthenticator(),
  overrides: { origin?: string; rpId?: string; name?: string } = {},
) {
  const { options } = await service.beginRegistration(ACTOR);

  return service.finishRegistration({
    ...ACTOR,
    name: overrides.name,
    credential: authenticator.createRegistrationResponse({
      challenge: options.challenge,
      origin: overrides.origin,
      rpId: overrides.rpId,
    }) as never,
  });
}

describe("PasskeyService registration", () => {
  it("asks for a discoverable passkey on the configured relying party", async () => {
    const existing = buildPasskeyRow({
      id: testUuid(9000, 465103),
      userId: USER_ID,
      transports: ["usb", "nfc"],
    });
    const { service, cache } = createService({ rows: [existing] });

    const { options } = await service.beginRegistration(ACTOR);

    expect(options).toMatchObject({
      rp: { id: TEST_WEBAUTHN_RP_ID, name: "Rentify" },
      user: {
        id: isoBase64URL.fromUTF8String(USER_ID),
        name: "casey",
        displayName: "Casey Renter",
      },
      attestation: "none",
      timeout: 300_000,
      pubKeyCredParams: [
        { alg: -8, type: "public-key" },
        { alg: -7, type: "public-key" },
        { alg: -257, type: "public-key" },
      ],
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
      excludeCredentials: [
        {
          id: isoBase64URL.fromBuffer(existing.credentialId),
          type: "public-key",
          transports: ["usb", "nfc"],
        },
      ],
    });
    expect(cache.values.size).toBe(1);
  });

  it("falls back to the username when the account has no name", async () => {
    const { service } = createService({
      user: { ...USER, firstName: undefined, lastName: undefined },
    });

    const { options } = await service.beginRegistration(ACTOR);

    expect(options.user.displayName).toBe("casey");
  });

  it("refuses a session whose account is gone", async () => {
    const { service } = createService({ user: null });

    await expect(service.beginRegistration(ACTOR)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it("refuses to start once the account holds the most passkeys it may", async () => {
    const rows = Array.from({ length: MAX_PASSKEYS_PER_USER }, (_, index) =>
      buildPasskeyRow({ id: testUuid(9100, index), userId: USER_ID }),
    );
    const { service, cache } = createService({ rows });

    await expect(service.beginRegistration(ACTOR)).rejects.toThrow(
      `An account can hold at most ${MAX_PASSKEYS_PER_USER} passkeys.`,
    );
    expect(cache.values.size).toBe(0);
  });

  it("stores a verified passkey, then emails and audits its addition", async () => {
    const {
      service,
      passkeyRepository,
      securityNotificationService,
      authAuditService,
    } = createService();
    const authenticator = new SoftwareAuthenticator();

    const result = await register(service, authenticator);

    expect(result.passkey).toEqual({
      id: expect.any(String),
      name: "Passkey 1",
      createdAt: expect.any(String),
      lastUsedAt: null,
      backedUp: false,
      deviceType: "single_device",
      transports: ["internal"],
    });
    expect(passkeyRepository.rows).toHaveLength(1);
    expect(
      Buffer.from(passkeyRepository.rows[0].credentialId).equals(
        Buffer.from(authenticator.credentialId),
      ),
    ).toBe(true);
    expect(passkeyRepository.rows[0].signCount).toBe(1n);
    expect(result.recoveryCodes).toEqual(RECOVERY_CODE_SET.codes);
    expect(passkeyRepository.createWithinCap).toHaveBeenCalledWith(
      expect.anything(),
      RECOVERY_CODE_SET.rows,
    );

    const notification = securityNotificationService.notify.mock
      .calls[0] as unknown[];
    expect(notification[0]).toMatchObject({
      kind: "passkey_added",
      details: { passkeyName: "Passkey 1" },
      userId: USER_ID,
      context: CONTEXT,
    });
    const audit = authAuditService.recordSafely.mock.calls[0] as unknown[];
    expect(audit[0]).toMatchObject({
      id: (notification[0] as { eventId: string }).eventId,
      eventType: "mfa.passkey_added",
      outcome: "success",
      userId: USER_ID,
      sessionId: "session-1",
      metadata: {
        passkeyId: result.passkey.id,
        deviceType: "single_device",
        backedUp: false,
        recoveryCodesIssued: true,
        emailNotification: "sent",
      },
    });
  });

  it("records a synced passkey and keeps a chosen name", async () => {
    const { service } = createService();

    const result = await register(
      service,
      new SoftwareAuthenticator({ synced: true }),
      { name: "Work laptop" },
    );

    expect(result.passkey).toMatchObject({
      name: "Work laptop",
      backedUp: true,
      deviceType: "multi_device",
    });
  });

  it("numbers default names after the passkeys the account already has", async () => {
    const { service } = createService();

    await register(service);
    const second = await register(service);

    expect(second.passkey.name).toBe("Passkey 2");
    // The account kept the set the first passkey came with.
    expect(second.recoveryCodes).toBeUndefined();
  });

  it("refuses an answer with no challenge outstanding", async () => {
    const { service, passkeyRepository } = createService();

    await expect(
      service.finishRegistration({
        ...ACTOR,
        credential: new SoftwareAuthenticator().createRegistrationResponse({
          challenge: "bm90LWlzc3VlZA",
        }) as never,
      }),
    ).rejects.toBeInstanceOf(PasskeyRegistrationFailedError);
    expect(passkeyRepository.createWithinCap).not.toHaveBeenCalled();
  });

  it("refuses a replayed answer", async () => {
    const { service } = createService();
    const authenticator = new SoftwareAuthenticator();
    const { options } = await service.beginRegistration(ACTOR);
    const credential = authenticator.createRegistrationResponse({
      challenge: options.challenge,
    });

    await service.finishRegistration({
      ...ACTOR,
      credential: credential as never,
    });

    await expect(
      service.finishRegistration({ ...ACTOR, credential: credential as never }),
    ).rejects.toThrow("That passkey request has expired.");
  });

  it("refuses to finish from a session other than the one that started", async () => {
    const { service } = createService();
    const { options } = await service.beginRegistration(ACTOR);

    await expect(
      service.finishRegistration({
        ...ACTOR,
        sessionId: "session-2",
        credential: new SoftwareAuthenticator().createRegistrationResponse({
          challenge: options.challenge,
        }) as never,
      }),
    ).rejects.toBeInstanceOf(PasskeyRegistrationFailedError);
  });

  it("refuses a challenge issued to another account", async () => {
    const { service, cache } = createService();
    await service.beginRegistration(ACTOR);
    const [key, value] = [...cache.values.entries()][0];
    cache.values.set(
      key,
      JSON.stringify({ ...JSON.parse(value), userId: OTHER_USER_ID }),
    );

    await expect(
      service.finishRegistration({
        ...ACTOR,
        credential: new SoftwareAuthenticator().createRegistrationResponse({
          challenge: JSON.parse(value).challenge,
        }) as never,
      }),
    ).rejects.toBeInstanceOf(PasskeyRegistrationFailedError);
  });

  it.each([
    ["another origin", { origin: "https://evil.example" }],
    ["another RP ID", { rpId: "evil.example" }],
  ])("refuses an attestation made for %s", async (_label, overrides) => {
    const { service, passkeyRepository, securityNotificationService } =
      createService();

    await expect(
      register(service, new SoftwareAuthenticator(), overrides),
    ).rejects.toBeInstanceOf(PasskeyRegistrationFailedError);
    expect(passkeyRepository.rows).toHaveLength(0);
    expect(securityNotificationService.notify).not.toHaveBeenCalled();
  });

  it("reports a passkey that is already registered", async () => {
    const { service } = createService();
    const authenticator = new SoftwareAuthenticator();
    await register(service, authenticator);

    await expect(register(service, authenticator)).rejects.toThrow(
      new ConflictError("This passkey is already registered."),
    );
  });

  it("refuses a registration that would exceed the cap", async () => {
    const { service, passkeyRepository } = createService();
    const { options } = await service.beginRegistration(ACTOR);
    passkeyRepository.createWithinCap.mockResolvedValueOnce({
      status: "limit_reached",
    });

    await expect(
      service.finishRegistration({
        ...ACTOR,
        credential: new SoftwareAuthenticator().createRegistrationResponse({
          challenge: options.challenge,
        }) as never,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rethrows an unexpected storage failure", async () => {
    const { service, passkeyRepository } = createService();
    const { options } = await service.beginRegistration(ACTOR);
    passkeyRepository.createWithinCap.mockRejectedValueOnce(
      new Error("database down"),
    );

    await expect(
      service.finishRegistration({
        ...ACTOR,
        credential: new SoftwareAuthenticator().createRegistrationResponse({
          challenge: options.challenge,
        }) as never,
      }),
    ).rejects.toThrow("database down");
  });
});

describe("PasskeyService management", () => {
  const PASSKEY_ID = testUuid(9000, 465110);

  it("lists the account's passkeys without their keys", async () => {
    const { service } = createService({
      rows: [
        {
          ...buildPasskeyRow({
            id: PASSKEY_ID,
            userId: USER_ID,
            name: "Phone",
            backedUp: true,
            deviceType: "multi_device",
          }),
          transports: ["hybrid", "bogus", "hybrid"],
          lastUsedAt: new Date("2026-11-10T10:00:00.000Z"),
        },
        buildPasskeyRow({ id: testUuid(9000, 465111), userId: OTHER_USER_ID }),
      ],
    });

    await expect(service.list(USER_ID)).resolves.toEqual({
      passkeys: [
        {
          id: PASSKEY_ID,
          name: "Phone",
          createdAt: "2026-11-10T09:00:00.000Z",
          lastUsedAt: "2026-11-10T10:00:00.000Z",
          backedUp: true,
          deviceType: "multi_device",
          transports: ["hybrid"],
        },
      ],
    });
  });

  it("treats stored transports that are not a list as none", async () => {
    const { service } = createService({
      rows: [
        {
          ...buildPasskeyRow({ id: PASSKEY_ID, userId: USER_ID }),
          transports: null,
        },
      ],
    });

    const { passkeys } = await service.list(USER_ID);

    expect(passkeys[0].transports).toEqual([]);
  });

  it("renames a passkey and audits it without an email", async () => {
    const { service, authAuditService, securityNotificationService } =
      createService({
        rows: [buildPasskeyRow({ id: PASSKEY_ID, userId: USER_ID })],
      });

    await expect(
      service.rename({ ...ACTOR, id: PASSKEY_ID, name: "Laptop" }),
    ).resolves.toMatchObject({ id: PASSKEY_ID, name: "Laptop" });
    expect(authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "mfa.passkey_renamed",
        userId: USER_ID,
        metadata: { passkeyId: PASSKEY_ID },
      }),
    );
    expect(securityNotificationService.notify).not.toHaveBeenCalled();
  });

  it("cannot rename another account's passkey", async () => {
    const { service, authAuditService } = createService({
      rows: [buildPasskeyRow({ id: PASSKEY_ID, userId: OTHER_USER_ID })],
    });

    await expect(
      service.rename({ ...ACTOR, id: PASSKEY_ID, name: "Mine now" }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(authAuditService.recordSafely).not.toHaveBeenCalled();
  });

  it("removes one of several passkeys without touching other sessions", async () => {
    const {
      service,
      passkeyRepository,
      securityNotificationService,
      authAuditService,
      authSessionService,
    } = createService({
      rows: [
        buildPasskeyRow({ id: PASSKEY_ID, userId: USER_ID, name: "Old key" }),
        buildPasskeyRow({ id: testUuid(9000, 465112), userId: USER_ID }),
      ],
    });

    await service.remove({ ...ACTOR, auth: AUTH, id: PASSKEY_ID });

    expect(passkeyRepository.rows).toHaveLength(1);
    expect(authSessionService.revokeManagedSessions).not.toHaveBeenCalled();
    expect(securityNotificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "passkey_removed",
        details: { passkeyName: "Old key", endedOtherSessions: false },
      }),
    );
    expect(authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "mfa.passkey_removed",
        metadata: {
          passkeyId: PASSKEY_ID,
          lastStrongFactor: false,
          otherSessionsSignedOut: false,
          emailNotification: "sent",
        },
      }),
    );
  });

  it("keeps other sessions when an authenticator still protects the account", async () => {
    const { service, authSessionService } = createService({
      rows: [buildPasskeyRow({ id: PASSKEY_ID, userId: USER_ID })],
      totpActive: true,
    });

    await service.remove({ ...ACTOR, auth: AUTH, id: PASSKEY_ID });

    expect(authSessionService.revokeManagedSessions).not.toHaveBeenCalled();
  });

  it("signs out other sessions before removing the last strong factor", async () => {
    const {
      service,
      passkeyRepository,
      authSessionService,
      securityNotificationService,
    } = createService({
      rows: [buildPasskeyRow({ id: PASSKEY_ID, userId: USER_ID })],
    });

    await service.remove({ ...ACTOR, auth: AUTH, id: PASSKEY_ID });

    expect(authSessionService.revokeManagedSessions).toHaveBeenCalledWith({
      auth: AUTH,
      scope: "others",
      audit: CONTEXT,
    });
    expect(
      authSessionService.revokeManagedSessions.mock.invocationCallOrder[0],
    ).toBeLessThan(
      passkeyRepository.deleteForUser.mock.invocationCallOrder[0]!,
    );
    expect(securityNotificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ endedOtherSessions: true }),
      }),
    );
  });

  it("keeps the passkey when the sessions cannot be ended", async () => {
    const { service, passkeyRepository, authSessionService } = createService({
      rows: [buildPasskeyRow({ id: PASSKEY_ID, userId: USER_ID })],
    });
    authSessionService.revokeManagedSessions.mockRejectedValueOnce(
      new Error("redis unavailable"),
    );

    await expect(
      service.remove({ ...ACTOR, auth: AUTH, id: PASSKEY_ID }),
    ).rejects.toThrow("redis unavailable");
    expect(passkeyRepository.rows).toHaveLength(1);
  });

  it("ends other sessions after all when the authenticator went in between", async () => {
    const { service, passkeyRepository, authSessionService } = createService({
      rows: [buildPasskeyRow({ id: PASSKEY_ID, userId: USER_ID })],
      totpActive: true,
    });
    passkeyRepository.deleteForUser.mockImplementationOnce(async () => ({
      row: passkeyRepository.rows.splice(0, 1)[0]!,
      lastStrongFactor: true,
    }));

    await service.remove({ ...ACTOR, auth: AUTH, id: PASSKEY_ID });

    expect(authSessionService.revokeManagedSessions).toHaveBeenCalledTimes(1);
    expect(
      passkeyRepository.deleteForUser.mock.invocationCallOrder[0],
    ).toBeLessThan(
      authSessionService.revokeManagedSessions.mock.invocationCallOrder[0]!,
    );
  });

  it("reports a passkey removed by another request in between", async () => {
    const { service, passkeyRepository } = createService({
      rows: [
        buildPasskeyRow({ id: PASSKEY_ID, userId: USER_ID }),
        buildPasskeyRow({ id: testUuid(9000, 465113), userId: USER_ID }),
      ],
    });
    passkeyRepository.deleteForUser.mockResolvedValueOnce(null);

    await expect(
      service.remove({ ...ACTOR, auth: AUTH, id: PASSKEY_ID }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("cannot remove another account's passkey, or sign anyone out trying", async () => {
    const { service, passkeyRepository, authSessionService } = createService({
      rows: [buildPasskeyRow({ id: PASSKEY_ID, userId: OTHER_USER_ID })],
    });

    await expect(
      service.remove({ ...ACTOR, auth: AUTH, id: PASSKEY_ID }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(passkeyRepository.rows).toHaveLength(1);
    expect(authSessionService.revokeManagedSessions).not.toHaveBeenCalled();
  });
});
