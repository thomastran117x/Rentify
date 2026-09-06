import { PendingSignupStore } from "@/features/auth/pending-signup/pending-signup.store";

function createHarness() {
  const store = new Map<string, unknown>();
  const cacheService = {
    getJson: jest.fn(async (key: string) => store.get(key) ?? null),
    setJson: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    delete: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    acquireLock: jest.fn(async () => ({ release: jest.fn() })),
  };
  const usernameBloomService = {
    add: jest.fn(async () => undefined),
  };
  const emailBloomService = {
    add: jest.fn(async () => undefined),
  };

  return {
    store,
    cacheService,
    usernameBloomService,
    emailBloomService,
    pendingSignupStore: new PendingSignupStore(
      cacheService as never,
      usernameBloomService as never,
      emailBloomService as never,
    ),
  };
}

function createSignup(overrides: Record<string, unknown> = {}) {
  return {
    username: "test-user",
    email: "User@Example.com",
    passwordHash: "$2b$12$hash",
    firstName: "Test",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("PendingSignupStore", () => {
  it("writes the record by email and the email by username", async () => {
    const harness = createHarness();

    await harness.pendingSignupStore.write(createSignup(), 600);

    expect(harness.cacheService.setJson).toHaveBeenNthCalledWith(
      1,
      "auth:pending-signup:user@example.com",
      createSignup(),
      600,
    );
    expect(harness.cacheService.setJson).toHaveBeenNthCalledWith(
      2,
      "auth:pending-signup-username:test-user",
      "User@Example.com",
      600,
    );
  });

  it("adds the reserved username to the bloom filter", async () => {
    const harness = createHarness();

    await harness.pendingSignupStore.write(createSignup(), 600);

    expect(harness.usernameBloomService.add).toHaveBeenCalledWith("test-user");
  });

  it("releases the previous username when a resubmitted signup renames", async () => {
    const harness = createHarness();
    await harness.pendingSignupStore.write(createSignup(), 600);

    await harness.pendingSignupStore.write(
      createSignup({ username: "renamed-user" }),
      600,
    );

    expect(harness.cacheService.delete).toHaveBeenCalledWith(
      "auth:pending-signup-username:test-user",
    );
    expect(harness.store.get("auth:pending-signup-username:renamed-user")).toBe(
      "User@Example.com",
    );
  });

  it("keeps the username reservation when the name is unchanged", async () => {
    const harness = createHarness();
    await harness.pendingSignupStore.write(createSignup(), 600);

    await harness.pendingSignupStore.write(
      createSignup({ firstName: "Changed" }),
      600,
    );

    expect(harness.cacheService.delete).not.toHaveBeenCalled();
  });

  it("reads a record back by email, case-insensitively", async () => {
    const harness = createHarness();
    await harness.pendingSignupStore.write(createSignup(), 600);

    await expect(
      harness.pendingSignupStore.read("USER@EXAMPLE.COM"),
    ).resolves.toMatchObject({ username: "test-user" });
  });

  it("returns null for an unknown email", async () => {
    const harness = createHarness();

    await expect(
      harness.pendingSignupStore.read("nobody@example.com"),
    ).resolves.toBeNull();
  });

  it("resolves the pending email from a reserved username", async () => {
    const harness = createHarness();
    await harness.pendingSignupStore.write(createSignup(), 600);

    await expect(
      harness.pendingSignupStore.readEmailByUsername("test-user"),
    ).resolves.toBe("User@Example.com");
  });

  it("deletes both keys", async () => {
    const harness = createHarness();
    await harness.pendingSignupStore.write(createSignup(), 600);

    await harness.pendingSignupStore.delete("user@example.com");

    expect(harness.store.size).toBe(0);
  });

  it("deletes the record key even when nothing is stored", async () => {
    const harness = createHarness();

    await harness.pendingSignupStore.delete("nobody@example.com");

    expect(harness.cacheService.delete).toHaveBeenCalledWith(
      "auth:pending-signup:nobody@example.com",
    );
  });

  it("takes the verification lock on the normalized email", async () => {
    const harness = createHarness();

    await harness.pendingSignupStore.acquireVerificationLock(
      "User@Example.com",
    );

    expect(harness.cacheService.acquireLock).toHaveBeenCalledWith(
      "auth:pending-signup-verify:user@example.com",
      10_000,
    );
  });

  it("records the reserved email in the email bloom filter", async () => {
    // The reservation key is what the rebuild scans, and the filter is what
    // stops the availability endpoint skipping the lookup that finds it.
    //
    // Handed over as written, exactly as the username is: the filter folds it
    // with the subject normalizer that has to agree with the unique index, so
    // normalizing again here would only risk the two disagreeing.
    const harness = createHarness();

    await harness.pendingSignupStore.write(createSignup(), 600);

    expect(harness.emailBloomService.add).toHaveBeenCalledWith(
      "User@Example.com",
    );
  });
});
