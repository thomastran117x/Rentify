import { containerTokens } from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment";
import type { LocalAuthController } from "@/features/auth/local/local-auth.controller";
import type { DeviceManagementController } from "@/features/auth/device/device-management.controller";
import type { OAuthController } from "@/features/auth/oauth/oauth.controller";
import type { AuthSessionController } from "@/features/auth/session/session.controller";
import type { EmailAvailabilityController } from "@/features/auth/email-availability/email-availability.controller";
import type { UsernameController } from "@/features/auth/username/username.controller";
import type { LoginLockoutController } from "@/features/auth/lockout/login-lockout.controller";
import type { PasswordController } from "@/features/auth/password/password.controller";
import type { MfaTotpController } from "@/features/auth/mfa/totp/mfa-totp.controller";
import type { MfaVerificationController } from "@/features/auth/mfa/verification/mfa-verification.controller";
import type { PersonalAccessTokenController } from "@/features/auth/personal-access-token/personal-access-token.controller";
import type { RouteModule } from "@/configuration/bootstrap/routes/types";

export const authLocalRouteModule: RouteModule = {
  id: "auth-local",
  register(app, { resolveHandler }) {
    app.post(
      "/auth/local/login",
      resolveHandler<LocalAuthController>(
        containerTokens.localAuthController,
        "localAuthenticate",
      ),
    );
    app.post(
      "/auth/local/signup",
      resolveHandler<LocalAuthController>(
        containerTokens.localAuthController,
        "localSignup",
      ),
    );
    app.post(
      "/auth/local/password/forgot",
      resolveHandler<PasswordController>(
        containerTokens.passwordController,
        "forgotPassword",
      ),
    );
    app.post(
      "/auth/local/password/forgot/resend",
      resolveHandler<PasswordController>(
        containerTokens.passwordController,
        "resendForgotPassword",
      ),
    );
    app.post(
      "/auth/local/password/reset",
      resolveHandler<PasswordController>(
        containerTokens.passwordController,
        "resetPassword",
      ),
    );
    app.post(
      "/auth/local/username/forgot",
      resolveHandler<UsernameController>(
        containerTokens.usernameController,
        "forgotUsername",
      ),
    );
    // Not under /auth/local: OAuth users renaming themselves in account
    // settings check availability through this endpoint too.
    app.get(
      "/auth/username/available",
      resolveHandler<UsernameController>(
        containerTokens.usernameController,
        "checkUsernameAvailability",
      ),
    );
    // Same shape as the username endpoint above, and public for the same
    // reason: the signup form needs an answer before the user submits.
    app.get(
      "/auth/email/available",
      resolveHandler<EmailAvailabilityController>(
        containerTokens.emailAvailabilityController,
        "checkEmailAvailability",
      ),
    );
    app.post(
      "/auth/local/email/verify",
      resolveHandler<LocalAuthController>(
        containerTokens.localAuthController,
        "verifyEmail",
      ),
    );
    app.post(
      "/auth/local/email/resend",
      resolveHandler<LocalAuthController>(
        containerTokens.localAuthController,
        "resendVerificationEmail",
      ),
    );
    app.post(
      "/auth/local/unlock",
      resolveHandler<LoginLockoutController>(
        containerTokens.loginLockoutController,
        "unlockLocalLogin",
      ),
    );
    app.post(
      "/auth/local/unlock/resend",
      resolveHandler<LoginLockoutController>(
        containerTokens.loginLockoutController,
        "resendUnlockLocalLogin",
      ),
    );
    app.post(
      "/auth/local/verify",
      resolveHandler<AuthSessionController>(
        containerTokens.authSessionController,
        "localVerify",
      ),
    );
    app.post(
      "/auth/local/password/change",
      resolveHandler<PasswordController>(
        containerTokens.passwordController,
        "changePassword",
      ),
    );
    app.post(
      "/auth/local/password/set",
      resolveHandler<PasswordController>(
        containerTokens.passwordController,
        "setPassword",
      ),
    );
    app.post(
      "/auth/refresh",
      resolveHandler<AuthSessionController>(
        containerTokens.authSessionController,
        "refresh",
      ),
    );
    app.post(
      "/auth/logout",
      resolveHandler<AuthSessionController>(
        containerTokens.authSessionController,
        "logout",
      ),
    );
  },
};

export const authOauthRouteModule: RouteModule = {
  id: "auth-oauth",
  register(app, { resolveHandler }) {
    app.post(
      "/auth/oauth/google",
      resolveHandler<OAuthController>(
        containerTokens.oauthController,
        "googleAuthenticate",
      ),
    );
    app.post(
      "/auth/oauth/microsoft",
      resolveHandler<OAuthController>(
        containerTokens.oauthController,
        "microsoftAuthenticate",
      ),
    );
    app.post(
      "/auth/oauth/apple",
      resolveHandler<OAuthController>(
        containerTokens.oauthController,
        "appleAuthenticate",
      ),
    );
    app.get(
      "/auth/oauth/providers",
      resolveHandler<OAuthController>(
        containerTokens.oauthController,
        "linkedOAuthProviders",
      ),
    );
    app.post(
      "/auth/oauth/:provider/link",
      resolveHandler<OAuthController>(
        containerTokens.oauthController,
        "linkOAuthProvider",
      ),
    );
    app.delete(
      "/auth/oauth/:provider",
      resolveHandler<OAuthController>(
        containerTokens.oauthController,
        "unlinkOAuthProvider",
      ),
    );
  },
};

export const authDevicesRouteModule: RouteModule = {
  id: "auth-devices",
  register(app, { resolveHandler }) {
    app.post(
      "/auth/device/verify",
      resolveHandler<DeviceManagementController>(
        containerTokens.deviceManagementController,
        "deviceVerify",
      ),
    );
    app.get(
      "/auth/devices",
      resolveHandler<DeviceManagementController>(
        containerTokens.deviceManagementController,
        "devices",
      ),
    );
    app.delete(
      "/auth/devices/remove",
      resolveHandler<DeviceManagementController>(
        containerTokens.deviceManagementController,
        "removeKnownDevice",
      ),
    );
  },
};

export const authMfaVerificationRouteModule: RouteModule = {
  id: "auth-mfa-verification",
  register(app, { resolveHandler }) {
    app.get(
      "/auth/mfa/verify/options",
      resolveHandler<MfaVerificationController>(
        containerTokens.mfaVerificationController,
        "getOptions",
      ),
    );
    app.post(
      "/auth/mfa/verify/challenge",
      resolveHandler<MfaVerificationController>(
        containerTokens.mfaVerificationController,
        "issueChallenge",
      ),
    );
    app.post(
      "/auth/mfa/verify/confirm",
      resolveHandler<MfaVerificationController>(
        containerTokens.mfaVerificationController,
        "confirmChallenge",
      ),
    );
    if (!environment.isProduction()) {
      app.get(
        "/auth/mfa/verify/dev/otp",
        resolveHandler<MfaVerificationController>(
          containerTokens.mfaVerificationController,
          "previewCurrentEmailOtp",
        ),
      );
    }
  },
};

export const authMfaTotpRouteModule: RouteModule = {
  id: "auth-mfa-totp",
  register(app, { resolveHandler }) {
    app.get(
      "/auth/mfa/totp/status",
      resolveHandler<MfaTotpController>(
        containerTokens.mfaTotpController,
        "getStatus",
      ),
    );
    app.post(
      "/auth/mfa/totp/begin",
      resolveHandler<MfaTotpController>(
        containerTokens.mfaTotpController,
        "beginEnrollment",
      ),
    );
    app.post(
      "/auth/mfa/totp/confirm",
      resolveHandler<MfaTotpController>(
        containerTokens.mfaTotpController,
        "confirmEnrollment",
      ),
    );
    app.post(
      "/auth/mfa/totp/disable",
      resolveHandler<MfaTotpController>(
        containerTokens.mfaTotpController,
        "disable",
      ),
    );
    app.delete(
      "/auth/mfa/totp/pending",
      resolveHandler<MfaTotpController>(
        containerTokens.mfaTotpController,
        "cancelEnrollment",
      ),
    );
  },
};

export const authPersonalAccessTokensRouteModule: RouteModule = {
  id: "auth-personal-access-tokens",
  register(app, { resolveHandler }) {
    app.get(
      "/auth/personal-access-tokens",
      resolveHandler<PersonalAccessTokenController>(
        containerTokens.personalAccessTokenController,
        "list",
      ),
    );
    app.post(
      "/auth/personal-access-tokens",
      resolveHandler<PersonalAccessTokenController>(
        containerTokens.personalAccessTokenController,
        "create",
      ),
    );
    app.delete(
      "/auth/personal-access-tokens/:id",
      resolveHandler<PersonalAccessTokenController>(
        containerTokens.personalAccessTokenController,
        "revoke",
      ),
    );
  },
};
