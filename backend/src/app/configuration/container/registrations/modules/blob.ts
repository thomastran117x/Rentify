import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { BlobController } from "@/features/blob/blob.controller";
import { BlobService } from "@/features/blob/blob.service";
import { MediaService } from "@/features/media/media.service";

export const blobRegistrationModule: ContainerRegistrationModule = {
  id: "blob",
  register(container) {
    container.register({
      token: containerTokens.blobService,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new BlobService(),
    });
    container.register({
      token: containerTokens.mediaService,
      lifetime: "singleton",
      dependencies: [containerTokens.blobService],
      resolve: ({ resolve }) =>
        new MediaService(resolve(containerTokens.blobService)),
    });
    container.register({
      token: containerTokens.blobController,
      lifetime: "scoped",
      dependencies: [containerTokens.mediaService, containerTokens.blobService],
      resolve: ({ resolve }) =>
        new BlobController(
          resolve(containerTokens.mediaService),
          resolve(containerTokens.blobService),
        ),
    });
  },
};
