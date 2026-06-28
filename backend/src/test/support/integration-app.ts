import { Hono } from "hono";
import { mountRoutes } from "@/configuration/bootstrap/routes";
import {
  containerTokens,
  type ServiceContainer,
} from "@/configuration/bootstrap/container";
import type { AppBindings } from "@/configuration/http/bindings";
import { clientContextMiddleware } from "@/configuration/middlewares/client-context.middleware";
import { handleApplicationError } from "@/configuration/middlewares/error-handler.middleware";
import { outputFormatMiddleware } from "@/configuration/middlewares/output-format.middleware";
import type { PersonalAccessTokenPrincipal } from "@/features/auth/auth.principal";
import type { JwtClaims } from "@/features/auth/token/token.service";
import { ContentSanitizationService } from "@/features/security/content-sanitization.service";

export function createJwtClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: "user-1",
    email: "user@example.com",
    role: "user",
    deviceId: "device-1",
    sessionId: "session-1",
    tokenVersion: 1,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

export function createPatPrincipal(
  overrides: Partial<PersonalAccessTokenPrincipal> = {},
): PersonalAccessTokenPrincipal {
  return {
    sub: "pat-user-1",
    email: "pat-user@example.com",
    role: "owner",
    authMethod: "pat",
    scopes: ["mcp:read", "mcp:write"],
    personalAccessTokenId: "pat-1",
    personalAccessTokenName: "Rentify MCP",
    ...overrides,
  };
}

export class FakeRequestContainer implements ServiceContainer {
  private readonly contentSanitizationService =
    new ContentSanitizationService();

  constructor(private readonly registry: Map<unknown, unknown>) {}

  resolve<TValue>(token: unknown): TValue {
    if (token === containerTokens.contentSanitizationService) {
      return this.contentSanitizationService as TValue;
    }

    if (!this.registry.has(token)) {
      throw new Error(`Unsupported test container token: ${String(token)}`);
    }

    return this.registry.get(token) as TValue;
  }

  createScope(): ServiceContainer {
    return this;
  }

  async dispose(): Promise<void> {}
}

export function createRouteTestApp(
  registry: Map<unknown, unknown>,
): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.use("*", clientContextMiddleware);
  app.use("*", async (context, next) => {
    context.set("container", new FakeRequestContainer(registry));
    await next();
  });
  app.use("*", outputFormatMiddleware);
  app.onError(handleApplicationError);
  mountRoutes(app);

  return app;
}

