import type { TokenCredential } from "@azure/identity";
import sharp from "sharp";
import {
  AzureContentSafetyModeration,
  CONTENT_SAFETY_API_VERSION,
  type AzureContentSafetyModerationOptions,
} from "@/features/media/moderation/azure-content-safety-moderation";
import {
  createImageModeration,
  PRODUCTION_WITHOUT_MODERATION_ERROR,
} from "@/features/media/moderation/create-image-moderation";
import {
  decideModeration,
  ImageModerationUnavailableError,
} from "@/features/media/moderation/image-moderation.service";
import { NoopModeration } from "@/features/media/moderation/noop-moderation";

const ENDPOINT = "https://rentify-safety.cognitiveservices.azure.com";
const SCOPE = "https://cognitiveservices.azure.com/.default";
const THRESHOLDS = { hate: 4, sexual: 4, violence: 4, selfHarm: 4 };
// Within Content Safety's limits, so it is sent as it is, undecoded.
const IMAGE = { data: Buffer.from("image bytes"), width: 100, height: 100 };

function analysis(
  severities: Partial<
    Record<"Hate" | "Sexual" | "Violence" | "SelfHarm", number>
  > = {},
) {
  return {
    categoriesAnalysis: [
      { category: "Hate", severity: severities.Hate ?? 0 },
      { category: "SelfHarm", severity: severities.SelfHarm ?? 0 },
      { category: "Sexual", severity: severities.Sexual ?? 0 },
      { category: "Violence", severity: severities.Violence ?? 0 },
    ],
  };
}

function respond(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers,
  });
}

function createModeration(
  overrides: Partial<AzureContentSafetyModerationOptions> = {},
) {
  return new AzureContentSafetyModeration({
    endpoint: ENDPOINT,
    scope: SCOPE,
    auth: { kind: "api-key", apiKey: "test-key" },
    timeoutMs: 1_000,
    blockAtSeverity: THRESHOLDS,
    ...overrides,
  });
}

function fakeCredential(
  getToken: TokenCredential["getToken"] = async () => ({
    token: "entra-token",
    expiresOnTimestamp: Date.now() + 60_000,
  }),
): TokenCredential {
  return { getToken: jest.fn(getToken) };
}

async function expectUnavailable(
  promise: Promise<unknown>,
  message: string | RegExp,
  status?: number,
) {
  const error = await promise.then(
    () => {
      throw new Error("Expected moderation to throw.");
    },
    (caught: unknown) => caught,
  );

  expect(error).toBeInstanceOf(ImageModerationUnavailableError);
  expect((error as Error).message).toMatch(message);
  expect((error as ImageModerationUnavailableError).status).toBe(status);
}

beforeEach(() => {
  jest.restoreAllMocks();
});

describe("decideModeration", () => {
  it("blocks when any category reaches its threshold", () => {
    expect(decideModeration({ violence: 4 }, THRESHOLDS)).toBe("block");
    expect(decideModeration({ hate: 6, sexual: 0 }, THRESHOLDS)).toBe("block");
    expect(
      decideModeration({ selfHarm: 2 }, { ...THRESHOLDS, selfHarm: 2 }),
    ).toBe("block");
  });

  it("allows severities under every threshold, and missing categories", () => {
    expect(
      decideModeration(
        { hate: 2, sexual: 2, violence: 2, selfHarm: 2 },
        THRESHOLDS,
      ),
    ).toBe("allow");
    expect(decideModeration({}, THRESHOLDS)).toBe("allow");
    expect(
      decideModeration({ violence: 6 }, { ...THRESHOLDS, violence: 7 }),
    ).toBe("allow");
  });

  it("blocks every image at a threshold of 0", () => {
    expect(
      decideModeration({ violence: 0 }, { ...THRESHOLDS, violence: 0 }),
    ).toBe("block");
  });
});

describe("NoopModeration", () => {
  it("allows every image without a provider", async () => {
    await expect(new NoopModeration().moderate()).resolves.toEqual({
      decision: "allow",
      categories: {},
      provider: "none",
    });
  });
});

describe("AzureContentSafetyModeration", () => {
  it("sends the image base64-encoded with the API key", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(respond(200, analysis()));

    await createModeration().moderate(IMAGE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${ENDPOINT}/contentsafety/image:analyze?api-version=${CONTENT_SAFETY_API_VERSION}`,
    );
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "Ocp-Apim-Subscription-Key": "test-key",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      image: { content: IMAGE.data.toString("base64") },
      categories: ["Hate", "Sexual", "Violence", "SelfHarm"],
      outputType: "FourSeverityLevels",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    // Padded with white, never enlarged.
    [12, 8, { width: 50, height: 50 }],
    // Fitted inside 2048 x 2048.
    [800, 2276, { width: 720, height: 2048 }],
  ])(
    "fits a %i x %i image to Content Safety's limits before sending it",
    async (width, height, sent) => {
      const fetchMock = jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(respond(200, analysis()));
      const data = await sharp({
        create: { width, height, channels: 3, background: "#336699" },
      })
        .webp()
        .toBuffer();

      await createModeration().moderate({ data, width, height });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const { image } = JSON.parse(init.body as string) as {
        image: { content: string };
      };
      await expect(
        sharp(Buffer.from(image.content, "base64")).metadata(),
      ).resolves.toMatchObject(sent);
    },
  );

  it("signs the request with an Entra ID token in entra mode", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(respond(200, analysis()));
    const credential = fakeCredential();

    await createModeration({
      auth: { kind: "entra", credential },
    }).moderate(IMAGE);

    expect(credential.getToken).toHaveBeenCalledWith(SCOPE);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer entra-token",
    });
  });

  it("asks for a token with the scope of the endpoint's cloud", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(respond(200, analysis()));
    const credential = fakeCredential();

    await createModeration({
      endpoint: "https://rentify-safety.cognitiveservices.azure.us",
      scope: "https://cognitiveservices.azure.us/.default",
      auth: { kind: "entra", credential },
    }).moderate(IMAGE);

    expect(credential.getToken).toHaveBeenCalledWith(
      "https://cognitiveservices.azure.us/.default",
    );
  });

  it("allows an image under every threshold and records its severities", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(respond(200, analysis({ Violence: 2, Sexual: 2 })));

    await expect(createModeration().moderate(IMAGE)).resolves.toEqual({
      decision: "allow",
      categories: { hate: 0, sexual: 2, violence: 2, selfHarm: 0 },
      provider: "azure-content-safety",
    });
  });

  it("blocks an image at or above a category's threshold", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(respond(200, analysis({ SelfHarm: 4 })));

    await expect(createModeration().moderate(IMAGE)).resolves.toEqual({
      decision: "block",
      categories: { hate: 0, sexual: 0, violence: 0, selfHarm: 4 },
      provider: "azure-content-safety",
    });
  });

  it("applies each category's own threshold", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(respond(200, analysis({ Violence: 6 })));

    await expect(
      createModeration({
        blockAtSeverity: { ...THRESHOLDS, violence: 7 },
      }).moderate(IMAGE),
    ).resolves.toMatchObject({ decision: "allow" });
  });

  it.each([429, 500, 503])(
    "throws a retryable error when the service answers %i",
    async (status) => {
      jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          respond(status, { error: { code: "TooManyRequests", message: "x" } }),
        );

      await expectUnavailable(
        createModeration().moderate(IMAGE),
        `Content Safety answered ${status} (TooManyRequests).`,
        status,
      );
    },
  );

  it("reports the error code from the header, never the message", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        respond(
          401,
          { error: { code: "Body", message: "secret detail" } },
          { "x-ms-error-code": "PermissionDenied" },
        ),
      );

    await expectUnavailable(
      createModeration().moderate(IMAGE),
      /^Content Safety answered 401 \(PermissionDenied\)\.$/,
      401,
    );
  });

  it("leaves out an error code that only repeats the status", async () => {
    // What Content Safety answers for an invalid subscription key.
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      respond(401, {
        error: { code: "401", message: "Access denied due to invalid key." },
      }),
    );

    await expectUnavailable(
      createModeration().moderate(IMAGE),
      /^Content Safety answered 401\.$/,
      401,
    );
  });

  it("reports a refusal with no readable error code", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(respond(400, "<html>"));

    await expectUnavailable(
      createModeration().moderate(IMAGE),
      /^Content Safety answered 400\.$/,
      400,
    );

    jest.spyOn(globalThis, "fetch").mockResolvedValue(respond(400, {}));

    await expectUnavailable(
      createModeration().moderate(IMAGE),
      /^Content Safety answered 400\.$/,
      400,
    );
  });

  it("throws a retryable error when the service cannot be reached", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("fetch failed"));

    await expectUnavailable(
      createModeration().moderate(IMAGE),
      "Content Safety could not be reached.",
    );
  });

  it("gives up on a service that does not answer in time", async () => {
    jest.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    await expectUnavailable(
      createModeration({ timeoutMs: 20 }).moderate(IMAGE),
      "Content Safety did not answer within 20 ms.",
    );
  });

  it.each([
    [
      "is not JSON",
      "not json",
      "Content Safety answered with a body that is not JSON.",
    ],
    ["has no analysis", {}, /no severity for Hate/],
    [
      "misses a category",
      { categoriesAnalysis: [{ category: "Hate", severity: 0 }] },
      /no severity for Sexual/,
    ],
    [
      "has a malformed severity",
      {
        categoriesAnalysis: [
          ...analysis().categoriesAnalysis.slice(0, 3),
          { category: "Violence", severity: "high" },
        ],
      },
      /no severity for Violence/,
    ],
    [
      "has a negative severity",
      {
        categoriesAnalysis: [
          ...analysis().categoriesAnalysis.slice(0, 3),
          { category: "Violence", severity: -2 },
        ],
      },
      /no severity for Violence/,
    ],
  ])("fails closed on an answer that %s", async (_case, body, message) => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(respond(200, body));

    await expectUnavailable(createModeration().moderate(IMAGE), message, 200);
  });

  it("throws a retryable error when it cannot sign in", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch");

    await expectUnavailable(
      createModeration({
        auth: {
          kind: "entra",
          credential: fakeCredential(async () => {
            throw new Error("CredentialUnavailableError");
          }),
        },
      }).moderate(IMAGE),
      "Could not sign in to Azure AI Content Safety.",
    );
    await expectUnavailable(
      createModeration({
        auth: { kind: "entra", credential: fakeCredential(async () => null) },
      }).moderate(IMAGE),
      "Could not sign in to Azure AI Content Safety.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createImageModeration", () => {
  const azure = {
    provider: "azure-content-safety" as const,
    endpoint: ENDPOINT,
    scope: SCOPE,
    auth: { kind: "entra" as const },
    timeoutMs: 10_000,
    blockAtSeverity: THRESHOLDS,
  };

  it("allows everything when no provider is configured", () => {
    expect(
      createImageModeration(
        { setup: { provider: "none", allowNone: false }, problems: [] },
        false,
      ),
    ).toBeInstanceOf(NoopModeration);
  });

  it("refuses to moderate nothing in production unless told to", () => {
    expect(() =>
      createImageModeration(
        { setup: { provider: "none", allowNone: false }, problems: [] },
        true,
      ),
    ).toThrow(PRODUCTION_WITHOUT_MODERATION_ERROR);
    expect(
      createImageModeration(
        { setup: { provider: "none", allowNone: true }, problems: [] },
        true,
      ),
    ).toBeInstanceOf(NoopModeration);
    expect(
      createImageModeration({ setup: azure, problems: [] }, true),
    ).toBeInstanceOf(AzureContentSafetyModeration);
  });

  it("builds the Azure adapter with an API key", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(respond(200, analysis()));
    const moderation = createImageModeration(
      {
        setup: {
          ...azure,
          auth: { kind: "api-key", apiKey: "configured-key" },
        },
        problems: [],
      },
      false,
    );

    expect(moderation).toBeInstanceOf(AzureContentSafetyModeration);
    await moderation.moderate(IMAGE);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      "Ocp-Apim-Subscription-Key": "configured-key",
    });
  });

  it("builds the Azure adapter with one credential in entra mode", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(respond(200, analysis()));
    const credential = fakeCredential();
    const createCredential = jest.fn(() => credential);
    const moderation = createImageModeration(
      { setup: azure, problems: [] },
      false,
      createCredential,
    );

    await moderation.moderate(IMAGE);

    expect(createCredential).toHaveBeenCalledTimes(1);
    expect(credential.getToken).toHaveBeenCalledWith(SCOPE);
  });

  it("uses DefaultAzureCredential by default", () => {
    expect(
      createImageModeration({ setup: azure, problems: [] }, false),
    ).toBeInstanceOf(AzureContentSafetyModeration);
  });

  it("refuses to start with the problems the environment layer found", () => {
    expect(() =>
      createImageModeration(
        {
          setup: { provider: "none", allowNone: true },
          problems: [
            "MEDIA_MODERATION_ENDPOINT is required when MEDIA_MODERATION_PROVIDER is azure-content-safety.",
            "MEDIA_MODERATION_TIMEOUT_MS must be greater than or equal to 1.",
          ],
        },
        false,
      ),
    ).toThrow(
      "Media moderation is misconfigured:\n- MEDIA_MODERATION_ENDPOINT is required when MEDIA_MODERATION_PROVIDER is azure-content-safety.\n- MEDIA_MODERATION_TIMEOUT_MS must be greater than or equal to 1.",
    );
  });
});
