import { containerTokens } from "@/configuration/bootstrap/container";
import { authPersonalAccessTokensRegistrationModule } from "@/configuration/container/registrations/modules/auth-personal-access-tokens";
import { postingsThumbnailRegistrationModule } from "@/configuration/container/registrations/modules/postings-thumbnail";
import { PersonalAccessTokenController } from "@/features/auth/personal-access-token/personal-access-token.controller";
import { PersonalAccessTokenRepository } from "@/features/auth/personal-access-token/personal-access-token.repository";
import { PersonalAccessTokenService } from "@/features/auth/personal-access-token/personal-access-token.service";
import { PostingThumbnailQueueService } from "@/features/postings/thumbnail/thumbnail.queue.service";
import { PostingThumbnailService } from "@/features/postings/thumbnail/thumbnail.service";

jest.mock("@/configuration/resources/database", () => ({
  getDatabaseClient: () => ({}),
}));

describe("targeted container registration modules", () => {
  it("registers and resolves the personal access token graph", () => {
    const registrations: Array<{
      token: unknown;
      resolve: (context: { resolve: (token: unknown) => unknown }) => unknown;
    }> = [];

    authPersonalAccessTokensRegistrationModule.register({
      register: (registration: (typeof registrations)[number]) => {
        registrations.push(registration);
      },
    } as never);

    const repositoryRegistration = registrations.find(
      (registration) =>
        registration.token === containerTokens.personalAccessTokenRepository,
    );
    const serviceRegistration = registrations.find(
      (registration) =>
        registration.token === containerTokens.personalAccessTokenService,
    );
    const controllerRegistration = registrations.find(
      (registration) =>
        registration.token === containerTokens.personalAccessTokenController,
    );

    expect(repositoryRegistration).toBeDefined();
    expect(serviceRegistration).toBeDefined();
    expect(controllerRegistration).toBeDefined();

    const repository = repositoryRegistration!.resolve({
      resolve: jest.fn(),
    });
    const service = serviceRegistration!.resolve({
      resolve: (token) => {
        expect(token).toBe(containerTokens.personalAccessTokenRepository);
        return repository;
      },
    });
    const controller = controllerRegistration!.resolve({
      resolve: (token) => {
        expect(token).toBe(containerTokens.personalAccessTokenService);
        return service;
      },
    });

    expect(repository).toBeInstanceOf(PersonalAccessTokenRepository);
    expect(service).toBeInstanceOf(PersonalAccessTokenService);
    expect(controller).toBeInstanceOf(PersonalAccessTokenController);
  });

  it("registers and resolves the posting thumbnail queue and service graph", () => {
    const registrations: Array<{
      token: unknown;
      resolve: (context: { resolve: (token: unknown) => unknown }) => unknown;
    }> = [];
    const dependencies = new Map<unknown, unknown>([
      [containerTokens.postingsRepository, { id: "postings-repository" }],
      [containerTokens.blobService, { id: "blob-service" }],
      [
        containerTokens.postingsPublicCacheService,
        { id: "postings-public-cache-service" },
      ],
    ]);

    postingsThumbnailRegistrationModule.register({
      register: (registration: (typeof registrations)[number]) => {
        registrations.push(registration);
      },
    } as never);

    const queueRegistration = registrations.find(
      (registration) =>
        registration.token === containerTokens.postingThumbnailQueueService,
    );
    const serviceRegistration = registrations.find(
      (registration) =>
        registration.token === containerTokens.postingThumbnailService,
    );

    expect(queueRegistration).toBeDefined();
    expect(serviceRegistration).toBeDefined();

    const queueService = queueRegistration!.resolve({
      resolve: jest.fn(),
    });
    const thumbnailService = serviceRegistration!.resolve({
      resolve: (token) => dependencies.get(token),
    });

    expect(queueService).toBeInstanceOf(PostingThumbnailQueueService);
    expect(thumbnailService).toBeInstanceOf(PostingThumbnailService);
  });
});
