import express from "express";
import { mountRoutes } from "@/configuration/bootstrap/routes";
import { buildApiPath, getApiRoutePrefix } from "@/configuration/http/api-path";
import { outputFormatMiddleware } from "@/configuration/middlewares/output-format.middleware";
import {
  readOpenApiJsonSpecFile,
  readOpenApiYamlSpecFile,
} from "@/openapi/file";
import { runOpenApiChecks } from "@/openapi/validation";
import { createTestApp } from "../support/fetch-app";

function createApp() {
  return createTestApp((app) => {
    const api = express.Router();
    app.use(getApiRoutePrefix(), api);

    api.use(outputFormatMiddleware);
    mountRoutes(api);
  });
}

describe("OpenAPI documentation", () => {
  it("passes the OpenAPI validation and route coverage checks", async () => {
    await expect(runOpenApiChecks()).resolves.toBeUndefined();
  });

  it("serves the canonical openapi yaml file through the API route", async () => {
    const app = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/openapi.yaml")}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/yaml; charset=UTF-8",
    );
    await expect(response.text()).resolves.toBe(
      await readOpenApiYamlSpecFile(),
    );
  });

  it("serves the canonical openapi json file through the API route", async () => {
    const app = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/openapi.json")}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=UTF-8",
    );
    // Byte-for-byte: the committed spec file is served as-is, not reserialised.
    await expect(response.text()).resolves.toBe(
      await readOpenApiJsonSpecFile(),
    );
  });
});
