import { getOptionalEnvironmentVariable } from "@/configuration/environment";
import {
  CLIENT_APP_HEADER_NAME,
  type ClientSource,
  resolveClientSource,
} from "@/configuration/http/client-source";
import { createTestApp } from "../../support/fetch-app";

jest.mock("@/configuration/environment", () => ({
  getOptionalEnvironmentVariable: jest.fn(),
}));

const mockGetOptionalEnvironmentVariable =
  getOptionalEnvironmentVariable as jest.MockedFunction<
    typeof getOptionalEnvironmentVariable
  >;

function createApp(stripUserAgent = false) {
  return createTestApp((app) => {
    app.get("/client-source", (request, response) => {
      if (stripUserAgent) {
        // The test harness speaks over a real socket, and the fetch client
        // always attaches its own user agent. Production callers need not.
        delete request.headers["user-agent"];
      }

      response.json(resolveClientSource(request));
    });
  });
}

async function resolve(headers: Record<string, string>) {
  const response = await createApp().request("http://rent.test/client-source", {
    headers,
  });

  expect(response.status).toBe(200);

  return response.json() as Promise<{
    source: ClientSource;
    origin?: string;
    declaredApp?: string;
  }>;
}

describe("resolveClientSource", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOptionalEnvironmentVariable.mockImplementation((name) =>
      name === "FRONTEND_URL" ? "http://localhost:3040" : undefined,
    );
  });

  describe("declared client app", () => {
    it.each([
      ["rentify-web/browser", "frontend-browser"],
      ["rentify-web/server", "frontend-server"],
      ["rentify-mcp/server", "api-integration"],
      ["some-partner-app", "api-integration"],
    ] as const)("maps %s to %s", async (declared, expected) => {
      await expect(
        resolve({ [CLIENT_APP_HEADER_NAME]: declared }),
      ).resolves.toEqual({ source: expected, declaredApp: declared });
    });

    it("normalizes casing and surrounding whitespace", async () => {
      await expect(
        resolve({ [CLIENT_APP_HEADER_NAME]: "  Rentify-Web/Server  " }),
      ).resolves.toEqual({
        source: "frontend-server",
        declaredApp: "rentify-web/server",
      });
    });

    it("treats a frontend declaration without a runtime as a browser call", async () => {
      await expect(
        resolve({ [CLIENT_APP_HEADER_NAME]: "rentify-web" }),
      ).resolves.toEqual({
        source: "frontend-browser",
        declaredApp: "rentify-web",
      });
    });

    it("wins over a mismatched origin, since it is only a logging hint", async () => {
      await expect(
        resolve({
          [CLIENT_APP_HEADER_NAME]: "rentify-web/browser",
          origin: "https://attacker.example",
        }),
      ).resolves.toEqual({
        source: "frontend-browser",
        origin: "https://attacker.example",
        declaredApp: "rentify-web/browser",
      });
    });
  });

  describe("declared client app sanitization", () => {
    it("drops a value that is too long to be a real app token", async () => {
      await expect(
        resolve({ [CLIENT_APP_HEADER_NAME]: "a".repeat(65) }),
      ).resolves.toEqual({ source: "server-side" });
    });

    it("keeps a value sitting exactly on the length limit", async () => {
      const declared = "a".repeat(64);

      await expect(
        resolve({ [CLIENT_APP_HEADER_NAME]: declared }),
      ).resolves.toEqual({ source: "api-integration", declaredApp: declared });
    });

    it.each([
      ["rentify-web browser"],
      ["rentify-web;drop"],
      ["rentify-web\tbrowser"],
      ["rentify=web"],
    ])("drops %p rather than logging it", async (declared) => {
      await expect(
        resolve({ [CLIENT_APP_HEADER_NAME]: declared }),
      ).resolves.toEqual({ source: "server-side" });
    });

    it("ignores an empty header", async () => {
      await expect(
        resolve({ [CLIENT_APP_HEADER_NAME]: "   " }),
      ).resolves.toEqual({ source: "server-side" });
    });
  });

  describe("origin heuristics", () => {
    it("recognizes an allowed origin as the frontend", async () => {
      await expect(
        resolve({ origin: "http://localhost:3040" }),
      ).resolves.toEqual({
        source: "frontend-browser",
        origin: "http://localhost:3040",
      });
    });

    it("accepts the loopback alias of an allowed origin", async () => {
      await expect(
        resolve({ origin: "http://127.0.0.1:3040" }),
      ).resolves.toEqual({
        source: "frontend-browser",
        origin: "http://127.0.0.1:3040",
      });
    });

    it("falls back to the referer when no origin is sent", async () => {
      await expect(
        resolve({ referer: "http://localhost:3040/postings/1" }),
      ).resolves.toEqual({
        source: "frontend-browser",
        origin: "http://localhost:3040",
      });
    });

    it("does not treat an unknown origin as the frontend", async () => {
      await expect(
        resolve({ origin: "https://attacker.example" }),
      ).resolves.toEqual({
        source: "browser-direct",
        origin: "https://attacker.example",
      });
    });

    it("classifies a bare browser navigation by its sec-fetch header", async () => {
      await expect(resolve({ "sec-fetch-site": "none" })).resolves.toEqual({
        source: "browser-direct",
      });
    });

    it("ignores a malformed origin value", async () => {
      await expect(resolve({ origin: "not-a-url" })).resolves.toEqual({
        source: "browser-direct",
      });
    });

    it("recognizes a configured non-local frontend origin", async () => {
      mockGetOptionalEnvironmentVariable.mockImplementation((name) =>
        name === "FRONTEND_URL" ? "https://rentify.example" : undefined,
      );

      await expect(
        resolve({ origin: "https://rentify.example" }),
      ).resolves.toEqual({
        source: "frontend-browser",
        origin: "https://rentify.example",
      });
    });

    it("does not claim a CORS-allowed partner origin as the frontend", async () => {
      mockGetOptionalEnvironmentVariable.mockImplementation((name) => {
        if (name === "FRONTEND_URL") return "https://rentify.example";
        if (name === "CORS_ALLOWED_ORIGINS")
          return "https://rentify.example,https://partner.example";

        return undefined;
      });

      await expect(
        resolve({ origin: "https://partner.example" }),
      ).resolves.toEqual({
        source: "browser-direct",
        origin: "https://partner.example",
      });
    });

    it("still identifies a partner that names itself", async () => {
      mockGetOptionalEnvironmentVariable.mockImplementation((name) =>
        name === "CORS_ALLOWED_ORIGINS"
          ? "https://rentify.example,https://partner.example"
          : undefined,
      );

      await expect(
        resolve({
          origin: "https://partner.example",
          [CLIENT_APP_HEADER_NAME]: "partner-portal/browser",
        }),
      ).resolves.toEqual({
        source: "api-integration",
        origin: "https://partner.example",
        declaredApp: "partner-portal/browser",
      });
    });

    it("defaults to the local frontend origin when FRONTEND_URL is unset", async () => {
      mockGetOptionalEnvironmentVariable.mockReturnValue(undefined);

      await expect(
        resolve({ origin: "http://localhost:3040" }),
      ).resolves.toEqual({
        source: "frontend-browser",
        origin: "http://localhost:3040",
      });
    });
  });

  describe("user agent heuristics", () => {
    it.each([
      ["PostmanRuntime/7.36.0", "api-tool"],
      ["insomnia/8.4.5", "api-tool"],
      ["curl/8.0.1", "api-tool"],
      ["Wget/1.21.3", "api-tool"],
      ["python-requests/2.31.0", "api-tool"],
      ["okhttp/4.12.0", "api-tool"],
      ["Googlebot/2.1 (+http://www.google.com/bot.html)", "bot"],
      ["Mozilla/5.0 (compatible; bingbot/2.0)", "bot"],
      ["undici/6.0.0", "server-side"],
      ["node", "server-side"],
      ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "unknown"],
    ] as const)("maps %s to %s", async (userAgent, expected) => {
      await expect(resolve({ "user-agent": userAgent })).resolves.toEqual({
        source: expected,
      });
    });

    it("treats a request carrying no user agent at all as server-side", async () => {
      const response = await createApp(true).request(
        "http://rent.test/client-source",
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ source: "server-side" });
    });

    it("prefers the named tool when a user agent matches both patterns", async () => {
      await expect(
        resolve({ "user-agent": "curl-crawler/1.0" }),
      ).resolves.toEqual({ source: "api-tool" });
    });
  });
});
