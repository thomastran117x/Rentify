import { containerTokens } from "@/configuration/container/tokens";
import { environment } from "@/configuration/environment";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { MediaController } from "@/features/media/media.controller";
import { MediaCleanupService } from "@/features/media/media-cleanup.service";
import {
  BestEffortMediaMetrics,
  LogMediaMetrics,
  warnIfLogMetricsSuppressed,
} from "@/features/media/media-metrics";
import { MediaProcessingQueueService } from "@/features/media/media-processing.queue.service";
import { MediaProcessingService } from "@/features/media/media-processing.service";
import { MediaRepository } from "@/features/media/media.repository";
import { MediaService } from "@/features/media/media.service";
import { createMalwareScanner } from "@/features/media/scanning/create-malware-scanner";
import { createImageModeration } from "@/features/media/moderation/create-image-moderation";
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
    // Every adapter goes behind BestEffortMediaMetrics, so recording a metric
    // can never fail the request or job being measured.
    container.register({
      token: containerTokens.mediaMetrics,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => {
        warnIfLogMetricsSuppressed(environment.getLoggingConfig().level);
        return new BestEffortMediaMetrics(new LogMediaMetrics());
      },
    });
    container.register({
      token: containerTokens.malwareScanner,
      lifetime: "singleton",
      dependencies: [],
      resolve: () =>
        createMalwareScanner(
          environment.getMediaScanningConfig(),
          environment.isProduction(),
        ),
    });
    container.register({
      token: containerTokens.imageModeration,
      lifetime: "singleton",
      dependencies: [],
      resolve: () =>
        createImageModeration(environment.getMediaModerationConfig()),
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
        containerTokens.mediaMetrics,
      ],
      resolve: ({ resolve }) =>
        new MediaService(
          resolve(containerTokens.blobService),
          resolve(containerTokens.mediaRepository),
          resolve(containerTokens.mediaProcessingQueueService),
          resolve(containerTokens.mediaMetrics),
        ),
    });
    container.register({
      token: containerTokens.mediaProcessingService,
      lifetime: "singleton",
      dependencies: [
        containerTokens.mediaRepository,
        containerTokens.blobService,
        containerTokens.mediaMetrics,
        containerTokens.malwareScanner,
        containerTokens.imageModeration,
      ],
      resolve: ({ resolve }) =>
        new MediaProcessingService(
          resolve(containerTokens.mediaRepository),
          resolve(containerTokens.blobService),
          resolve(containerTokens.mediaMetrics),
          resolve(containerTokens.malwareScanner),
          resolve(containerTokens.imageModeration),
        ),
    });
    container.register({
      token: containerTokens.mediaCleanupService,
      lifetime: "singleton",
      dependencies: [
        containerTokens.mediaRepository,
        containerTokens.blobService,
        containerTokens.mediaProcessingQueueService,
        containerTokens.mediaMetrics,
      ],
      resolve: ({ resolve }) =>
        new MediaCleanupService(
          resolve(containerTokens.mediaRepository),
          resolve(containerTokens.blobService),
          resolve(containerTokens.mediaProcessingQueueService),
          resolve(containerTokens.mediaMetrics),
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
