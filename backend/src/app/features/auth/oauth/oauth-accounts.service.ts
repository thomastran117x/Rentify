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
  ) {}

  async googleAuthenticate(
    input: OAuthAuthenticateInput,
  ): Promise<AuthSessionResult | OAuthSignupRequiredResult> {
    const profile = await this.googleOAuthService.verify(input);
    return this.authenticateOAuthProfile(profile, input);
  }

  async microsoftAuthenticate(
    input: OAuthAuthenticateInput,
  ): Promise<AuthSessionResult | OAuthSignupRequiredResult> {
    const profile = await this.microsoftOAuthService.verify(input);
    return this.authenticateOAuthProfile(profile, input);
  }

  async appleAuthenticate(
    input: OAuthAuthenticateInput,
  ): Promise<AuthSessionResult | OAuthSignupRequiredResult> {
    const profile = await this.appleOAuthService.verify(input);
    return this.authenticateOAuthProfile(profile, input);
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

    await this.oauthIdentityRepository.unlinkOAuthIdentity(
      asUuid(user.id),
      input.provider,
    );
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
      throw new OAuthSignupContinuationExpiredError();
    }

    try {
      const pendingSignup = await this.oauthSignupStore.read(input.signupToken);

      if (!pendingSignup) {
        throw new OAuthSignupContinuationExpiredError();
      }

      const existingProviderUser =
        await this.usersRepository.findUserByOAuthIdentity(
          pendingSignup.profile.provider,
          pendingSignup.profile.providerUserId,
        );

      if (existingProviderUser) {
        await this.oauthSignupStore.delete(input.signupToken);
        throw new OAuthSignupContinuationExpiredError();
      }

      if (
        await this.usersRepository.findUserByEmail(pendingSignup.profile.email)
      ) {
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
        },
      );
      await this.oauthSignupStore.delete(input.signupToken);
      return { ...session, isNewUser: true };
    } finally {
      await completionLock.release();
    }
  }

  private async authenticateOAuthProfile(
    profile: VerifiedOAuthProfile,
    input: OAuthAuthenticateInput,
  ): Promise<AuthSessionResult | OAuthSignupRequiredResult> {
    this.requireVerifiedOAuthProfile(profile);

    const linkedUser = await this.usersRepository.findUserByOAuthIdentity(
      profile.provider,
      profile.providerUserId,
    );

    if (linkedUser) {
      await requireLoginMfa(
        this.mfaTotpService,
        asUuid(linkedUser.id),
        linkedUser.email,
        input.totpCode,
      );
      return this.authSessionService.authenticateVerifiedUser(
        linkedUser,
        input,
      );
    }

    // Signing in with a provider must not silently take over an address that
    // already has an account: the owner links it from inside that account.
    if (await this.usersRepository.findUserByEmail(profile.email)) {
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
    return { ...session, isNewUser: true };
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
