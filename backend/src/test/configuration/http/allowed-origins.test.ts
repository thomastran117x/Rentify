import { getOptionalEnvironmentVariable } from "@/configuration/environment";
import {
  expandLoopbackOriginAliases,
  normalizeOrigin,
  readCorsAllowedOrigins,
  readCsrfAllowedOrigins,
} from "@/configuration/http/allowed-origins";

jest.mock("@/configuration/environment", () => ({
  getOptionalEnvironmentVariable: jest.fn(),
}));

const mockGetOptionalEnvironmentVariable =
  getOptionalEnvironmentVariable as jest.MockedFunction<
    typeof getOptionalEnvironmentVariable
  >;

function withEnvironment(values: Record<string, string>) {
  mockGetOptionalEnvironmentVariable.mockImplementation((name) => values[name]);
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

describe("readCorsAllowedOrigins", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    jest.clearAllMocks();
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
