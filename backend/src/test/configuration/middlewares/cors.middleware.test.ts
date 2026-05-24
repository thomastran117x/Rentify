import { Hono } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { corsMiddleware } from "@/configuration/middlewares/cors.middleware";

function createApp() {
  const app = new Hono<AppBindings>();
  app.use("*", corsMiddleware);
  app.options("/postings/autocomplete", (context) => context.body(null, 204));
  return app;
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
});
