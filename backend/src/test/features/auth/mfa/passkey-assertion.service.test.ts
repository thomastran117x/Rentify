import { isoBase64URL } from "@simplewebauthn/server/helpers";
import MfaFactorUnavailableError from "@/errors/http/mfa-factor-unavailable.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { PasskeyChallengeStore } from "@/features/auth/mfa/passkey/passkey-challenge.store";
import { PasskeyService } from "@/features/auth/mfa/passkey/passkey.service";
import { createInMemoryCache } from "../../../support/in-memory-cache";
import { createInMemoryPasskeyRepository } from "../../../support/passkey-fakes";
import { testUuid } from "../../../support/uuid";
import {
  SoftwareAuthenticator,
  TEST_WEBAUTHN_ORIGIN,
  TEST_WEBAUTHN_RP_ID,
} from "../../../support/webauthn-authenticator";

const USER_ID = testUuid(9000, 465401);
const OTHER_USER_ID = testUuid(9000, 465402);
const ACTOR = { userId: USER_ID, sessionId: "session-1" };
const BINDING = `${USER_ID}:session-1:mfa-management`;
const CONTEXT = { requestId: "request-1" };

function createService() {
  const cache = createInMemoryCache();
  const passkeyRepository = createInMemoryPasskeyRepository();
  const authAuditService = { recordSafely: jest.fn(async () => undefined) };
  const service = new PasskeyService({
    passkeyRepository: passkeyRepository as never,
    passkeyChallengeStore: new PasskeyChallengeStore(cache as never),
    usersRepository: {
      findUserById: jest.fn(async (id: string) => ({
        id,
        profile: { username: "casey" },
      })) as never,
    },
    mfaFactorRepository: { getSummary: passkeyRepository.factorSummary },
    mfaRecoveryCodeService: {
      generateSet: jest.fn(() => ({ codes: [], rows: [] })),
    },
    authSessionService: { revokeManagedSessions: jest.fn() },
    authAuditService: authAuditService as never,
    deviceTrustService: {
      recordFactorChangeRevocation: jest.fn(async () => undefined),
    },
    securityNotificationService: {
      notify: jest.fn(async () => "sent" as const),
    } as never,
    getConfig: () => ({
      rpId: TEST_WEBAUTHN_RP_ID,
      rpName: "Rentify",
      origins: [TEST_WEBAUTHN_ORIGIN],
    }),
  });

  return { cache, service, passkeyRepository, authAuditService };
}

async function registerFor(
  service: PasskeyService,
  authenticator: SoftwareAuthenticator,
  userId = USER_ID,
) {
  const actor = { userId, sessionId: "session-1" };
  const { options } = await service.beginRegistration(actor);
  await service.finishRegistration({
    ...actor,
    credential: authenticator.createRegistrationResponse({
      challenge: options.challenge,
    }) as never,
  });
}

async function challenge(service: PasskeyService, binding = BINDING) {
  const options = await service.beginAssertion({
    userId: USER_ID,
    purpose: "step-up",
    binding,
  });
  return options.challenge;
}

function verify(
  service: PasskeyService,
  credential: unknown,
  overrides: { binding?: string; purpose?: "step-up" | "login" } = {},
) {
  return service.verifyAssertion({
    userId: USER_ID,
    purpose: overrides.purpose ?? "step-up",
    binding: overrides.binding ?? BINDING,
    credential: credential as never,
    sessionId: ACTOR.sessionId,
    context: CONTEXT,
  });
}

describe("PasskeyService assertions", () => {
  it("offers only the account's passkeys and prefers user verification", async () => {
    const { service, cache } = createService();
    const authenticator = new SoftwareAuthenticator();
    await registerFor(service, authenticator);
    await registerFor(service, new SoftwareAuthenticator(), OTHER_USER_ID);
    cache.ttls.clear();

    const options = await service.beginAssertion({
      userId: USER_ID,
      purpose: "login",
      binding: "login-token",
      ttlSeconds: 120,
    });

    expect(options).toMatchObject({
      rpId: TEST_WEBAUTHN_RP_ID,
      userVerification: "preferred",
      timeout: 120_000,
      allowCredentials: [
        { id: authenticator.id, type: "public-key", transports: ["internal"] },
      ],
    });
    expect([...cache.ttls.values()]).toEqual([120]);
  });

  it("never keeps a challenge longer than five minutes", async () => {
    const { service, cache } = createService();
    await registerFor(service, new SoftwareAuthenticator());
    cache.ttls.clear();

    await service.beginAssertion({
      userId: USER_ID,
      purpose: "step-up",
      binding: BINDING,
      ttlSeconds: 3_600,
    });

    expect([...cache.ttls.values()]).toEqual([300]);
  });

  it("is unavailable to an account without a passkey", async () => {
    const { service } = createService();

    await expect(
      service.beginAssertion({
        userId: USER_ID,
        purpose: "step-up",
        binding: BINDING,
      }),
    ).rejects.toBeInstanceOf(MfaFactorUnavailableError);
  });

  it("accepts a fresh assertion and records its use", async () => {
    const { service, passkeyRepository } = createService();
    const authenticator = new SoftwareAuthenticator({ synced: true });
    await registerFor(service, authenticator);

    const result = await verify(
      service,
      authenticator.createAssertionResponse({
        challenge: await challenge(service),
        userHandle: isoBase64URL.fromUTF8String(USER_ID),
      }),
    );

    const [row] = passkeyRepository.rows;
    expect(result).toEqual({ passkeyId: row!.id });
    expect(row!.lastUsedAt).toBeInstanceOf(Date);
    expect(row!.backedUp).toBe(true);
  });

  it("advances the stored counter of a single-device passkey", async () => {
    const { service, passkeyRepository } = createService();
    const authenticator = new SoftwareAuthenticator({ initialCounter: 4 });
    await registerFor(service, authenticator);

    await verify(
      service,
      authenticator.createAssertionResponse({
        challenge: await challenge(service),
      }),
    );

    expect(passkeyRepository.rows[0]!.signCount).toBe(5n);
  });

  it("refuses a replayed assertion", async () => {
    const { service } = createService();
    const authenticator = new SoftwareAuthenticator({ synced: true });
    await registerFor(service, authenticator);
    const assertion = authenticator.createAssertionResponse({
      challenge: await challenge(service),
    });

    await verify(service, assertion);

    await expect(verify(service, assertion)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it("refuses an answer to a challenge issued for something else", async () => {
    const { service } = createService();
    const authenticator = new SoftwareAuthenticator();
    await registerFor(service, authenticator);
    const issued = await challenge(service, "other-session");

    await expect(
      verify(
        service,
        authenticator.createAssertionResponse({ challenge: issued }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    // A step-up challenge cannot finish a sign-in either.
    await expect(
      verify(
        service,
        authenticator.createAssertionResponse({ challenge: issued }),
        { purpose: "login", binding: "other-session" },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("refuses a challenge that was issued to another account", async () => {
    const { service, cache } = createService();
    const authenticator = new SoftwareAuthenticator();
    await registerFor(service, authenticator);
    const issued = await challenge(service);
    const [key, value] = [...cache.values.entries()].at(-1)!;
    cache.values.set(
      key,
      JSON.stringify({ ...JSON.parse(value), userId: OTHER_USER_ID }),
    );

    await expect(
      verify(
        service,
        authenticator.createAssertionResponse({ challenge: issued }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it.each([
    ["another origin", { origin: "https://rentify.example.evil" }],
    ["another RP ID", { rpId: "evil.example" }],
    ["a registration", { type: "webauthn.create" }],
  ])("refuses an assertion made for %s", async (_label, overrides) => {
    const { service, passkeyRepository } = createService();
    const authenticator = new SoftwareAuthenticator();
    await registerFor(service, authenticator);

    await expect(
      verify(
        service,
        authenticator.createAssertionResponse({
          challenge: await challenge(service),
          ...overrides,
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(passkeyRepository.rows[0]!.lastUsedAt).toBeNull();
  });

  it("refuses a passkey the account does not have", async () => {
    const { service } = createService();
    await registerFor(service, new SoftwareAuthenticator());
    const stranger = new SoftwareAuthenticator();
    await registerFor(service, stranger, OTHER_USER_ID);

    await expect(
      verify(
        service,
        stranger.createAssertionResponse({
          challenge: await challenge(service),
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("refuses a signature the stored key did not make", async () => {
    const { service } = createService();
    const authenticator = new SoftwareAuthenticator();
    await registerFor(service, authenticator);
    const assertion = authenticator.createAssertionResponse({
      challenge: await challenge(service),
    });
    const forged = new SoftwareAuthenticator().createAssertionResponse({
      challenge: "unused",
    });

    await expect(
      verify(service, {
        ...assertion,
        response: {
          ...assertion.response,
          signature: forged.response.signature,
        },
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("refuses a user handle that names another account", async () => {
    const { service } = createService();
    const authenticator = new SoftwareAuthenticator();
    await registerFor(service, authenticator);

    await expect(
      verify(
        service,
        authenticator.createAssertionResponse({
          challenge: await challenge(service),
          userHandle: isoBase64URL.fromUTF8String(OTHER_USER_ID),
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it.each([
    ["went backwards", 3],
    ["did not move", 5],
  ])(
    "refuses and audits a single-device passkey whose counter %s",
    async (_label, counter) => {
      const { service, passkeyRepository, authAuditService } = createService();
      const authenticator = new SoftwareAuthenticator({ initialCounter: 5 });
      await registerFor(service, authenticator);
      authAuditService.recordSafely.mockClear();

      await expect(
        verify(
          service,
          authenticator.createAssertionResponse({
            challenge: await challenge(service),
            counter,
          }),
        ),
      ).rejects.toBeInstanceOf(UnauthorizedError);

      const [row] = passkeyRepository.rows;
      expect(row!.signCount).toBe(5n);
      expect(authAuditService.recordSafely).toHaveBeenCalledWith({
        eventType: "mfa.passkey_assertion_rejected",
        outcome: "failure",
        reasonCode: "mfa_invalid",
        userId: USER_ID,
        sessionId: "session-1",
        method: undefined,
        context: CONTEXT,
        metadata: {
          passkeyId: row!.id,
          stage: "step_up",
          reason: "counter_regressed",
          storedCounter: 5,
          receivedCounter: counter,
        },
      });
    },
  );

  it("records the sign-in stage when a counter goes backwards at login", async () => {
    const { service, authAuditService } = createService();
    const authenticator = new SoftwareAuthenticator({ initialCounter: 5 });
    await registerFor(service, authenticator);
    const options = await service.beginAssertion({
      userId: USER_ID,
      purpose: "login",
      binding: "token",
    });

    await expect(
      service.verifyAssertion({
        userId: USER_ID,
        purpose: "login",
        binding: "token",
        method: "password",
        credential: authenticator.createAssertionResponse({
          challenge: options.challenge,
          counter: 1,
        }) as never,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    expect(authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "password",
        sessionId: undefined,
        metadata: expect.objectContaining({ stage: "login" }),
      }),
    );
  });

  it("lets a synced passkey's counter stay at zero or go backwards", async () => {
    const { service, passkeyRepository } = createService();
    const authenticator = new SoftwareAuthenticator({ synced: true });
    await registerFor(service, authenticator);

    for (const counter of [0, 0, 7, 2]) {
      await verify(
        service,
        authenticator.createAssertionResponse({
          challenge: await challenge(service),
          counter,
        }),
      );
    }

    // Never moved backwards by the synced copy that lagged.
    expect(passkeyRepository.rows[0]!.signCount).toBe(7n);
  });

  it("refuses an assertion that lost a race for the counter", async () => {
    const { service, passkeyRepository } = createService();
    const authenticator = new SoftwareAuthenticator();
    await registerFor(service, authenticator);
    passkeyRepository.claimSignCount.mockResolvedValueOnce(false);

    await expect(
      verify(
        service,
        authenticator.createAssertionResponse({
          challenge: await challenge(service),
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("PasskeyService discoverable sign-in assertions", () => {
  async function discoverableChallenge(service: PasskeyService) {
    return (await service.beginDiscoverableAssertion()).challenge;
  }

  function signIn(service: PasskeyService, credential: unknown) {
    return service.verifyDiscoverableAssertion({
      credential: credential as never,
      context: CONTEXT,
    });
  }

  const userHandle = isoBase64URL.fromUTF8String(USER_ID);

  it("names no passkeys, requires user verification and lasts five minutes", async () => {
    const { service, cache } = createService();
    await registerFor(service, new SoftwareAuthenticator());
    cache.ttls.clear();

    const options = await service.beginDiscoverableAssertion();

    expect(options).toMatchObject({
      rpId: TEST_WEBAUTHN_RP_ID,
      userVerification: "required",
      timeout: 300_000,
    });
    expect(options.allowCredentials ?? []).toEqual([]);
    expect([...cache.ttls.values()]).toEqual([300]);
  });

  it("signs in the account the passkey belongs to and records its use", async () => {
    const { service, passkeyRepository } = createService();
    const authenticator = new SoftwareAuthenticator();
    await registerFor(service, authenticator);

    const result = await signIn(
      service,
      authenticator.createAssertionResponse({
        challenge: await discoverableChallenge(service),
        userHandle,
      }),
    );

    expect(result).toEqual({
      status: "verified",
      userId: USER_ID,
      passkeyId: passkeyRepository.rows[0]!.id,
    });
    expect(passkeyRepository.rows[0]!.lastUsedAt).toBeInstanceOf(Date);
  });

  it("accepts each challenge once", async () => {
    const { service } = createService();
    const authenticator = new SoftwareAuthenticator();
    await registerFor(service, authenticator);
    const value = await discoverableChallenge(service);

    await signIn(
      service,
      authenticator.createAssertionResponse({ challenge: value, userHandle }),
    );

    await expect(
      signIn(
        service,
        authenticator.createAssertionResponse({ challenge: value, userHandle }),
      ),
    ).resolves.toEqual({ status: "rejected", reason: "challenge_missing" });
  });

  it("never accepts a challenge issued for another purpose", async () => {
    const { service } = createService();
    const authenticator = new SoftwareAuthenticator();
    await registerFor(service, authenticator);

    await expect(
      signIn(
        service,
        authenticator.createAssertionResponse({
          challenge: await challenge(service),
          userHandle,
        }),
      ),
    ).resolves.toEqual({ status: "rejected", reason: "challenge_missing" });
  });

  it("refuses an answer whose client data cannot be read", async () => {
    const { service } = createService();
    const authenticator = new SoftwareAuthenticator();
    await registerFor(service, authenticator);
    await discoverableChallenge(service);
    const credential = authenticator.createAssertionResponse({
      challenge: "unused",
      userHandle,
    });

    await expect(
      signIn(service, {
        ...credential,
        response: { ...credential.response, clientDataJSON: "bm90LWpzb24" },
      }),
    ).resolves.toEqual({ status: "rejected", reason: "challenge_missing" });
  });

  it("names no account for a passkey that is not registered", async () => {
    const { service } = createService();
    await registerFor(service, new SoftwareAuthenticator());

    await expect(
      signIn(
        service,
        new SoftwareAuthenticator().createAssertionResponse({
          challenge: await discoverableChallenge(service),
          userHandle,
        }),
      ),
    ).resolves.toEqual({ status: "rejected", reason: "unknown_credential" });
  });

  it.each([
    ["is missing", undefined],
    ["names another account", isoBase64URL.fromUTF8String(OTHER_USER_ID)],
  ])("refuses a passkey whose user handle %s", async (_label, handle) => {
    const { service, passkeyRepository } = createService();
    const authenticator = new SoftwareAuthenticator();
    await registerFor(service, authenticator);

    await expect(
      signIn(
        service,
        authenticator.createAssertionResponse({
          challenge: await discoverableChallenge(service),
          userHandle: handle,
        }),
      ),
    ).resolves.toEqual({
      status: "rejected",
      reason: "user_handle_mismatch",
      userId: USER_ID,
      passkeyId: passkeyRepository.rows[0]!.id,
    });
  });

  it("refuses a passkey that did not verify its user", async () => {
    const { service } = createService();
    const authenticator = new SoftwareAuthenticator({ userVerified: false });
    await registerFor(service, authenticator);

    await expect(
      signIn(
        service,
        authenticator.createAssertionResponse({
          challenge: await discoverableChallenge(service),
          userHandle,
        }),
      ),
    ).resolves.toMatchObject({
      status: "rejected",
      reason: "verification_failed",
      userId: USER_ID,
    });
  });

  it("refuses an answer from another origin", async () => {
    const { service } = createService();
    const authenticator = new SoftwareAuthenticator();
    await registerFor(service, authenticator);

    await expect(
      signIn(
        service,
        authenticator.createAssertionResponse({
          challenge: await discoverableChallenge(service),
          origin: "https://phish.example",
          userHandle,
        }),
      ),
    ).resolves.toMatchObject({
      status: "rejected",
      reason: "verification_failed",
    });
  });

  it("refuses and audits a single-device passkey whose counter went back", async () => {
    const { service, authAuditService } = createService();
    const authenticator = new SoftwareAuthenticator({ initialCounter: 5 });
    await registerFor(service, authenticator);

    await expect(
      signIn(
        service,
        authenticator.createAssertionResponse({
          challenge: await discoverableChallenge(service),
          counter: 3,
          userHandle,
        }),
      ),
    ).resolves.toMatchObject({
      status: "rejected",
      reason: "counter_regressed",
    });
    expect(authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "mfa.passkey_assertion_rejected",
        userId: USER_ID,
        method: "passkey",
        metadata: expect.objectContaining({
          stage: "login",
          reason: "counter_regressed",
        }),
      }),
    );
  });

  it("signs in with a synced passkey whose counter stays at zero", async () => {
    const { service } = createService();
    const authenticator = new SoftwareAuthenticator({ synced: true });
    await registerFor(service, authenticator);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        signIn(
          service,
          authenticator.createAssertionResponse({
            challenge: await discoverableChallenge(service),
            userHandle,
          }),
        ),
      ).resolves.toMatchObject({ status: "verified" });
    }
  });

  it("refuses an assertion that lost a race for the counter", async () => {
    const { service, passkeyRepository } = createService();
    const authenticator = new SoftwareAuthenticator();
    await registerFor(service, authenticator);
    passkeyRepository.claimSignCount.mockResolvedValueOnce(false);

    await expect(
      signIn(
        service,
        authenticator.createAssertionResponse({
          challenge: await discoverableChallenge(service),
          userHandle,
        }),
      ),
    ).resolves.toMatchObject({ status: "rejected", reason: "counter_race" });
  });
});
