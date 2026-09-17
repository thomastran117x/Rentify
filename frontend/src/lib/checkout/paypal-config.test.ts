import { describe, expect, it } from "vitest";
import { resolvePayPalSdkConfig } from "./paypal-config";
import { buildCheckoutSummary } from "@/test/mocks/checkout";

describe("resolvePayPalSdkConfig", () => {
  it("uses the SDK when the build client ID matches the backend", () => {
    expect(
      resolvePayPalSdkConfig(buildCheckoutSummary(), "sandbox-client"),
    ).toEqual({
      clientId: "sandbox-client",
      environment: "sandbox",
      methods: ["paypal", "paypal_guest", "card"],
    });
  });

  it.each([
    ["no client ID was built in", ""],
    ["the client ID is a placeholder", "change-me-paypal-client-id"],
    ["the client IDs differ", "other-client"],
  ])("falls back to the redirect when %s", (_label, buildClientId) => {
    expect(
      resolvePayPalSdkConfig(buildCheckoutSummary(), buildClientId),
    ).toBeNull();
  });

  it("falls back to the redirect when no embedded methods are enabled", () => {
    const summary = buildCheckoutSummary();
    summary.paypal.enabledMethods = [];

    expect(resolvePayPalSdkConfig(summary, "sandbox-client")).toBeNull();
  });
});
