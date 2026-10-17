import { randomUUID } from "node:crypto";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { UsersRepository } from "@/features/auth/users/users.repository";
import type { TokenRepository } from "@/features/auth/token/token.repository";
import type {
  AuthRequestContext,
  AuthSessionResult,
  AuthUserRecord,
} from "@/features/auth/auth.model";
import { requireExistingUser } from "@/features/auth/require-existing-user";
import type {
  LocalVerifyResult,
  LogoutResult,
  RefreshInput,
} from "@/features/auth/session/session.model";
import { DeviceService } from "@/features/auth/device/device.service";
import {
  RefreshTokenReuseDetectedError,
  TokenService,
} from "@/features/auth/token/token.service";
import { toAuthUserProfile } from "@/features/auth/user-profile-mapper";
import { asUuid } from "@/configuration/validation/uuid";
import { loggerFactory } from "@/configuration/logging";
import type { AuthAuditService } from "@/features/auth/audit/auth-audit.service";
import type { AuthAuditContext } from "@/features/auth/audit/auth-audit.model";

interface DeviceStatus {
  deviceId?: string;
  known: boolean;
  knownByIp: boolean;
}

/**
 * The single owner of session issuance. Every flow that hands back a signed-in
 * session — local login, OAuth, email verification, password reset, password
 * change — routes through here, so the access token, session record and refresh
 * token are always minted together and always from the same token version.
 */
export class AuthSessionService {
  private readonly logger = loggerFactory.forClass(
    AuthSessionService,
    "service",
  );

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly tokenRepository: TokenRepository,
    private readonly tokenService: TokenService,
    private readonly deviceService: DeviceService,
    private readonly authAuditService: AuthAuditService,
  ) {}

  /**
   * A liveness probe for the caller's token. Everything it reports has already
   * been established by the guard, so it does no I/O of its own.
   */
  async localVerify(context: AuthRequestContext): Promise<LocalVerifyResult> {
    return {
      verified: true,
      auth: {
        userId: asUuid(context.auth.sub),
        deviceId: context.auth.deviceId,
        role: context.auth.role,
      },
      client: context.client,
    };
  }

  async refresh(input: RefreshInput): Promise<AuthSessionResult> {
    if (!input.refreshToken) {
      throw new UnauthorizedError("Refresh token is required.");
    }

    const claims = await this.tokenService.verifyRefreshToken(
      input.refreshToken,
    );
    const user = await requireExistingUser(this.usersRepository, claims.sub);
    const deviceId = claims.deviceId ?? input.client.device.id;
    const deviceStatus = await this.deviceService.evaluateExistingSessionDevice(
      user,
      input.client,
      deviceId,
      input.audit,
    );
    const sessionId = claims.sessionId ?? randomUUID();
    const refreshTokenExpiresInSeconds =
      this.tokenService.getRefreshTokenExpiresInSeconds(
        Boolean(claims.rememberMe),
      );

    // Tokens minted before sessions existed carry no sessionId. Back-fill a
    // session record for them rather than rejecting the refresh.
    if (!claims.sessionId) {
      await this.tokenService.createSession(
        {
          sessionId,
          userId: asUuid(user.id),
          deviceId,
          tokenVersion: user.tokenVersion,
        },
        refreshTokenExpiresInSeconds,
      );
      await this.tokenService.revokeRefreshToken(input.refreshToken);
    }

    const accessToken = this.tokenService.createAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      deviceId,
      sessionId,
      tokenVersion: user.tokenVersion,
    });
    let refreshToken: string;

    try {
      refreshToken = claims.sessionId
        ? await this.tokenService.rotateRefreshToken(
            input.refreshToken,
            {
              sub: user.id,
              deviceId,
              rememberMe: Boolean(claims.rememberMe),
              sessionId,
              tokenVersion: user.tokenVersion,
            },
            {
              expiresInSeconds: refreshTokenExpiresInSeconds,
            },
          )
        : await this.tokenService.createRefreshToken(
            {
              sub: user.id,
              deviceId,
              rememberMe: Boolean(claims.rememberMe),
              sessionId,
              tokenVersion: user.tokenVersion,
            },
            {
              expiresInSeconds: refreshTokenExpiresInSeconds,
            },
          );
    } catch (error) {
      if (error instanceof RefreshTokenReuseDetectedError) {
        await this.authAuditService.recordSafely({
          eventType: "session.refresh_reuse_detected",
          outcome: "blocked",
          userId: error.userId,
          method: "refresh",
          sessionId: error.sessionId,
          context: input.audit,
        });
      }

      throw error;
    }

    return {
      accessToken,
      refreshToken,
      refreshTokenExpiresInSeconds,
      device: deviceStatus,
      user: toAuthUserProfile(user),
      sessionId,
    };
  }

  async logout(context: AuthRequestContext): Promise<LogoutResult> {
    if (context.refreshToken) {
      try {
        await this.tokenService.revokeRefreshToken(context.refreshToken);
      } catch {
        // Logout should still invalidate the current server-side session.
      }
    }

    // A personal access token has no session to revoke, so the only way to
    // invalidate it is to rotate the account's token version.
    if (context.auth.authMethod === "jwt" && context.auth.sessionId) {
      await this.tokenService.revokeSession(context.auth.sessionId);
    } else {
      await this.tokenRepository.rotateTokenVersion(context.auth.sub);
    }

    await this.authAuditService.recordSafely({
      eventType: "logout",
      outcome: "success",
      userId: asUuid(context.auth.sub),
      method: context.auth.authMethod === "pat" ? "pat" : undefined,
      sessionId:
        context.auth.authMethod === "jwt" ? context.auth.sessionId : undefined,
      context: context.audit,
    });

    return {
      loggedOut: true,
      auth: {
        userId: asUuid(context.auth.sub),
        deviceId: context.auth.deviceId,
      },
      client: context.client,
    };
  }

  /**
   * A fresh sign-in: the device is evaluated as a login event, which can mark it
   * newly known and send a new-device alert, and `last_login_at` moves forward.
   */
  async authenticateVerifiedUser(
    user: AuthUserRecord,
    input: {
      deviceId?: string;
      client: ClientRequestContext;
      rememberMe?: boolean;
      audit?: AuthAuditContext;
    },
  ): Promise<AuthSessionResult> {
    const deviceStatus =
      await this.deviceService.evaluateSuccessfulAuthentication(
        user,
        input.client,
        input.deviceId,
        input.audit,
      );
    const session = await this.issueTokensForUser(
      user,
      deviceStatus,
      input.deviceId,
      Boolean(input.rememberMe),
    );

    await this.recordLastLogin(user);

    return session;
  }

  /**
   * Best effort: the timestamp is informational, so failing to write it must
   * not fail a sign-in whose session has already been issued.
   */
  private async recordLastLogin(user: AuthUserRecord): Promise<void> {
    try {
      await this.usersRepository.recordLastLogin(asUuid(user.id));
    } catch (error) {
      this.logger.error("Failed to record last sign-in time.", {
        userId: user.id,
        error,
      });
    }
  }

  /**
   * A credential change or email verification on an existing session. The device
   * is evaluated as an already-established one, so changing a password does not
   * fire a new-device alert, and "remember me" is not carried over.
   */
  async reissueSessionForUser(
    user: AuthUserRecord,
    client: ClientRequestContext,
    deviceId?: string,
    audit?: AuthAuditContext,
  ): Promise<AuthSessionResult> {
    const deviceStatus = await this.deviceService.evaluateExistingSessionDevice(
      user,
      client,
      deviceId,
      audit,
    );

    return this.issueTokensForUser(user, deviceStatus, deviceId);
  }

  private async issueTokensForUser(
    user: AuthUserRecord,
    deviceStatus: DeviceStatus,
    deviceId?: string,
    rememberMe = false,
  ): Promise<AuthSessionResult> {
    const sessionId = randomUUID();
    const accessToken = this.tokenService.createAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      deviceId,
      sessionId,
      tokenVersion: user.tokenVersion,
    });

    const refreshTokenExpiresInSeconds =
      this.tokenService.getRefreshTokenExpiresInSeconds(rememberMe);
    await this.tokenService.createSession(
      {
        sessionId,
        userId: asUuid(user.id),
        deviceId,
        tokenVersion: user.tokenVersion,
      },
      refreshTokenExpiresInSeconds,
    );
    const refreshToken = await this.tokenService.createRefreshToken(
      {
        sub: user.id,
        deviceId,
        rememberMe,
        sessionId,
        tokenVersion: user.tokenVersion,
      },
      {
        expiresInSeconds: refreshTokenExpiresInSeconds,
      },
    );

    return {
      accessToken,
      refreshToken,
      refreshTokenExpiresInSeconds,
      device: deviceStatus,
      user: toAuthUserProfile(user),
      sessionId,
    };
  }
}
