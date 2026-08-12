import type { ErrorRequestHandler, Express } from "express";
import { getContainer } from "@/configuration/bootstrap/container";
import { containerScopeMiddleware } from "@/configuration/middlewares/container-scope.middleware";
import { createTestApp } from "../../support/fetch-app";

jest.mock("@/configuration/bootstrap/container", () => ({
  getContainer: jest.fn(),
}));

const mockGetContainer = getContainer as jest.MockedFunction<
  typeof getContainer
>;

const reportError: ErrorRequestHandler = (error, _request, response, _next) => {
  response
    .status(500)
    .type("text/plain")
    .send(error instanceof Error ? error.message : "error");
};

function createApp(configureRoutes: (app: Express) => void) {
  return createTestApp((app) => {
    app.use(containerScopeMiddleware);
    configureRoutes(app);
    app.use(reportError);
  });
}

describe("containerScopeMiddleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a request scope, stores it on the request, and disposes it after success", async () => {
    const dispose = jest.fn().mockResolvedValue(undefined);
    const scope = { dispose };
    const createScope = jest.fn().mockReturnValue(scope);
    mockGetContainer.mockReturnValue({
      createScope,
    } as unknown as ReturnType<typeof getContainer>);

    const app = createApp((instance) => {
      instance.get("/scope", (request, response) => {
        response
          .type("text/plain")
          .send(
            (request.container as unknown) === scope ? "scoped" : "missing",
          );
      });
    });

    const response = await app.request("http://rent.test/scope");

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("scoped");
    expect(createScope).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes the request scope even when downstream handlers fail", async () => {
    const dispose = jest.fn().mockResolvedValue(undefined);
    const scope = { dispose };
    mockGetContainer.mockReturnValue({
      createScope: jest.fn().mockReturnValue(scope),
    } as unknown as ReturnType<typeof getContainer>);

    const app = createApp((instance) => {
      instance.get("/scope", () => {
        throw new Error("boom");
      });
    });

    const response = await app.request("http://rent.test/scope");

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe("boom");
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
