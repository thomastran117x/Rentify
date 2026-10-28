import { environment } from "@/configuration/environment";
import { handleApplicationError } from "@/configuration/middlewares/error-handler.middleware";
import { securityHeadersMiddleware } from "@/configuration/middlewares/security-headers.middleware";
import ForbiddenError from "@/errors/http/forbidden.error";
import { createTestApp } from "../../support/fetch-app";

function createApp() {
  return createTestApp((app) => {
    app.use(securityHeadersMiddleware);
    app.get("/health", (_request, response) => {
      response.json({ ok: true });
    });
  });
}

describe("securityHeadersMiddleware", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("adds the baseline hardening headers to responses", async () => {
    const app = createApp();
    const response = await app.request("http://rent.test/health");

    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("strict-transport-security")).toBeNull();
  });

  it("keeps the headers on an error raised by a later middleware", async () => {
    const app = createTestApp((instance) => {
      instance.use(securityHeadersMiddleware);
      instance.use(() => {
        throw new ForbiddenError("CSRF validation failed.");
      });
      instance.use(handleApplicationError);
    });

    const response = await app.request("http://rent.test/auth/refresh", {
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("adds HSTS in production", async () => {
    jest.spyOn(environment, "isProduction").mockReturnValue(true);
    const app = createApp();
    const response = await app.request("http://rent.test/health");

    expect(response.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });
});
