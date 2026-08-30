import type { ServiceContainer } from "@/configuration/bootstrap/container";
import { containerTokens } from "@/configuration/container/tokens";
import {
  requireSafeRouteParam,
  requireUuidRouteParam,
} from "@/configuration/validation/input-sanitization";
import { RequestValidationError } from "@/configuration/validation/request";
import { ContentSanitizationService } from "@/features/security/content-sanitization.service";
import { createMockRequest } from "../../support/mock-http";
import { testUuid } from "../../support/uuid";

class FakeContainer implements ServiceContainer {
  private readonly contentSanitizationService =
    new ContentSanitizationService();

  resolve<TValue>(token: unknown): TValue {
    if (token === containerTokens.contentSanitizationService) {
      return this.contentSanitizationService as TValue;
    }

    throw new Error(`Unexpected token: ${String(token)}`);
  }

  createScope(): ServiceContainer {
    return this;
  }

  async dispose(): Promise<void> {}
}

function createRequest(params: Record<string, string>) {
  return createMockRequest({
    url: "https://rent.test/resource",
    params,
    state: { container: new FakeContainer() },
  });
}

describe("requireUuidRouteParam", () => {
  it("returns an identifier-shaped route parameter", () => {
    const id = testUuid(1020, 1);

    expect(requireUuidRouteParam(createRequest({ id }), "id")).toBe(id);
  });

  it("accepts a real v4 identifier", () => {
    const id = "6f1c8b2e-6b0a-4f0e-9b6e-2f9a1c2d3e4f";

    expect(requireUuidRouteParam(createRequest({ id }), "id")).toBe(id);
  });

  it.each([
    ["an arbitrary string", "not-a-uuid"],
    ["a truncated identifier", "6f1c8b2e-6b0a-4f0e-9b6e-2f9a1c2d3e4"],
    ["a numeric id", "42"],
  ])("rejects %s with a validation error", (_label, id) => {
    // Rejecting here is what turns a malformed id into a 400 rather than
    // letting it reach Prisma and come back as a 404.
    expect(() => requireUuidRouteParam(createRequest({ id }), "id")).toThrow(
      RequestValidationError,
    );
  });

  it("reports the parameter name in the error details", () => {
    try {
      requireUuidRouteParam(createRequest({ messageId: "nope" }), "messageId");
      throw new Error("expected requireUuidRouteParam to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RequestValidationError);
      expect((error as RequestValidationError).details).toEqual([
        {
          path: "messageId",
          message: "Route parameter messageId must be a valid identifier.",
        },
      ]);
    }
  });

  it("rejects a missing parameter before checking its shape", () => {
    expect(() => requireUuidRouteParam(createRequest({}), "id")).toThrow(
      RequestValidationError,
    );
  });

  it("still screens for unsafe content", () => {
    expect(() =>
      requireUuidRouteParam(
        createRequest({ id: "<script>alert(1)</script>" }),
        "id",
      ),
    ).toThrow(RequestValidationError);
  });

  it("leaves requireSafeRouteParam accepting non-identifier values", () => {
    // Slugs, provider names and feature-flag names share this helper, so it
    // must not inherit the identifier rule.
    expect(requireSafeRouteParam(createRequest({ slug: "harbor" }), "slug")).toBe(
      "harbor",
    );
  });
});
