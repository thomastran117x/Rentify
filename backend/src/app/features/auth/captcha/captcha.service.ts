import {
  environment,
  getOptionalEnvironmentVariable,
} from "@/configuration/environment";
import { assertTrustedOutboundUrl } from "@/features/security/outbound-request-guard";

const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const LOCAL_CAPTCHA_BYPASS_TOKEN = "local-dev-bypass";

const DEFAULTS = {
  maxRetries: 3,
  initialDelayMs: 250,
  maxDelayMs: 2_000,
  backoffMultiplier: 2,
  requestTimeoutMs: 3_000,
} as const;

const TRANSIENT_ERROR_CODES = new Set([
  "ABORT_ERR",
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
]);

interface CaptchaServiceOptions {
  secretKey?: string;
  verificationUrl?: string;
  allowedHosts?: string[];
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  requestTimeoutMs?: number;
}

export interface VerifyCaptchaInput {
  token?: string | null;
  remoteIp?: string;
  idempotencyKey?: string;
}

interface TurnstileSiteverifyResponse {
  success: boolean;
  "error-codes"?: string[];
  action?: string;
  cdata?: string;
  challenge_ts?: string;
  hostname?: string;
  metadata?: {
    ephemeral_id?: string;
  };
}

export interface CaptchaVerificationResult {
  success: boolean;
  failOpen: boolean;
  errors: string[];
  hostname?: string;
  action?: string;
  challengeTimestamp?: string;
}

type VerificationPayload = Readonly<{
  token: string;
  remoteIp?: string;
  idempotencyKey?: string;
}>;

type NormalizedError = Readonly<{
  code: string;
  transient: boolean;
}>;

export class CaptchaService {
  private readonly secretKey?: string;
  private readonly verificationUrl: string;
  private readonly allowedHosts: string[];
  private readonly maxRetries: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly backoffMultiplier: number;
  private readonly requestTimeoutMs: number;

  constructor(options: CaptchaServiceOptions = {}) {
    this.secretKey =
      options.secretKey ?? environment.getCaptchaConfig().secretKey;
    this.verificationUrl = options.verificationUrl ?? TURNSTILE_SITEVERIFY_URL;
    this.allowedHosts = options.allowedHosts ?? this.readAllowedHosts();
    this.maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;
    this.initialDelayMs = options.initialDelayMs ?? DEFAULTS.initialDelayMs;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
    this.backoffMultiplier =
      options.backoffMultiplier ?? DEFAULTS.backoffMultiplier;
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs;
  }
  async verify(input: VerifyCaptchaInput): Promise<CaptchaVerificationResult> {
    const developmentBypassResult =
      this.resolveDevelopmentBypassResult(input);

    if (developmentBypassResult) {
      return developmentBypassResult;
    }

    if (!this.secretKey) {
      return this.buildFailOpenResult(["turnstile-not-configured"]);
    }

    const payload = this.toVerificationPayload(input);
    if (!payload) {
      return this.buildFailureResult(["missing-input-response"]);
    }

    let transientFailureCount = 0;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this.submitVerification(payload);
        return this.buildSuccessResult(response);
      } catch (error) {
        const normalized = this.normalizeError(error);

        if (!normalized.transient) {
          return this.buildFailureResult([normalized.code]);
        }

        transientFailureCount += 1;

        if (attempt === this.maxRetries) {
          return this.buildFailOpenResult(
            [normalized.code],
            transientFailureCount,
          );
        }

        await this.sleep(this.calculateDelayMs(attempt));
      }
    }

    return this.buildFailOpenResult(
      ["turnstile-unreachable"],
      transientFailureCount,
    );
  }

  private toVerificationPayload(
    input: VerifyCaptchaInput,
  ): VerificationPayload | null {
    const token = input.token?.trim();
    if (!token) {
      return null;
    }

    return {
      token,
      remoteIp: input.remoteIp,
      idempotencyKey: input.idempotencyKey,
    };
  }

  private resolveDevelopmentBypassResult(
    input: VerifyCaptchaInput,
  ): CaptchaVerificationResult | null {
    const token = input.token?.trim();

    if (environment.isProduction()) {
      return null;
    }

    if (token !== LOCAL_CAPTCHA_BYPASS_TOKEN) {
      return null;
    }

    return {
      success: true,
      failOpen: false,
      errors: [],
      action: "local-development-bypass",
    };
  }

  private async submitVerification(
    input: VerificationPayload,
  ): Promise<TurnstileSiteverifyResponse> {
    const verificationUrl = assertTrustedOutboundUrl(this.verificationUrl, {
      allowedHosts: this.allowedHosts,
    }).toString();

    const formData = new URLSearchParams({
      secret: this.secretKey as string,
      response: input.token,
    });

    if (input.remoteIp) {
      formData.set("remoteip", input.remoteIp);
    }

    if (input.idempotencyKey) {
      formData.set("idempotency_key", input.idempotencyKey);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.requestTimeoutMs,
    );

    try {
      const response = await fetch(verificationUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: formData,
        signal: controller.signal,
      });

      if (response.status >= 500) {
        throw new CaptchaTransientError(
          `Turnstile responded with ${response.status}.`,
          {
            code: `turnstile-http-${response.status}`,
          },
        );
      }

      if (!response.ok) {
        throw new Error(`turnstile-http-${response.status}`);
      }

      return (await response.json()) as TurnstileSiteverifyResponse;
    } catch (error) {
      throw this.mapRequestError(error);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private mapRequestError(error: unknown): Error {
    if (this.isAbortError(error)) {
      return new CaptchaTransientError("Turnstile request timed out.", {
        code: "turnstile-timeout",
      });
    }

    if (this.isFetchNetworkError(error)) {
      return new CaptchaTransientError("Turnstile request failed.", {
        code: this.readNodeErrorCode(error) ?? "turnstile-network-error",
      });
    }

    return error instanceof Error
      ? error
      : new Error("turnstile-verification-failed");
  }

  private normalizeError(error: unknown): NormalizedError {
    if (error instanceof CaptchaTransientError) {
      return {
        code: error.code ?? "turnstile-transient-error",
        transient: true,
      };
    }

    const code = this.readNodeErrorCode(error);
    if (code && TRANSIENT_ERROR_CODES.has(code)) {
      return {
        code,
        transient: true,
      };
    }

    if (this.isAbortError(error)) {
      return {
        code: "turnstile-timeout",
        transient: true,
      };
    }

    return {
      code: this.toErrorCode(error),
      transient: false,
    };
  }

  private buildSuccessResult(
    response: TurnstileSiteverifyResponse,
  ): CaptchaVerificationResult {
    return {
      success: response.success,
      failOpen: false,
      errors: response["error-codes"] ?? [],
      hostname: response.hostname,
      action: response.action,
      challengeTimestamp: response.challenge_ts,
    };
  }

  private buildFailureResult(errors: string[]): CaptchaVerificationResult {
    return {
      success: false,
      failOpen: false,
      errors,
    };
  }

  private buildFailOpenResult(
    errors: string[],
    transientFailureCount?: number,
  ): CaptchaVerificationResult {
    return {
      success: true,
      failOpen: true,
      errors: this.withTransientFailureCount(errors, transientFailureCount),
    };
  }

  private withTransientFailureCount(
    errors: string[],
    count?: number,
  ): string[] {
    if (typeof count !== "number") {
      return [...errors];
    }

    return [...errors, `transient-failures:${count}`];
  }

  private calculateDelayMs(attempt: number): number {
    const exponentialDelay = Math.min(
      this.initialDelayMs * this.backoffMultiplier ** attempt,
      this.maxDelayMs,
    );
    const jitterMs = Math.floor(
      Math.random() * Math.max(25, Math.floor(this.initialDelayMs / 2)),
    );

    return exponentialDelay + jitterMs;
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }

  private isFetchNetworkError(error: unknown): boolean {
    if (!(error instanceof Error) || error.name !== "TypeError") {
      return false;
    }

    return (
      this.readNodeErrorCode(error) !== undefined ||
      /fetch failed/i.test(error.message)
    );
  }

  private readNodeErrorCode(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null || !("cause" in error)) {
      return undefined;
    }

    const cause = (error as { cause?: unknown }).cause;
    if (typeof cause !== "object" || cause === null || !("code" in cause)) {
      return undefined;
    }

    const code = (cause as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }

  private toErrorCode(error: unknown): string {
    if (error instanceof CaptchaTransientError && error.code) {
      return error.code;
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return "turnstile-verification-failed";
  }

  private sleep(delayMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  private readAllowedHosts(): string[] {
    const configuredHosts = getOptionalEnvironmentVariable(
      "CAPTCHA_ALLOWED_HOSTS",
    );

    if (!configuredHosts) {
      return environment.getCaptchaConfig().allowedHosts;
    }

    return configuredHosts
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
  }
}

class CaptchaTransientError extends Error {
  constructor(
    message: string,
    private readonly details: { code?: string } = {},
  ) {
    super(message);
    this.name = "CaptchaTransientError";
  }

  get code(): string | undefined {
    return this.details.code;
  }
}
