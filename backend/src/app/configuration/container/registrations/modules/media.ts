import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { MediaController } from "@/features/media/media.controller";
import { MediaCleanupService } from "@/features/media/media-cleanup.service";
import { MediaProcessingQueueService } from "@/features/media/media-processing.queue.service";
import { MediaProcessingService } from "@/features/media/media-processing.service";
import { MediaRepository } from "@/features/media/media.repository";
import { MediaService } from "@/features/media/media.service";
import { ImageVariantsResolver } from "@/features/media/image-variants";

export const mediaRegistrationModule: ContainerRegistrationModule = {
  id: "media",
  register(container) {
    container.register({
      token: containerTokens.mediaRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new MediaRepository(),
    });
    container.register({
      token: containerTokens.imageVariantsResolver,
      lifetime: "singleton",
      dependencies: [containerTokens.mediaRepository],
      resolve: ({ resolve }) =>
        new ImageVariantsResolver(resolve(containerTokens.mediaRepository)),
    });
    container.register({
      token: containerTokens.mediaProcessingQueueService,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new MediaProcessingQueueService(),
    });
    container.register({
      token: containerTokens.mediaService,
      lifetime: "singleton",
      dependencies: [
        containerTokens.blobService,
        containerTokens.mediaRepository,
        containerTokens.mediaProcessingQueueService,
      ],
      resolve: ({ resolve }) =>
        new MediaService(
          resolve(containerTokens.blobService),
          resolve(containerTokens.mediaRepository),
          resolve(containerTokens.mediaProcessingQueueService),
        ),
    });
    container.register({
      token: containerTokens.mediaProcessingService,
      lifetime: "singleton",
      dependencies: [
        containerTokens.mediaRepository,
        containerTokens.blobService,
      ],
      resolve: ({ resolve }) =>
        new MediaProcessingService(
          resolve(containerTokens.mediaRepository),
          resolve(containerTokens.blobService),
        ),
    });
    container.register({
      token: containerTokens.mediaCleanupService,
      lifetime: "singleton",
      dependencies: [
        containerTokens.mediaRepository,
        containerTokens.blobService,
        containerTokens.mediaProcessingQueueService,
      ],
      resolve: ({ resolve }) =>
        new MediaCleanupService(
          resolve(containerTokens.mediaRepository),
          resolve(containerTokens.blobService),
          resolve(containerTokens.mediaProcessingQueueService),
        ),
    });
    container.register({
      token: containerTokens.mediaController,
      lifetime: "scoped",
      dependencies: [containerTokens.mediaService],
      resolve: ({ resolve }) =>
        new MediaController(resolve(containerTokens.mediaService)),
    });
  },
};
