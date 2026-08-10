import { buildApiPath } from "@/configuration/http/api-path";
import {
  createPersistenceTestApp,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

describe("System routes persistence integration", () => {
  let persistenceApp: PersistenceTestApp;

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  async function request(path: string): Promise<Response> {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      {},
    );
  }

  it("serves the service root descriptor", async () => {
    const response = await request("/");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { apiVersion: "v1", apiBasePath: "/api/v1" },
    });
  });

  it("reports healthy while the database is reachable", async () => {
    const response = await request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { ok: true, checks: { database: { ok: true } } },
    });
  });

  it("serves the committed OpenAPI document as YAML", async () => {
    const response = await request("/openapi.yaml");

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("openapi:");
    expect(body).toContain("/auth/local/login");
  });

  it("serves the committed OpenAPI document as JSON", async () => {
    const response = await request("/openapi.json");

    expect(response.status).toBe(200);
    const document = (await response.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(document.openapi).toMatch(/^3\./);
    expect(document.paths).toHaveProperty("/auth/local/login");
  });
});
