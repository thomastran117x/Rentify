import BadRequestError from "@/errors/http/bad-request.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type { BlobService } from "@/features/blob/blob.service";
import type {
  ListProfilesInput,
  ListProfilesResult,
  ProfileRecord,
  UpdateProfileInput,
} from "@/features/profile/profile.model";
import type { ProfileRepository } from "@/features/profile/profile.repository";

export class ProfileService {
  constructor(
    private readonly profileRepository: ProfileRepository,
    private readonly blobService: BlobService,
  ) {}

  async list(input: ListProfilesInput): Promise<ListProfilesResult> {
    return this.profileRepository.findPublicProfiles({
      page: input.page,
      pageSize: input.pageSize,
      query: input.query?.trim() || undefined,
    });
  }

  async getByUserId(userId: string): Promise<ProfileRecord> {
    const profile = await this.profileRepository.findByUserId(userId);

    if (!profile) {
      throw new ResourceNotFoundError("Profile could not be found.");
    }

    return profile;
  }

  async update(input: UpdateProfileInput): Promise<ProfileRecord> {
    this.assertPostingCounts(input);
    this.assertAvatarFields(input);

    const existingProfile = await this.profileRepository.findByUserId(
      input.userId,
    );

    if (!existingProfile) {
      throw new ResourceNotFoundError("Profile could not be found.");
    }

    return this.profileRepository.update({
      ...input,
      username: input.username.trim().toLowerCase(),
      phoneNumber: input.phoneNumber?.trim() || null,
      avatarUrl: input.avatarUrl?.trim() || null,
      avatarBlobName: input.avatarBlobName?.trim() || null,
    });
  }

  private assertPostingCounts(input: UpdateProfileInput): void {
    if (
      input.rentPostingsCount !== undefined &&
      input.availableRentPostingsCount !== undefined &&
      input.availableRentPostingsCount > input.rentPostingsCount
    ) {
      throw new BadRequestError(
        "Available rent postings count cannot exceed total rent postings count.",
      );
    }
  }

  private assertAvatarFields(input: UpdateProfileInput): void {
    const hasAvatarUrl = input.avatarUrl !== undefined;
    const hasAvatarBlobName = input.avatarBlobName !== undefined;

    if (hasAvatarUrl !== hasAvatarBlobName) {
      throw new BadRequestError(
        "Avatar URL and avatar blob name must be provided together when updating the avatar.",
      );
    }

    if (!hasAvatarUrl && !hasAvatarBlobName) {
      return;
    }

    if (!input.avatarUrl && !input.avatarBlobName) {
      return;
    }

    if (!input.avatarUrl || !input.avatarBlobName) {
      throw new BadRequestError(
        "Avatar URL and avatar blob name must both be set or both be null.",
      );
    }

    if (!this.blobService.isConfigured()) {
      throw new BadRequestError(
        "Avatar images require Azure Blob Storage to be configured on the backend.",
      );
    }

    if (
      !this.blobService.isManagedBlobUrl(input.avatarUrl, input.avatarBlobName)
    ) {
      throw new BadRequestError(
        "Avatar URL must match the Azure Blob Storage location for the provided blob name.",
      );
    }
  }
}
