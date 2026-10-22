import ConflictError from "@/errors/http/conflict.error";
import {
  OAuthUsernameAllocationConflictError,
  type UsersRepository,
} from "@/features/auth/users/users.repository";
import type { OAuthIdentityRepository } from "@/features/auth/oauth/oauth-identity.repository";
import type {
  AuthSessionResult,
  AuthUserRecord,
  OAuthProvider,
} from "@/features/auth/auth.model";
import { isLocalPasswordAccount } from "@/features/auth/local-account-eligibility";
import { requireExistingUser } from "@/features/auth/require-existing-user";
import { requireLoginMfa } from "@/features/auth/mfa/login-mfa.guard";
import {
  assertAccountIsActive,
  toBlockedAccountReasonCode,
} from "@/features/auth/account-status/account-status.guard";
import type { MfaTotpService } from "@/features/auth/mfa/totp/mfa-totp.service";
import { AppleOAuthService } from "@/features/auth/oauth/apple.service";
import { GoogleOAuthService } from "@/features/auth/oauth/google.service";
import { MicrosoftOAuthService } from "@/features/auth/oauth/microsoft.service";
import type { VerifiedOAuthProfile } from "@/features/auth/oauth/oauth.types";
import type {
  CompleteOAuthSignupInput,
  LinkedOAuthProvidersResult,
  LinkOAuthProviderInput,
  OAuthAuthenticateInput,
  OAuthSignupRequiredResult,
  UnlinkOAuthProviderInput,
} from "@/features/auth/oauth/oauth-accounts.model";
import { AuthSessionService } from "@/features/auth/session/session.service";
import type { IdentityBloomService } from "@/features/auth/identity-bloom/identity-bloom.service";
import type { Uuid } from "@/configuration/validation/uuid";
import { asUuid } from "@/configuration/validation/uuid";
import type { UsernameService } from "@/features/auth/username/username.service";
import type { OAuthSignupStore } from "@/features/auth/oauth/oauth-signup.store";
import OAuthSignupContinuationExpiredError from "@/errors/http/oauth-signup-continuation-expired.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { AuthAuditService } from "@/features/auth/audit/auth-audit.service";
import type {
  AuthAuditOutcome,
  AuthAuditReasonCode,
} from "@/features/auth/audit/auth-audit.model";

const OAUTH_USERNAME_ALLOCATION_ATTEMPTS = 5;

/**
 * Sign-in and account linking through the three social providers.
 *
 * The providers themselves (token exchange, JWKS, claim validation) live in
 * their own services; this owns what the product does with a verified profile.
 */
export class OAuthAccountsService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly oauthIdentityRepository: OAuthIdentityRepository,
    private readonly googleOAuthService: GoogleOAuthService,
    private readonly microsoftOAuthService: MicrosoftOAuthService,
    private readonly appleOAuthService: AppleOAuthService,
    private readonly usernameBloomService: IdentityBloomService,
    private readonly emailBloomService: IdentityBloomService,
    private readonly usernameService: UsernameService,
    private readonly mfaTotpService: MfaTotpService,
    private readonly authSessionService: AuthSessionService,
    private readonly oauthSignupStore: OAuthSignupStore,
    private readonly authAuditService: AuthAuditService,
  ) {}

  async googleAuthenticate(
    input: OAuthAuthenticateInput,
  ): Promise<AuthSessionResult | OAuthSignupRequiredResult> {
    return this.authenticateProvider("google", input, () =>
      this.googleOAuthService.verify(input),
    );
  }

  async microsoftAuthenticate(
    input: OAuthAuthenticateInput,
  ): Promise<AuthSessionResult | OAuthSignupRequiredResult> {
    return this.authenticateProvider("microsoft", input, () =>
      this.microsoftOAuthService.verify(input),
    );
  }

  async appleAuthenticate(
    input: OAuthAuthenticateInput,
  ): Promise<AuthSessionResult | OAuthSignupRequiredResult> {
    return this.authenticateProvider("apple", input, () =>
      this.appleOAuthService.verify(input),
    );
  }

  async linkOAuthProvider(
    input: LinkOAuthProviderInput,
  ): Promise<LinkedOAuthProvidersResult> {
    const user = await requireExistingUser(this.usersRepository, input.userId);
    const profile = await this.verifyOAuthInput(input.provider, input);

    this.requireVerifiedOAuthProfile(profile);

    const existingProviderUser =
      await this.usersRepository.findUserByOAuthIdentity(
        profile.provider,
        profile.providerUserId,
      );

    if (existingProviderUser && existingProviderUser.id !== user.id) {
      throw new ConflictError(
        "This OAuth provider is already linked to another account.",
      );
    }

    if (
      existingProviderUser?.id === user.id ||
      user.oauthIdentities.some(
        (identity) => identity.provider === profile.provider,
      )
    ) {
      return this.listLinkedOAuthProvidersForUser(user);
    }

    await this.oauthIdentityRepository.linkOAuthIdentity(user.id, profile);
    await this.authAuditService.recordSafely({
      eventType: "oauth.linked",
      outcome: "success",
      userId: asUuid(user.id),
      method: input.provider,
      sessionId: input.sessionId,
      context: input.audit,
    });
    return this.listLinkedOAuthProvidersForUser({
      ...user,
      oauthIdentities:
        await this.oauthIdentityRepository.listOAuthIdentitiesByUserId(user.id),
    });
  }

  async linkedOAuthProviders(context: {
    userId: Uuid;
  }): Promise<LinkedOAuthProvidersResult> {
    const user = await requireExistingUser(
      this.usersRepository,
      context.userId,
    );
    return this.listLinkedOAuthProvidersForUser(user);
  }

  async unlinkOAuthProvider(
    input: UnlinkOAuthProviderInput,
  ): Promise<LinkedOAuthProvidersResult> {
    const user = await requireExistingUser(this.usersRepository, input.userId);

    if (
      !user.oauthIdentities.some(
        (identity) => identity.provider === input.provider,
      )
    ) {
      return this.listLinkedOAuthProvidersForUser(user);
    }

    // Unlinking the only provider on an account with no password would leave it
    // with no way in at all.
    if (!isLocalPasswordAccount(user) && user.oauthIdentities.length <= 1) {
      throw new ConflictError(
        "Add another sign-in method before unlinking this provider.",
      );
    }

    const unlinked = await this.oauthIdentityRepository.unlinkOAuthIdentity(
      asUuid(user.id),
      input.provider,
    );
    if (unlinked) {
      await this.authAuditService.recordSafely({
        eventType: "oauth.unlinked",
        outcome: "success",
        userId: asUuid(user.id),
        method: input.provider,
        sessionId: input.sessionId,
        context: input.audit,
      });
    }
    return this.listLinkedOAuthProvidersForUser({
      ...user,
      oauthIdentities:
        await this.oauthIdentityRepository.listOAuthIdentitiesByUserId(user.id),
    });
  }

  async completeSignup(
    input: CompleteOAuthSignupInput,
  ): Promise<AuthSessionResult> {
    const completionLock = await this.oauthSignupStore.acquireCompletionLock(
      input.signupToken,
    );

    if (!completionLock) {
      await this.recordOAuthFailure({
        reasonCode: "signup_expired",
        context: input.audit,
      });
      throw new OAuthSignupContinuationExpiredError();
    }

    try {
      const pendingSignup = await this.oauthSignupStore.read(input.signupToken);

      if (!pendingSignup) {
        await this.recordOAuthFailure({
          reasonCode: "signup_expired",
          context: input.audit,
        });
        throw new OAuthSignupContinuationExpiredError();
      }

      const existingProviderUser =
        await this.usersRepository.findUserByOAuthIdentity(
          pendingSignup.profile.provider,
          pendingSignup.profile.providerUserId,
        );

      if (existingProviderUser) {
        await this.oauthSignupStore.delete(input.signupToken);
        await this.recordOAuthFailure({
          reasonCode: "signup_expired",
          method: pendingSignup.profile.provider,
          userId: asUuid(existingProviderUser.id),
          identifierHash: this.authAuditService.hashIdentifier(
            pendingSignup.profile.email,
          ),
          context: input.audit,
        });
        throw new OAuthSignupContinuationExpiredError();
      }

      const existingEmailUser = await this.usersRepository.findUserByEmail(
        pendingSignup.profile.email,
      );
      if (existingEmailUser) {
        await this.recordOAuthFailure({
          reasonCode: "email_conflict",
          method: pendingSignup.profile.provider,
          userId: asUuid(existingEmailUser.id),
          identifierHash: this.authAuditService.hashIdentifier(
            pendingSignup.profile.email,
          ),
          context: input.audit,
        });
        throw new ConflictError(
          "An account with this email already exists. Sign in with the original method before linking a social provider.",
        );
      }

      const user = await this.createOAuthUserWithSuggestedUsername(
        pendingSignup.profile,
        input.dateOfBirth,
      );
      await this.usernameBloomService.add(user.profile.username);
      await this.emailBloomService.add(user.email);
      const session = await this.authSessionService.authenticateVerifiedUser(
        user,
        {
          client: input.client,
          rememberMe: pendingSignup.rememberMe,
          deviceId: input.deviceId ?? pendingSignup.deviceId,
          audit: input.audit,
        },
      );
      await this.oauthSignupStore.delete(input.signupToken);
      await this.recordOAuthSuccess(
        "oauth.signup.completed",
        user,
        pendingSignup.profile,
        session.sessionId,
        input.audit,
      );
      return { ...session, isNewUser: true };
    } finally {
      await completionLock.release();
    }
  }

  private async authenticateProvider(
    provider: OAuthProvider,
    input: OAuthAuthenticateInput,
    verify: () => Promise<VerifiedOAuthProfile>,
  ): Promise<AuthSessionResult | OAuthSignupRequiredResult> {
    let profile: VerifiedOAuthProfile;

    try {
      profile = await verify();
      this.requireVerifiedOAuthProfile(profile);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        await this.recordOAuthFailure({
          reasonCode: "token_invalid",
          method: provider,
          context: input.audit,
        });
      }
      throw error;
    }

    return this.authenticateOAuthProfile(profile, input);
  }

  private async authenticateOAuthProfile(
    profile: VerifiedOAuthProfile,
    input: OAuthAuthenticateInput,
  ): Promise<AuthSessionResult | OAuthSignupRequiredResult> {
    const linkedUser = await this.usersRepository.findUserByOAuthIdentity(
      profile.provider,
      profile.providerUserId,
    );

    if (linkedUser) {
      // The provider has proven who this is, so the status can be revealed.
      if (linkedUser.status !== "active") {
        await this.recordOAuthFailure({
          reasonCode: toBlockedAccountReasonCode(linkedUser.status),
          outcome: "blocked",
          method: profile.provider,
          userId: asUuid(linkedUser.id),
          identifierHash: this.authAuditService.hashIdentifier(profile.email),
          context: input.audit,
        });
        assertAccountIsActive(linkedUser);
      }

      try {
        await requireLoginMfa(
          this.mfaTotpService,
          asUuid(linkedUser.id),
          linkedUser.email,
          input.totpCode,
        );
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          const details = error.details as
            | { mfaRequired?: boolean }
            | undefined;
          await this.recordOAuthFailure({
            reasonCode: details?.mfaRequired ? "mfa_required" : "mfa_invalid",
            method: profile.provider,
            userId: asUuid(linkedUser.id),
            identifierHash: this.authAuditService.hashIdentifier(profile.email),
            context: input.audit,
          });
        }
        throw error;
      }
      const session = await this.authSessionService.authenticateVerifiedUser(
        linkedUser,
        input,
      );
      await this.recordOAuthSuccess(
        "oauth.login.succeeded",
        linkedUser,
        profile,
        session.sessionId,
        input.audit,
      );
      return session;
    }

    // Signing in with a provider must not silently take over an address that
    // already has an account: the owner links it from inside that account.
    const existingEmailUser = await this.usersRepository.findUserByEmail(
      profile.email,
    );
    if (existingEmailUser) {
      await this.recordOAuthFailure({
        reasonCode: "email_conflict",
        method: profile.provider,
        userId: asUuid(existingEmailUser.id),
        identifierHash: this.authAuditService.hashIdentifier(profile.email),
        context: input.audit,
      });
      throw new ConflictError(
        "An account with this email already exists. Sign in with the original method before linking a social provider.",
      );
    }

    if (!input.dateOfBirth) {
      const signupToken = await this.oauthSignupStore.create({
        profile,
        rememberMe: input.rememberMe,
        deviceId: input.deviceId,
        createdAt: new Date().toISOString(),
      });
      return {
        signupRequired: true,
        signupToken,
        expiresInSeconds: this.oauthSignupStore.getTtlInSeconds(),
      };
    }

    const user = await this.createOAuthUserWithSuggestedUsername(
      profile,
      input.dateOfBirth,
    );
    await this.usernameBloomService.add(user.profile.username);
    await this.emailBloomService.add(user.email);
    const session = await this.authSessionService.authenticateVerifiedUser(
      user,
      input,
    );
    await this.recordOAuthSuccess(
      "oauth.signup.completed",
      user,
      profile,
      session.sessionId,
      input.audit,
    );
    return { ...session, isNewUser: true };
  }

  private async recordOAuthSuccess(
    eventType: "oauth.login.succeeded" | "oauth.signup.completed",
    user: AuthUserRecord,
    profile: VerifiedOAuthProfile,
    sessionId: string | undefined,
    context: OAuthAuthenticateInput["audit"],
  ): Promise<void> {
    await this.authAuditService.recordSafely({
      eventType,
      outcome: "success",
      userId: asUuid(user.id),
      method: profile.provider,
      identifierHash: this.authAuditService.hashIdentifier(profile.email),
      sessionId,
      context,
    });
  }

  private async recordOAuthFailure(input: {
    reasonCode: AuthAuditReasonCode;
    outcome?: AuthAuditOutcome;
    method?: OAuthProvider;
    userId?: Uuid;
    identifierHash?: string;
    context: OAuthAuthenticateInput["audit"];
  }): Promise<void> {
    await this.authAuditService.recordSafely({
      eventType: "oauth.login.failed",
      outcome: input.outcome ?? "failure",
      reasonCode: input.reasonCode,
      method: input.method,
      userId: input.userId ?? null,
      identifierHash: input.identifierHash,
      context: input.context,
    });
  }

  private async createOAuthUserWithSuggestedUsername(
    profile: VerifiedOAuthProfile,
    dateOfBirth: string,
  ): Promise<AuthUserRecord> {
    let lastConflict: OAuthUsernameAllocationConflictError | undefined;

    for (
      let attempt = 0;
      attempt < OAUTH_USERNAME_ALLOCATION_ATTEMPTS;
      attempt += 1
    ) {
      const { suggestions } = await this.usernameService.suggestUsernames(1);
      const username = suggestions[0]!;

      try {
        return await this.usersRepository.createOAuthUser(
          profile,
          username,
          dateOfBirth,
        );
      } catch (error) {
        if (!(error instanceof OAuthUsernameAllocationConflictError)) {
          throw error;
        }

        lastConflict = error;
      }
    }

    throw lastConflict ?? new Error("Unable to assign an OAuth username.");
  }

  private async verifyOAuthInput(
    provider: OAuthProvider,
    input: OAuthAuthenticateInput,
  ): Promise<VerifiedOAuthProfile> {
    if (provider === "google") {
      return this.googleOAuthService.verify(input);
    }

    if (provider === "microsoft") {
      return this.microsoftOAuthService.verify(input);
    }

    return this.appleOAuthService.verify(input);
  }

  private requireVerifiedOAuthProfile(profile: VerifiedOAuthProfile): void {
    if (!profile.emailVerified) {
      throw new Error("OAuth account email must be verified.");
    }
  }

  private listLinkedOAuthProvidersForUser(
    user: AuthUserRecord,
  ): LinkedOAuthProvidersResult {
    return {
      hasPassword: isLocalPasswordAccount(user),
      providers: user.oauthIdentities.map((identity) => ({
        id: identity.id,
        provider: identity.provider,
        providerEmail: identity.providerEmail,
        emailVerified: identity.emailVerified,
        displayName: identity.displayName,
        linkedAt: identity.linkedAt,
      })),
    };
  }
}
