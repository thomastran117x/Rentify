import { z } from "zod";
import {
  RequestValidationError,
  parseOptionalRequestBody,
} from "@/configuration/validation/request";
import { createMockRequest, createTestContext } from "../../support/mock-http";

describe("parseOptionalRequestBody", () => {
  const schema = z.object({
    method: z.enum(["paypal", "card"]).default("paypal"),
  });

  it("validates a request without a body as an empty object", async () => {
    await expect(
      parseOptionalRequestBody(createMockRequest(), schema),
    ).resolves.toEqual({ method: "paypal" });
  });

  it("reports validation errors when an empty body is not allowed", async () => {
    await expect(
      parseOptionalRequestBody(
        createMockRequest(),
        z.object({ orderId: z.string() }),
      ),
    ).rejects.toBeInstanceOf(RequestValidationError);
  });

  it("rethrows unexpected errors raised while validating an empty body", async () => {
    const failure = new Error("boom");
    const throwingSchema = z.object({}).transform(() => {
      throw failure;
    });

    await expect(
      parseOptionalRequestBody(createMockRequest(), throwingSchema),
    ).rejects.toBe(failure);
  });

  it("parses a body when one was sent", async () => {
    const { request } = createTestContext({
      body: { method: "card" },
      state: {
        container: {
          resolve: () => ({ inspectRequest: () => [] }),
        },
      },
    });

    await expect(parseOptionalRequestBody(request, schema)).resolves.toEqual({
      method: "card",
    });
  });
});
