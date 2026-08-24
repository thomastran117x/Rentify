import ConflictError from "@/errors/http/conflict.error";
import type { UsersRepository } from "@/features/auth/users/users.repository";
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
  LinkedOAuthProvidersResult,
  LinkOAuthProviderInput,
  OAuthAuthenticateInput,
  UnlinkOAuthProviderInput,
} from "@/features/auth/oauth/oauth-accounts.model";
import { AuthSessionService } from "@/features/auth/session/session.service";
import type { UsernameBloomService } from "@/features/auth/username-bloom/username-bloom.service";

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
    private readonly usernameBloomService: UsernameBloomService,
    private readonly mfaTotpService: MfaTotpService,
    private readonly authSessionService: AuthSessionService,
  ) {}

  async googleAuthenticate(
    input: OAuthAuthenticateInput,
  ): Promise<AuthSessionResult> {
    const profile = await this.googleOAuthService.verify(input);
    return this.authenticateOAuthProfile(profile, input);
  }

  async microsoftAuthenticate(
    input: OAuthAuthenticateInput,
  ): Promise<AuthSessionResult> {
    const profile = await this.microsoftOAuthService.verify(input);
    return this.authenticateOAuthProfile(profile, input);
  }

  async appleAuthenticate(
    input: OAuthAuthenticateInput,
  ): Promise<AuthSessionResult> {
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
    userId: string;
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
      user.id,
      input.provider,
    );
    return this.listLinkedOAuthProvidersForUser({
      ...user,
      oauthIdentities:
        await this.oauthIdentityRepository.listOAuthIdentitiesByUserId(user.id),
    });
  }

  private async authenticateOAuthProfile(
    profile: VerifiedOAuthProfile,
    input: OAuthAuthenticateInput,
  ): Promise<AuthSessionResult> {
    this.requireVerifiedOAuthProfile(profile);

    const linkedUser = await this.usersRepository.findUserByOAuthIdentity(
      profile.provider,
      profile.providerUserId,
    );

    if (linkedUser) {
      await requireLoginMfa(
        this.mfaTotpService,
        linkedUser.id,
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

    const user = await this.usersRepository.createOAuthUser(
      profile,
      // This callback is a screening hint, not an availability guarantee.
      // `unknown` must remain false or an unavailable filter would reject every
      // normal candidate; the repository still confirms the selected username.
      (candidate) =>
        this.usernameBloomService.check(candidate) === "possibly-present",
    );
    await this.usernameBloomService.add(user.profile.username);
    const session = await this.authSessionService.authenticateVerifiedUser(
      user,
      input,
    );
    return { ...session, isNewUser: true };
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
