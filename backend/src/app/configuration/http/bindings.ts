import type { AuthPrincipal } from "@/features/auth/auth.principal";
import type { ServiceContainer } from "@/configuration/bootstrap/container";
import type { ClientSource } from "@/configuration/http/client-source";
import type { Logger } from "@/configuration/logging";

export type OutputFormat = "json" | "xml";

export interface ClientSignatureContext {
  clientId: string;
  timestamp: number;
  signature: string;
  payload: string;
}

export interface ClientDeviceContext {
  id?: string;
  type: "mobile" | "tablet" | "desktop" | "bot" | "unknown";
  isMobile: boolean;
  userAgent?: string;
  platform?: string;
}

/**
 * The device id from a signed device cookie the request presented. Unlike
 * `ClientDeviceContext.id`, which the client chooses, it cannot be forged.
 */
export interface DeviceBinding {
  id: string;
}

export interface ClientRequestContext {
  ip?: string;
  device: ClientDeviceContext;
  /** Set only when the request presented a device cookie that verified. */
  deviceBinding?: DeviceBinding;
  /** Which kind of caller this is. Observability only — see `client-source.ts`. */
  source: ClientSource;
  /** Normalized `Origin`/`Referer`, when the caller sent one. */
  origin?: string;
  /** Sanitized `x-client-app` value, when the caller declared one. */
  declaredApp?: string;
}

export interface AppBindings {
  Variables: {
    auth: AuthPrincipal;
    client: ClientRequestContext;
    clientSignature: ClientSignatureContext;
    container: ServiceContainer;
    idempotencyKey: string;
    outputFormat: OutputFormat;
    requestId: string;
    logger: Logger;
  };
}
