import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { BlobController } from "@/features/blob/blob.controller";
import { BlobService } from "@/features/blob/blob.service";

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
      token: containerTokens.blobController,
      lifetime: "scoped",
      dependencies: [containerTokens.blobService],
      resolve: ({ resolve }) =>
        new BlobController(resolve(containerTokens.blobService)),
    });
  },
};
