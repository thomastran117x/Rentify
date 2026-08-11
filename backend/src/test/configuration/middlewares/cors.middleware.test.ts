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
});
