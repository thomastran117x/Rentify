import { corsMiddleware } from "@/configuration/middlewares/cors.middleware";
import { createTestApp } from "../../support/fetch-app";

function createApp() {
  return createTestApp((app) => {
    app.use(corsMiddleware);
    app.options("/postings/autocomplete", (_request, response) => {
      response.status(204).end();
    });
  });
}

describe("corsMiddleware", () => {
  it("allows the loopback hostname alias when localhost is configured", async () => {
    const app = createApp();
    const response = await app.request(
      "http://rent.test/postings/autocomplete",
      {
        method: "OPTIONS",
        headers: {
          origin: "http://127.0.0.1:3040",
          "access-control-request-method": "GET",
        },
      },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://127.0.0.1:3040",
    );
  });

  it("omits the allow-origin header for an untrusted origin", async () => {
    const app = createApp();
    const response = await app.request(
      "http://rent.test/postings/autocomplete",
      {
        method: "OPTIONS",
        headers: {
          origin: "https://evil.example",
          "access-control-request-method": "GET",
        },
      },
    );

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("exposes the request ID on server errors for trusted browser origins", async () => {
    const app = createTestApp((app) => {
      app.use(corsMiddleware);
      app.get("/failure", (_request, response) => {
        response.setHeader("x-request-id", "support-id");
        response.status(503).send("Unavailable");
      });
    });
    const response = await app.request("http://rent.test/failure", {
      headers: { origin: "http://127.0.0.1:3040" },
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://127.0.0.1:3040",
    );
    expect(
      response.headers
        .get("access-control-expose-headers")
        ?.split(",")
        .map((header) => header.trim()),
    ).toContain("x-request-id");
    expect(response.headers.get("x-request-id")).toBe("support-id");
  });
});
