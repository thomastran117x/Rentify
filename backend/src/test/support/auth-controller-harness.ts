import type { Request, Response } from "express";
import { containerTokens } from "@/configuration/container/tokens";
import type { ServiceContainer } from "@/configuration/bootstrap/container";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import type {
  AuthUserProfile,
  AuthSessionResult,
} from "@/features/auth/auth.model";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";
import type { JwtClaims } from "@/features/auth/token/token.service";
import { ContentSanitizationService } from "@/features/security/content-sanitization.service";
import { createMockRequest, createMockResponse } from "./mock-http";

/**
 * Shared fixtures for the auth controller unit tests, which call handlers
 * directly rather than over HTTP.
 *
 * Note that `jest.mock(...)` calls cannot live here: they are hoisted per
 * module, so each test file declares its own mocks for the jwt middleware, the
 * cookie helpers and (where relevant) the MFA step-up guard.
 */

export function createClient(
  overrides?: Partial<ClientRequestContext>,
): ClientRequestContext {
  return {
    ip: "127.0.0.1",
    device: {
      id: "device-1",
      type: "desktop",
      isMobile: false,
      userAgent: "test-agent",
      platform: "macOS",
    },
    ...overrides,
  } as ClientRequestContext;
}

export function createClaims(
  overrides: Partial<JwtClaims> = {},
): JwtAuthPrincipal {
  return {
    sub: "user-1",
    username: "test-user",
    role: "user",
    deviceId: "token-device-1",
    tokenVersion: 2,
    iat: 1,
    exp: 9_999_999_999,
    authMethod: "jwt",
    ...overrides,
  } as JwtAuthPrincipal;
}

export function createAuthUser(
  overrides: Partial<AuthUserProfile> = {},
): AuthUserProfile {
  return {
    id: "user-1",
    email: "user@example.com",
    firstName: "Test",
    lastName: "User",
    username: "test-user",
    phoneNumber: undefined,
    avatarUrl: undefined,
    isPrivate: false,
    recommendationPersonalizationEnabled: true,
    trustworthinessScore: 80,
    rentPostingsCount: 0,
    availableRentPostingsCount: 0,
    role: "user",
    emailVerified: true,
    organizationMembershipCount: 0,
    ...overrides,
  };
}

export function createSessionResult(
  overrides?: Partial<AuthSessionResult>,
): AuthSessionResult {
  return {
    accessToken: "access-token-1",
    refreshToken: "refresh-token-1",
    refreshTokenExpiresInSeconds: 86_400,
    device: {
      deviceId: "device-1",
      known: true,
      knownByIp: true,
    },
    user: createAuthUser(),
    ...overrides,
  };
}

export interface AuthContextOptions {
  body?: unknown;
  client?: ClientRequestContext;
  auth?: JwtClaims;
  headers?: Record<string, string | undefined>;
  params?: Record<string, string>;
  url?: string;
}

export function createContext(options?: AuthContextOptions) {
  const contentSanitizationService = new ContentSanitizationService();
  const container: ServiceContainer = {
    resolve<TValue>(token: unknown): TValue {
      if (token === containerTokens.contentSanitizationService) {
        return contentSanitizationService as TValue;
      }

      throw new Error(`Unexpected token: ${String(token)}`);
    },
    createScope(): ServiceContainer {
      return this;
    },
    async dispose(): Promise<void> {},
  };

  const body = options?.body ?? {};
  const serialised = typeof body === "string" ? body : JSON.stringify(body);

  const request = createMockRequest({
    params: options?.params,
    url: options?.url ?? "https://example.test/auth",
    body,
    rawBody: serialised,
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(serialised)),
      ...options?.headers,
    },
    state: {
      container,
      client: options?.client ?? createClient(),
      requestId:
        options?.headers?.["x-request-id"] ??
        options?.headers?.["X-Request-Id"] ??
        "request-test",
      ...(options?.auth ? { auth: options.auth } : {}),
    },
  });
  const recorder = createMockResponse();
  (recorder.response as { req?: typeof request }).req = request;

  return {
    request,
    response: recorder.response,
    recorder,
    get: (name: string) =>
      (request as unknown as Record<string, unknown>)[name],
  };
}

export type AuthTestContext = ReturnType<typeof createContext>;

/**
 * Calls a native handler and reports what it wrote, so assertions can read
 * `status` and `json()` the way they would from a Response.
 */
export async function invoke(
  handler: (request: Request, response: Response) => Promise<void>,
  context: AuthTestContext,
) {
  await handler(context.request, context.response);

  return {
    status: context.recorder.status(),
    // Typed loosely like Response.json(), so callers can read into the payload.
    json: async (): Promise<any> => context.recorder.json(),
  };
}
