import { environment } from "@/configuration/environment";
import {
  expandLoopbackOriginAliases,
  normalizeOrigin,
  readCorsAllowedOrigins,
  readCsrfAllowedOrigins,
  readFrontendOrigins,
} from "@/configuration/http/allowed-origins";

function withEnvironment(values: Record<string, string>) {
  const frontendUrl = values.FRONTEND_URL ?? "http://localhost:3040";
  const split = (value: string) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

  jest.spyOn(environment, "getApplicationConfig").mockReturnValue({
    name: "Rent",
    frontendUrl,
    baseUrl: frontendUrl,
  });
  jest
    .spyOn(environment, "getCorsAllowedOrigins")
    .mockReturnValue(
      split(values.CORS_ALLOWED_ORIGINS ?? values.FRONTEND_URL ?? frontendUrl),
    );
  jest
    .spyOn(environment, "getCsrfAllowedOrigins")
    .mockReturnValue(
      split(
        values.CSRF_ALLOWED_ORIGINS ??
          values.CORS_ALLOWED_ORIGINS ??
          values.FRONTEND_URL ??
          frontendUrl,
      ),
    );
}

describe("expandLoopbackOriginAliases", () => {
  it("expands a localhost origin to both loopback spellings", () => {
    expect(expandLoopbackOriginAliases("http://localhost:3040")).toEqual([
      "http://localhost:3040",
      "http://127.0.0.1:3040",
    ]);
  });

  it("expands a 127.0.0.1 origin to both loopback spellings", () => {
    expect(expandLoopbackOriginAliases("http://127.0.0.1:3040")).toEqual([
      "http://127.0.0.1:3040",
      "http://localhost:3040",
    ]);
  });

  it("leaves a non-loopback origin alone", () => {
    expect(expandLoopbackOriginAliases("https://rentify.example")).toEqual([
      "https://rentify.example",
    ]);
  });

  it("passes a malformed value straight through", () => {
    expect(expandLoopbackOriginAliases("not-a-url")).toEqual(["not-a-url"]);
  });
});

describe("normalizeOrigin", () => {
  it("reduces a URL to its origin", () => {
    expect(normalizeOrigin("https://rentify.example/postings?page=2")).toBe(
      "https://rentify.example",
    );
  });

  it("returns null for a value that is not a URL", () => {
    expect(normalizeOrigin("not-a-url")).toBeNull();
  });
});

describe("readFrontendOrigins", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("reads the frontend URL", () => {
    withEnvironment({ FRONTEND_URL: "https://rentify.example" });

    expect(readFrontendOrigins()).toEqual(["https://rentify.example"]);
  });

  it("ignores the CORS allow-list, which may include partner origins", () => {
    withEnvironment({
      FRONTEND_URL: "https://rentify.example",
      CORS_ALLOWED_ORIGINS: "https://rentify.example,https://partner.example",
    });

    expect(readFrontendOrigins()).toEqual(["https://rentify.example"]);
  });

  it("does not adopt the CORS allow-list when the frontend URL is unset", () => {
    withEnvironment({ CORS_ALLOWED_ORIGINS: "https://partner.example" });

    expect(readFrontendOrigins()).toEqual([
      "http://localhost:3040",
      "http://127.0.0.1:3040",
    ]);
  });

  it("expands loopback aliases", () => {
    withEnvironment({ FRONTEND_URL: "http://127.0.0.1:3040" });

    expect(readFrontendOrigins()).toEqual([
      "http://127.0.0.1:3040",
      "http://localhost:3040",
    ]);
  });
});

describe("readCorsAllowedOrigins", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("reads the explicit CORS list first", () => {
    withEnvironment({
      CORS_ALLOWED_ORIGINS: "https://a.example, https://b.example",
      FRONTEND_URL: "https://ignored.example",
    });

    expect(readCorsAllowedOrigins()).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("falls back to the frontend URL", () => {
    withEnvironment({ FRONTEND_URL: "https://rentify.example" });

    expect(readCorsAllowedOrigins()).toEqual(["https://rentify.example"]);
  });

  it("defaults to the local frontend origin", () => {
    withEnvironment({});

    expect(readCorsAllowedOrigins()).toEqual([
      "http://localhost:3040",
      "http://127.0.0.1:3040",
    ]);
  });

  it("drops blank entries and deduplicates", () => {
    withEnvironment({
      CORS_ALLOWED_ORIGINS: "https://a.example, ,https://a.example",
    });

    expect(readCorsAllowedOrigins()).toEqual(["https://a.example"]);
  });
});

describe("readCsrfAllowedOrigins", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("narrows to the CSRF list when one is configured", () => {
    withEnvironment({
      CSRF_ALLOWED_ORIGINS: "https://app.example",
      CORS_ALLOWED_ORIGINS: "https://app.example,https://partner.example",
    });

    expect(readCsrfAllowedOrigins()).toEqual(["https://app.example"]);
  });

  it("defaults to the CORS list", () => {
    withEnvironment({
      CORS_ALLOWED_ORIGINS: "https://app.example,https://partner.example",
    });

    expect(readCsrfAllowedOrigins()).toEqual([
      "https://app.example",
      "https://partner.example",
    ]);
  });
});
