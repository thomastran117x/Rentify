import { Hono } from "hono";
import { mountRoutes } from "@/configuration/bootstrap/routes";
import type { AppBindings } from "@/configuration/http/bindings";
import { buildApiPath } from "@/configuration/http/api-path";
import { outputFormatMiddleware } from "@/configuration/middlewares/output-format.middleware";
import {
  readOpenApiJsonSpecFile,
  readOpenApiYamlSpecFile,
} from "@/openapi/file";
import { runOpenApiChecks } from "@/openapi/validation";

describe("OpenAPI documentation", () => {
  it("passes the OpenAPI validation and route coverage checks", async () => {
    await expect(runOpenApiChecks()).resolves.toBeUndefined();
  });

  it("serves the canonical openapi yaml file through the API route", async () => {
    const app = new Hono<AppBindings>();
    app.use("*", outputFormatMiddleware);
    mountRoutes(app);

    const response = await app.request(
      `http://rent.test${buildApiPath("/openapi.yaml")}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/yaml; charset=UTF-8",
    );
    await expect(response.text()).resolves.toBe(await readOpenApiYamlSpecFile());
  });

  it("serves the canonical openapi json file through the API route", async () => {
    const app = new Hono<AppBindings>();
    app.use("*", outputFormatMiddleware);
    mountRoutes(app);

    const response = await app.request(
      `http://rent.test${buildApiPath("/openapi.json")}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=UTF-8",
    );
    await expect(response.text()).resolves.toBe(await readOpenApiJsonSpecFile());
  });
});
