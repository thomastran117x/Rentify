import type { Request } from "express";
import { ZodError } from "zod";
import { getQuery, readCookie } from "@/configuration/http/request";
import { RequestValidationError } from "@/configuration/validation/request";
import { requireSafeRouteParam } from "@/configuration/validation/input-sanitization";
import { REFRESH_TOKEN_COOKIE_NAME } from "@/features/auth/auth.cookies";
import type {
  OAuthProvider,
} from "@/features/auth/auth.model";
import type {
  RefreshInput,
  RefreshRequestBody,
} from "@/features/auth/session/session.model";
import type {
  LinkOAuthProviderInput,
  OAuthAuthenticateInput,
  OAuthAuthenticateRequestBody,
  UnlinkOAuthProviderInput,
} from "@/features/auth/oauth/oauth-accounts.model";
import type {
  RemoveKnownDeviceInput,
  RemoveKnownDeviceRequestBody,
} from "@/features/auth/device/device-management.model";
import { oauthProviderSchema } from "@/features/auth/auth.model";
import type {
  LocalAuthenticateInput,
  LocalAuthenticateRequestBody,
  LocalSignupInput,
  LocalSignupRequestBody,
  ResendVerificationEmailInput,
  ResendVerificationEmailRequestBody,
  VerifyEmailInput,
  VerifyEmailRequestBody,
} from "@/features/auth/local/local-auth.model";
import type {
  ChangePasswordInput,
  ChangePasswordRequestBody,
  ForgotPasswordInput,
  ForgotPasswordRequestBody,
  ResendForgotPasswordInput,
  ResendForgotPasswordRequestBody,
  ResetPasswordInput,
  ResetPasswordRequestBody,
  SetPasswordInput,
  SetPasswordRequestBody,
} from "@/features/auth/password/password.model";
import type {
  ResendUnlockLocalLoginInput,
  ResendUnlockLocalLoginRequestBody,
  UnlockLocalLoginInput,
  UnlockLocalLoginRequestBody,
} from "@/features/auth/lockout/login-lockout.model";
import {
  usernameAvailabilityQuerySchema,
  type ForgotUsernameInput,
  type ForgotUsernameRequestBody,
  type UsernameAvailabilityQuery,
} from "@/features/auth/username/username.model";

/**
 * An explicit body value wins over the fingerprinted device so a client that
 * tracks its own device identity stays stable across fingerprint drift.
 */
export function resolveDeviceId(
  request: Request,
  deviceId?: string,
): string | undefined {
  return deviceId ?? request.client.device.id;
}

export function parseUsernameAvailabilityQuery(
  request: Request,
): UsernameAvailabilityQuery {
  try {
    return usernameAvailabilityQuerySchema.parse({
      username: getQuery(request).username,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      throw new RequestValidationError(
        "Request query validation failed.",
        error.issues.map((issue) => ({
          path: "username",
          message: issue.message,
        })),
      );
    }

    throw error;
  }
}

export function requireOAuthProviderParam(request: Request): OAuthProvider {
  const provider = requireSafeRouteParam(request, "provider");

  try {
    return oauthProviderSchema.parse(provider);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new RequestValidationError(
        "Route parameter validation failed.",
        error.issues.map((issue) => ({
          path: "provider",
          message: issue.message,
        })),
      );
    }

    throw error;
  }
}

export function toLocalAuthenticateInput(
  request: Request,
  input: LocalAuthenticateRequestBody,
): LocalAuthenticateInput {
  return {
    username: input.username,
    password: input.password,
    rememberMe: input.rememberMe,
    client: request.client,
    deviceId: resolveDeviceId(request, input.deviceId),
    totpCode: input.totpCode,
  };
}

export function toLocalSignupInput(
  request: Request,
  input: LocalSignupRequestBody,
): LocalSignupInput {
  return {
    client: request.client,
    username: input.username,
    email: input.email,
    password: input.password,
    firstName: input.firstName,
    lastName: input.lastName,
    deviceId: resolveDeviceId(request, input.deviceId),
  };
}

export function toOAuthAuthenticateInput(
  request: Request,
  input: OAuthAuthenticateRequestBody,
): OAuthAuthenticateInput {
  return {
    code: input.code,
    codeVerifier: input.codeVerifier,
    idToken: input.idToken,
    nonce: input.nonce,
    rememberMe: input.rememberMe,
    client: request.client,
    firstName: input.firstName,
    lastName: input.lastName,
    deviceId: resolveDeviceId(request, input.deviceId),
    totpCode: input.totpCode,
  };
}

export function toLinkOAuthProviderInput(
  request: Request,
  input: OAuthAuthenticateRequestBody,
): LinkOAuthProviderInput {
  return {
    ...toOAuthAuthenticateInput(request, input),
    provider: requireOAuthProviderParam(request),
    userId: request.auth.sub,
  };
}

export function toUnlinkOAuthProviderInput(
  request: Request,
): UnlinkOAuthProviderInput {
  return {
    provider: requireOAuthProviderParam(request),
    userId: request.auth.sub,
  };
}

export function toVerifyEmailInput(
  request: Request,
  input: VerifyEmailRequestBody,
): VerifyEmailInput {
  return {
    client: request.client,
    email: input.email,
    code: input.code,
    deviceId: resolveDeviceId(request, input.deviceId),
  };
}

export function toResendVerificationEmailInput(
  request: Request,
  input: ResendVerificationEmailRequestBody,
): ResendVerificationEmailInput {
  return {
    client: request.client,
    email: input.email,
    deviceId: resolveDeviceId(request),
  };
}

export function toForgotPasswordInput(
  request: Request,
  input: ForgotPasswordRequestBody,
): ForgotPasswordInput {
  return {
    client: request.client,
    username: input.username,
    deviceId: resolveDeviceId(request),
  };
}

export function toResendForgotPasswordInput(
  request: Request,
  input: ResendForgotPasswordRequestBody,
): ResendForgotPasswordInput {
  return {
    client: request.client,
    username: input.username,
    deviceId: resolveDeviceId(request),
  };
}

export function toForgotUsernameInput(
  request: Request,
  input: ForgotUsernameRequestBody,
): ForgotUsernameInput {
  return {
    client: request.client,
    email: input.email,
    deviceId: resolveDeviceId(request),
  };
}

export function toRefreshInput(
  request: Request,
  input: RefreshRequestBody,
): RefreshInput {
  return {
    client: request.client,
    refreshToken:
      input.refreshToken ?? readCookie(request, REFRESH_TOKEN_COOKIE_NAME),
  };
}

export function toResetPasswordInput(
  request: Request,
  input: ResetPasswordRequestBody,
): ResetPasswordInput {
  return {
    client: request.client,
    username: input.username,
    code: input.code,
    newPassword: input.newPassword,
    deviceId: resolveDeviceId(request, input.deviceId),
  };
}

export function toRemoveKnownDeviceInput(
  request: Request,
  input: RemoveKnownDeviceRequestBody,
): RemoveKnownDeviceInput {
  return {
    userId: request.auth.sub,
    deviceId: input.deviceId,
  };
}

export function toUnlockLocalLoginInput(
  input: UnlockLocalLoginRequestBody,
): UnlockLocalLoginInput {
  return {
    email: input.email,
    code: input.code,
  };
}

export function toResendUnlockLocalLoginInput(
  request: Request,
  input: ResendUnlockLocalLoginRequestBody,
): ResendUnlockLocalLoginInput {
  return {
    client: request.client,
    email: input.email,
    deviceId: resolveDeviceId(request),
  };
}

export function toChangePasswordInput(
  request: Request,
  input: ChangePasswordRequestBody,
): ChangePasswordInput {
  return {
    userId: request.auth.sub,
    client: request.client,
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
    deviceId: request.auth.deviceId ?? request.client.device.id,
  };
}

export function toSetPasswordInput(
  request: Request,
  input: SetPasswordRequestBody,
): SetPasswordInput {
  return {
    userId: request.auth.sub,
    client: request.client,
    newPassword: input.newPassword,
    deviceId: request.auth.deviceId ?? request.client.device.id,
  };
}
