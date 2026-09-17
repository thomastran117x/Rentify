import { buildPayPalConfig } from "@/configuration/environment/domains/infrastructure";

function build(raw: Record<string, string | undefined>) {
  const errors: string[] = [];
  const config = buildPayPalConfig(
    raw,
    errors,
    "client-id",
    "client-secret",
    "webhook-id",
  );

  return { config, errors };
}

describe("buildPayPalConfig", () => {
  it("defaults to the sandbox with PayPal, guest card, and card checkout", () => {
    const { config, errors } = build({});

    expect(errors).toEqual([]);
    expect(config).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
      webhookId: "webhook-id",
      environment: "sandbox",
      apiBaseUrl: "https://api-m.sandbox.paypal.com",
      checkoutMethods: ["paypal", "paypal_guest", "card"],
    });
  });

  it("parses, normalizes, and de-duplicates the checkout methods list", () => {
    const { config, errors } = build({
      PAYPAL_ENVIRONMENT: "production",
      PAYPAL_CHECKOUT_METHODS: " PayPal, card,apple_pay,,card, google_pay ",
    });

    expect(errors).toEqual([]);
    expect(config.environment).toBe("production");
    expect(config.apiBaseUrl).toBe("https://api-m.paypal.com");
    expect(config.checkoutMethods).toEqual([
      "paypal",
      "card",
      "apple_pay",
      "google_pay",
    ]);
  });

  it("allows turning every embedded method off", () => {
    const { config, errors } = build({ PAYPAL_CHECKOUT_METHODS: "" });

    expect(errors).toEqual([]);
    expect(config.checkoutMethods).toEqual([]);
  });

  it("reports unknown checkout methods and environments", () => {
    const { config, errors } = build({
      PAYPAL_ENVIRONMENT: "staging",
      PAYPAL_CHECKOUT_METHODS: "paypal,bitcoin,paypal_redirect",
    });

    expect(errors).toEqual([
      "PAYPAL_ENVIRONMENT must be either sandbox or production.",
      "PAYPAL_CHECKOUT_METHODS contains unknown methods: bitcoin, paypal_redirect.",
    ]);
    expect(config.checkoutMethods).toEqual(["paypal"]);
  });
});
