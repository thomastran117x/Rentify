import { Hono } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { getContainer } from "@/configuration/bootstrap/container";
import { containerScopeMiddleware } from "@/configuration/middlewares/container-scope.middleware";

jest.mock("@/configuration/bootstrap/container", () => ({
  getContainer: jest.fn(),
}));

const mockGetContainer = getContainer as jest.MockedFunction<
  typeof getContainer
>;

function createApp() {
  const app = new Hono<AppBindings>();
  app.use("*", containerScopeMiddleware);
  app.onError((error, context) =>
    context.text(error instanceof Error ? error.message : "error", 500),
  );
  return app;
}

describe("containerScopeMiddleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a request scope, stores it on the context, and disposes it after success", async () => {
    const dispose = jest.fn().mockResolvedValue(undefined);
    const scope = { dispose };
    const createScope = jest.fn().mockReturnValue(scope);
    mockGetContainer.mockReturnValue({
      createScope,
    } as unknown as ReturnType<typeof getContainer>);

    const app = createApp();
    app.get("/scope", (context) =>
      context.text(
        context.get("container") === (scope as unknown) ? "scoped" : "missing",
      ),
    );

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

    const app = createApp();
    app.get("/scope", () => {
      throw new Error("boom");
    });

    const response = await app.request("http://rent.test/scope");

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe("boom");
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
