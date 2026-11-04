import { expect, test, type APIRequestContext } from "@playwright/test";

const apiBaseUrl =
  process.env.PLAYWRIGHT_API_BASE_URL || "http://127.0.0.1:8040/api/v1";

type FlowStart = {
  state: string;
  nonce: string;
  codeChallenge?: string;
  tokenDelivery: "code" | "id_token";
  expiresInSeconds: number;
};

async function startFlow(
  request: APIRequestContext,
  provider: "google" | "microsoft" | "apple",
  deviceId: string,
): Promise<FlowStart> {
  const response = await request.post(
    `${apiBaseUrl}/auth/oauth/${provider}/start`,
    { data: { intent: "login", deviceId } },
  );
  expect(response.status()).toBe(200);
  return (await response.json()).data as FlowStart;
}

/**
 * Every OAuth sign-in now starts on the server, which issues the state and
 * nonce and spends them on the callback. A real provider round-trip cannot be
 * automated, so these checks stop at the provider: the API contract, and the
 * browser wiring up to the provider's redirect.
 */
test.describe("OAuth state", () => {
  test("the server issues a state, nonce and delivery mode per provider", async ({
    request,
  }) => {
    const google = await startFlow(request, "google", "e2e-oauth-state");
    const microsoft = await startFlow(request, "microsoft", "e2e-oauth-state");
    const apple = await startFlow(request, "apple", "e2e-oauth-state");

    expect(google).toMatchObject({
      tokenDelivery: "code",
      codeChallenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expiresInSeconds: 600,
    });
    expect(microsoft.tokenDelivery).toBe("id_token");
    expect(apple.tokenDelivery).toBe("id_token");
    expect(new Set([google.state, microsoft.state, apple.state]).size).toBe(3);
    expect(google.nonce).not.toBe(google.state);
  });

  test("a link cannot be started without signing in", async ({ request }) => {
    const response = await request.post(
      `${apiBaseUrl}/auth/oauth/google/start`,
      { data: { intent: "link", deviceId: "e2e-oauth-state" } },
    );

    expect(response.status()).toBe(401);
    expect((await response.json()).data).toBeNull();
  });

  test("a callback with a made-up or reused state is rejected", async ({
    request,
  }) => {
    const madeUp = await request.post(`${apiBaseUrl}/auth/oauth/microsoft`, {
      data: {
        state: "made-up-state",
        idToken: "not-a-jwt",
        deviceId: "e2e-oauth-state",
      },
    });
    expect(madeUp.status()).toBe(401);
    expect((await madeUp.json()).error?.code).toBe("OAUTH_STATE_INVALID");

    const flow = await startFlow(request, "microsoft", "e2e-oauth-state");
    const body = {
      state: flow.state,
      idToken: "not-a-jwt",
      deviceId: "e2e-oauth-state",
    };

    // The first use gets past the state, so the token itself is what fails.
    const first = await request.post(`${apiBaseUrl}/auth/oauth/microsoft`, {
      data: body,
    });
    expect((await first.json()).error?.code).not.toBe("OAUTH_STATE_INVALID");

    const replay = await request.post(`${apiBaseUrl}/auth/oauth/microsoft`, {
      data: body,
    });
    expect(replay.status()).toBe(401);
    expect((await replay.json()).error?.code).toBe("OAUTH_STATE_INVALID");
  });

  test("Google sign-in starts on the server, then hands the code back with that state", async ({
    page,
  }) => {
    await page.goto("/login");
    const googleButton = page.getByRole("button", {
      name: "Continue with Google",
    });
    test.skip(
      !(await googleButton.isVisible().catch(() => false)),
      "Needs a frontend built with NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID.",
    );

    // Stand in for Google: send the popup straight back to the app's callback
    // page with a code Google never issued and the state it was given.
    await page.context().route("https://accounts.google.com/**", (route) => {
      const authorize = new URL(route.request().url());
      const callback = new URL(authorize.searchParams.get("redirect_uri")!);
      callback.searchParams.set("code", "e2e-unredeemable-code");
      callback.searchParams.set(
        "state",
        authorize.searchParams.get("state") ?? "",
      );
      return route.fulfill({
        status: 302,
        headers: { location: callback.toString() },
      });
    });

    const startRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().endsWith("/auth/oauth/google/start"),
    );
    const callbackRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().endsWith("/auth/oauth/google"),
    );
    const popupPromise = page.waitForEvent("popup");
    await googleButton.click();

    const start = await startRequest;
    expect(start.postDataJSON()).toMatchObject({ intent: "login" });
    const startResponse = await start.response();
    const { data: flow } = (await startResponse!.json()) as {
      data: FlowStart;
    };

    const popup = await popupPromise;
    await popup.waitForEvent("close");

    const callback = await callbackRequest;
    // The state the server issued, the code, and nothing the client made up.
    expect(callback.postDataJSON()).toMatchObject({
      state: flow.state,
      code: "e2e-unredeemable-code",
    });
    expect(callback.postDataJSON()).not.toHaveProperty("nonce");
    expect(callback.postDataJSON()).not.toHaveProperty("codeVerifier");

    // Google refuses the code, so the sign-in fails at the provider, past the
    // state check, and the page says so instead of hanging.
    const callbackResponse = await callback.response();
    expect(
      ((await callbackResponse!.json()) as { error?: { code?: string } }).error
        ?.code,
    ).not.toBe("OAUTH_STATE_INVALID");
    await expect(googleButton).toBeEnabled();
  });

  test("a sign-in the server no longer recognises asks the user to start again", async ({
    page,
  }) => {
    await page.goto("/login");
    const googleButton = page.getByRole("button", {
      name: "Continue with Google",
    });
    test.skip(
      !(await googleButton.isVisible().catch(() => false)),
      "Needs a frontend built with NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID.",
    );

    await page.context().route("https://accounts.google.com/**", (route) => {
      const authorize = new URL(route.request().url());
      const callback = new URL(authorize.searchParams.get("redirect_uri")!);
      callback.searchParams.set("code", "e2e-unredeemable-code");
      callback.searchParams.set(
        "state",
        authorize.searchParams.get("state") ?? "",
      );
      return route.fulfill({
        status: 302,
        headers: { location: callback.toString() },
      });
    });
    // Present a state the server never issued, as a replayed or forged
    // callback would.
    await page.route("**/auth/oauth/google", (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      return route.continue({
        postData: JSON.stringify({ ...body, state: "forged-state" }),
      });
    });

    await googleButton.click();

    await expect(
      page.getByText(
        "This sign-in expired or was already used. Please try again.",
      ),
    ).toBeVisible({ timeout: 15_000 });
    await expect(googleButton).toBeEnabled();
  });
});
