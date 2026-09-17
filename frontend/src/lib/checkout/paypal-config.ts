import { publicEnv } from "@/lib/env";
import type {
  CheckoutPaymentMethod,
  CheckoutSummary,
} from "@/lib/payments/api";

export interface PayPalSdkConfig {
  clientId: string;
  environment: "sandbox" | "production";
  methods: CheckoutPaymentMethod[];
}

function isPlaceholderClientId(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 || normalized.startsWith("change-me-");
}

/**
 * The PayPal JS SDK settings for embedded checkout, or null when checkout has
 * to fall back to the PayPal redirect: no client ID was built into the
 * frontend, it is a placeholder, or it differs from the backend's. The last
 * check matters because the SDK cannot approve orders created by a different
 * PayPal app.
 */
export function resolvePayPalSdkConfig(
  summary: CheckoutSummary,
  buildClientId: string = publicEnv.paypalClientId,
): PayPalSdkConfig | null {
  if (
    isPlaceholderClientId(buildClientId) ||
    buildClientId !== summary.paypal.clientId ||
    summary.paypal.enabledMethods.length === 0
  ) {
    return null;
  }

  return {
    clientId: buildClientId,
    environment: summary.paypal.environment,
    methods: summary.paypal.enabledMethods,
  };
}
