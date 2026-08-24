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
import { TokenService } from "@/features/auth/token/token.service";
import { toAuthUserProfile } from "@/features/auth/user-profile-mapper";

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
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly tokenRepository: TokenRepository,
    private readonly tokenService: TokenService,
    private readonly deviceService: DeviceService,
  ) {}

  /**
   * A liveness probe for the caller's token. Everything it reports has already
   * been established by the guard, so it does no I/O of its own.
   */
  async localVerify(context: AuthRequestContext): Promise<LocalVerifyResult> {
    return {
      verified: true,
      auth: {
        userId: context.auth.sub,
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
          userId: user.id,
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
    const refreshToken = claims.sessionId
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

    return {
      accessToken,
      refreshToken,
      refreshTokenExpiresInSeconds,
      device: deviceStatus,
      user: toAuthUserProfile(user),
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

    return {
      loggedOut: true,
      auth: {
        userId: context.auth.sub,
        deviceId: context.auth.deviceId,
      },
      client: context.client,
    };
  }

  /**
   * A fresh sign-in: the device is evaluated as a login event, which can mark it
   * newly known and send a new-device alert.
   */
  async authenticateVerifiedUser(
    user: AuthUserRecord,
    input: {
      deviceId?: string;
      client: ClientRequestContext;
      rememberMe?: boolean;
    },
  ): Promise<AuthSessionResult> {
    const deviceStatus =
      await this.deviceService.evaluateSuccessfulAuthentication(
        user,
        input.client,
        input.deviceId,
      );

    return this.issueTokensForUser(
      user,
      deviceStatus,
      input.deviceId,
      Boolean(input.rememberMe),
    );
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
  ): Promise<AuthSessionResult> {
    const deviceStatus = await this.deviceService.evaluateExistingSessionDevice(
      user,
      client,
      deviceId,
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
        userId: user.id,
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
    };
  }
}
