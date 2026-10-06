import type {
  ImageModerationService,
  ModerationResult,
} from "@/features/media/moderation/image-moderation.service";

/** Moderates nothing and allows every image. Used where no provider is set. */
export class NoopModeration implements ImageModerationService {
  async moderate(): Promise<ModerationResult> {
    return { decision: "allow", categories: {}, provider: "none" };
  }
}
