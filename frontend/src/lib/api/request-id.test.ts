import { describe, expect, it } from "vitest";
import { appendRequestId, normalizeRequestId } from "./request-id";

describe("request IDs", () => {
  it("accepts the backend format up to 128 characters", () => {
    expect(normalizeRequestId(" req_123.test:abc-def ")).toBe(
      "req_123.test:abc-def",
    );
    expect(normalizeRequestId("a".repeat(128))).toBe("a".repeat(128));
    expect(normalizeRequestId("a".repeat(129))).toBeUndefined();
    expect(normalizeRequestId("-invalid")).toBeUndefined();
  });

  it("limits references to 500–599 and does not duplicate them", () => {
    expect(appendRequestId("Failed.", 599, "id")).toBe(
      "Failed. Request ID: id",
    );
    expect(appendRequestId("Failed. Request ID: id", 500, "id")).toBe(
      "Failed. Request ID: id",
    );
    for (const status of [undefined, 200, 429, 499, 600]) {
      expect(appendRequestId("Failed.", status, "id")).toBe("Failed.");
    }
    expect(appendRequestId("Failed.", 503, "bad id")).toBe("Failed.");
  });
});
