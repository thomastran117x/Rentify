import BadRequestError from "@/errors/http/bad-request.error";
import type {
  OAuthAuthenticateInput,
  VerifiedOAuthProfile,
} from "@/features/auth/oauth/oauth.types";

class AppleOAuthService {
  async verify(_input: OAuthAuthenticateInput): Promise<VerifiedOAuthProfile> {
    throw new BadRequestError(
      "Apple OAuth authorization code flow has not been implemented yet.",
    );
  }
}

export default AppleOAuthService;
export { AppleOAuthService };
