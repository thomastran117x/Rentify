import { randomUUID } from "node:crypto";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import type { AuthSessionResult, AuthUserRecord } from "@/features/auth/auth.model";
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
    private readonly tokenService: TokenService,
    private readonly deviceService: DeviceService,
  ) {}

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
