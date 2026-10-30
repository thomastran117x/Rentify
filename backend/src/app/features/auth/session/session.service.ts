import { randomUUID } from "node:crypto";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
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
  RevokeSessionResult,
  RevokeSessionsResult,
  RevokeSessionsScope,
  SessionListResult,
  SessionSummary,
} from "@/features/auth/session/session.model";
import { DeviceService } from "@/features/auth/device/device.service";
import {
  RefreshTokenReuseDetectedError,
  TokenService,
} from "@/features/auth/token/token.service";
import { toAuthUserProfile } from "@/features/auth/user-profile-mapper";
import { assertAccountIsActive } from "@/features/auth/account-status/account-status.guard";
import { asUuid, type Uuid } from "@/configuration/validation/uuid";
import { loggerFactory } from "@/configuration/logging";
import type { AuthAuditService } from "@/features/auth/audit/auth-audit.service";
import type { AuthAuditContext } from "@/features/auth/audit/auth-audit.model";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";
import { parseUserAgent } from "@/features/auth/audit/auth-audit-activity";

interface DeviceStatus {
  deviceId?: string;
  known: boolean;
  knownByIp: boolean;
}

function sessionDeviceLabel(session: {
  deviceType?: string;
  platform?: string;
  userAgent?: string;
}): { label: string; browser: string | null; os: string | null } {
  const { browser, os } = parseUserAgent(session.userAgent);

  if (browser && os) {
    return { label: `${browser} on ${os}`, browser, os };
  }

  if (browser) {
    return { label: browser, browser, os };
  }

  if (session.platform) {
    return { label: session.platform, browser, os };
  }

  if (session.deviceType && session.deviceType !== "unknown") {
    return {
      label: `${session.deviceType[0]?.toUpperCase() ?? ""}${session.deviceType.slice(1)} device`,
      browser,
      os,
    };
  }

  return { label: "Unknown device", browser, os };
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
    if (!claims.sessionId) {
      await this.tokenService.revokeRefreshToken(input.refreshToken);
      throw new UnauthorizedError("Session is no longer valid.");
    }

    const sessionId = claims.sessionId;
    const refreshTokenExpiresInSeconds =
      this.tokenService.getRefreshTokenExpiresInSeconds(
        Boolean(claims.rememberMe),
      );

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
      refreshToken = await this.tokenService.rotateRefreshToken(
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
        input.client,
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

  async listSessions(auth: JwtAuthPrincipal): Promise<SessionListResult> {
    const userId = asUuid(auth.sub);
    const currentSessionId = auth.sessionId;
    const tokenVersion =
      typeof auth.tokenVersion === "number" ? auth.tokenVersion : 0;
    const sessions = await this.tokenService.listSessionsForUser(
      userId,
      tokenVersion,
    );

    const summaries: SessionSummary[] = sessions.map((session) => {
      const device = sessionDeviceLabel(session);

      return {
        id: session.sessionId,
        deviceLabel: device.label,
        platform: session.platform ?? null,
        browser: device.browser,
        os: device.os,
        firstIpAddress: session.firstIpAddress ?? null,
        lastIpAddress: session.lastIpAddress ?? null,
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt,
        rememberMe: session.rememberMe,
        current: session.sessionId === currentSessionId,
      };
    });

    summaries.sort((left, right) => {
      if (left.current !== right.current) {
        return left.current ? -1 : 1;
      }

      return Date.parse(right.lastUsedAt) - Date.parse(left.lastUsedAt);
    });

    return { sessions: summaries };
  }

  async revokeManagedSession(input: {
    auth: JwtAuthPrincipal;
    sessionId: string;
    refreshToken?: string;
    audit?: AuthAuditContext;
  }): Promise<RevokeSessionResult> {
    const userId = asUuid(input.auth.sub);
    const current = input.auth.sessionId === input.sessionId;
    const revoked = await this.tokenService.revokeSessionForUser(
      userId,
      input.sessionId,
    );

    if (!revoked) {
      throw new ResourceNotFoundError("Session could not be found.");
    }

    if (current && input.refreshToken) {
      try {
        await this.tokenService.revokeRefreshToken(input.refreshToken);
      } catch {
        // The session record is authoritative; a malformed or missing refresh
        // record must not undo the completed sign-out.
      }
    }

    await this.recordRevokedSessions(
      userId,
      [input.sessionId],
      "one",
      input.audit,
    );

    return { revoked: true, id: input.sessionId, current };
  }

  async revokeManagedSessions(input: {
    auth: JwtAuthPrincipal;
    scope: RevokeSessionsScope;
    audit?: AuthAuditContext;
  }): Promise<RevokeSessionsResult> {
    const userId = asUuid(input.auth.sub);
    const currentSessionId = input.auth.sessionId;
    if (!currentSessionId) {
      throw new UnauthorizedError("Session is no longer valid.");
    }
    let revokedPersonalAccessTokenIds: Uuid[] = [];
    let revokedSessionIds: string[];

    if (input.scope === "all") {
      const currentTokenVersion =
        typeof input.auth.tokenVersion === "number"
          ? input.auth.tokenVersion
          : 0;
      const indexedSessionIds = (
        await this.tokenService.listSessionsForUser(userId, currentTokenVersion)
      ).map((session) => session.sessionId);
      const credentials =
        await this.tokenRepository.revokeAllCredentials(userId);
      revokedPersonalAccessTokenIds = credentials.revokedPersonalAccessTokenIds;
      try {
        revokedSessionIds =
          await this.tokenService.revokeSessionsForUser(userId);
      } catch (error) {
        // The database transaction already rotated tokenVersion, which is the
        // authoritative invalidation. Keep the response successful and audit
        // the sessions ended by that rotation; a later list removes stale
        // Redis index members.
        this.logger.error(
          "Failed to mark indexed sessions revoked after sign out everywhere.",
          { userId, error },
        );
        revokedSessionIds = indexedSessionIds;
      }
    } else {
      revokedSessionIds = await this.tokenService.revokeSessionsForUserExcept(
        userId,
        currentSessionId,
      );
    }

    await this.recordRevokedSessions(
      userId,
      revokedSessionIds,
      input.scope,
      input.audit,
    );

    for (const tokenId of revokedPersonalAccessTokenIds) {
      await this.authAuditService.recordSafely({
        eventType: "pat.revoked",
        outcome: "success",
        userId,
        sessionId: currentSessionId,
        context: input.audit,
        metadata: {
          tokenId,
          scope: "all",
          source: "session_management",
        },
      });
    }

    return {
      scope: input.scope,
      revokedSessionCount: revokedSessionIds.length,
      revokedPersonalAccessTokenCount: revokedPersonalAccessTokenIds.length,
    };
  }

  private async recordRevokedSessions(
    userId: Uuid,
    sessionIds: string[],
    scope: "one" | "others" | "all",
    audit?: AuthAuditContext,
  ): Promise<void> {
    for (const sessionId of sessionIds) {
      await this.authAuditService.recordSafely({
        eventType: "session.revoked",
        outcome: "success",
        userId,
        sessionId,
        context: audit,
        metadata: { scope },
      });
    }
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
    // Each sign-in flow checks the status itself so it can record why it was
    // refused; this is the backstop for any path that reaches a session
    // without doing so.
    assertAccountIsActive(user);

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
      input.client,
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
    assertAccountIsActive(user);

    const deviceStatus = await this.deviceService.evaluateExistingSessionDevice(
      user,
      client,
      deviceId,
      audit,
    );

    return this.issueTokensForUser(user, deviceStatus, deviceId, false, client);
  }

  private async issueTokensForUser(
    user: AuthUserRecord,
    deviceStatus: DeviceStatus,
    deviceId?: string,
    rememberMe = false,
    client?: ClientRequestContext,
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
        rememberMe,
        client,
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
